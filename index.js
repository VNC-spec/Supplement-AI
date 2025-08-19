/*
 * shopify-agent/index.js
 *
 * This script spins up a simple Express server that exposes a `/chat` endpoint.
 * The endpoint receives a user message, invokes OpenAI’s Chat Completions API
 * with function calling enabled, and optionally executes one of the
 * pre-defined functions to query your Shopify store. The functions are
 * implemented as plain async JavaScript functions that call Shopify’s
 * GraphQL Admin API using your store credentials. Responses from the
 * functions are returned back to the model to generate a final reply.
 *
 * Before running this server you need to create a `.env` file in the
 * project root based off `.env.example` and fill in your OpenAI API key,
 * Shopify store domain and admin access token. Without valid credentials
 * the API calls will fail.
 */

const express = require('express');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const fetch = require('node-fetch');

// Load environment variables from .env
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Shopify credentials from environment
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

// Helper to call Shopify GraphQL Admin API
async function callShopify(query, variables = {}) {
  if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
    throw new Error('Shopify store credentials are not set in environment variables');
  }
  const url = `https://${SHOPIFY_STORE}/admin/api/2025-07/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (data.errors) {
    throw new Error(`Shopify API error: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

/**
 * findProduct
 *
 * Searches for products in your Shopify store based on a free‑form query. The
 * GraphQL query below searches across product titles and descriptions. It
 * returns a list of up to five matching products with basic details. If no
 * products match, an empty list is returned.
 *
 * @param {Object} params
 * @param {string} params.query - The search string provided by the user.
 * @returns {Promise<Object>} - An object containing an array of products.
 */
async function findProduct({ query }) {
  const gql = `
    query($queryString: String!) {
      products(first: 5, query: $queryString) {
        edges {
          node {
            id
            title
            description
            images(first: 1) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `;
  const result = await callShopify(gql, { queryString: query });
  const edges = result?.data?.products?.edges || [];
  const products = edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    price: node.priceRange.minVariantPrice.amount,
    currency: node.priceRange.minVariantPrice.currencyCode,
    image: node.images.edges[0]?.node || null,
  }));
  return { products };
}

/**
 * getCustomerOrders
 *
 * Retrieves the most recent orders for a customer identified by email. The
 * GraphQL query fetches basic order details, total price, line items and
 * fulfillment information including tracking numbers and links. Note that
 * Shopify only returns the last 60 days of orders by default. To access older
 * orders, request the `read_all_orders` scope in your app.
 *
 * @param {Object} params
 * @param {string} params.email - The customer's email address.
 * @returns {Promise<Object>} - An object containing an array of customers and their orders.
 */
async function getCustomerOrders({ email }) {
  const gql = `
    query($email: String!) {
      customers(first: 1, query: $email) {
        edges {
          node {
            id
            firstName
            lastName
            email
            orders(first: 5) {
              edges {
                node {
                  id
                  name
                  processedAt
                  totalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  fulfillments(first: 1) {
                    status
                    estimatedDeliveryAt
                    trackingInfo(first: 5) {
                      company
                      number
                      url
                    }
                  }
                  lineItems(first: 5) {
                    edges {
                      node {
                        title
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  const result = await callShopify(gql, { email });
  const customers = result?.data?.customers?.edges?.map(({ node }) => ({
    id: node.id,
    name: `${node.firstName || ''} ${node.lastName || ''}`.trim(),
    email: node.email,
    orders: node.orders.edges.map(({ node: order }) => ({
      id: order.id,
      name: order.name,
      processedAt: order.processedAt,
      total: order.totalPriceSet.shopMoney.amount,
      currency: order.totalPriceSet.shopMoney.currencyCode,
      fulfillments: order.fulfillments.map(f => ({
        status: f.status,
        estimatedDeliveryAt: f.estimatedDeliveryAt,
        tracking: f.trackingInfo.map(t => ({
          company: t.company,
          number: t.number,
          url: t.url,
        })),
      })),
      items: order.lineItems.edges.map(({ node: li }) => ({
        title: li.title,
        quantity: li.quantity,
      })),
    })),
  })) || [];
  return { customers };
}

/**
 * getProducts
 *
 * Fetches a small sample of products from the store. This endpoint is useful
 * if the assistant needs to display a generic list of items when the user
 * doesn’t provide specific search criteria. Modify the query to increase
 * the number of products or return different fields.
 *
 * @returns {Promise<Object>} - An object containing an array of products.
 */
async function getProducts() {
  const gql = `
    query {
      products(first: 5) {
        edges {
          node {
            id
            title
            description
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `;
  const result = await callShopify(gql);
  const products = result?.data?.products?.edges?.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    price: node.priceRange.minVariantPrice.amount,
    currency: node.priceRange.minVariantPrice.currencyCode,
  })) || [];
  return { products };
}

// Function definitions for the OpenAI API. These tell the model what
// capabilities are available and the JSON schema of their arguments.
const functions = [
  {
    name: 'find_product',
    description: 'Search for products based on a free‑form query string',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search string provided by the user for finding products',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_customer_orders',
    description: 'Retrieve recent orders for a customer by email address',
    parameters: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'The email address associated with the customer',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'get_products',
    description: 'Fetch a generic list of products when no specific search is provided',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// Map function names to their implementations
const functionMap = {
  find_product: findProduct,
  get_customer_orders: getCustomerOrders,
  get_products: getProducts,
};

// Initialize Express app
const app = express();
app.use(express.json());

/**
 * POST /chat
 *
 * Accepts a JSON body with a `message` field containing the user’s query.
 * Uses OpenAI’s Chat Completions API with our defined functions to decide
 * whether it can answer the question directly or needs to call one of the
 * functions. If the model requests a function call, this endpoint executes
 * the corresponding function and makes a second call to OpenAI to compose
 * a final answer. The result returned includes both the model’s reply and
 * any data fetched from Shopify.
 */
app.post('/chat', async (req, res) => {
  const userMessage = req.body?.message;
  if (!userMessage) {
    return res.status(400).json({ error: 'Request body must include a `message` field.' });
  }
  try {
    // Start a fresh conversation
    const messages = [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant for an ecommerce store powered by Shopify. You can look up products and customer orders using functions. Ask follow‑up questions when necessary and be concise.',
      },
      { role: 'user', content: userMessage },
    ];
    // Initial call to the model
    const first = await openai.chat.completions.create({
      model: 'gpt-4-1106-preview',
      messages,
      functions,
      function_call: 'auto',
    });
    const message = first.choices[0].message;
    if (message.function_call) {
      // Parse function call arguments
      const { name, arguments: args } = message.function_call;
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(args);
      } catch (err) {
        throw new Error(`Failed to parse function arguments: ${args}`);
      }
      const fn = functionMap[name];
      if (!fn) {
        throw new Error(`Function ${name} is not implemented.`);
      }
      // Execute the requested function
      const result = await fn(parsedArgs);
      // Append the assistant’s function call and our function response to the chat history
      messages.push(message);
      messages.push({
        role: 'function',
        name,
        content: JSON.stringify(result),
      });
      // Make a second call to get a final user‑friendly answer
      const second = await openai.chat.completions.create({
        model: 'gpt-4-1106-preview',
        messages,
      });
      const finalMsg = second.choices[0].message.content;
      return res.json({ reply: finalMsg, data: result });
    }
    // No function call; return the model’s direct answer
    return res.json({ reply: message.content });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Shopify agent server is running on port ${PORT}`);
});