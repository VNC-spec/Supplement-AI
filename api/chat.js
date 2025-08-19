const { OpenAI } = require('openai');
const fetch = require('node-fetch');

// Initialize OpenAI client with secret key
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Shopify credentials from environment
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

// Helper to call Shopify's GraphQL Admin API
async function callShopify(query, variables = {}) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2025-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

// Search products by query string
async function findProduct({ query }) {
  const gql = `
    query($query: String!) {
      products(first: 5, query: $query) {
        edges {
          node {
            id
            title
            description
            images(first: 1) { edges { node { url altText } } }
            priceRange { minVariantPrice { amount currencyCode } }
          }
        }
      }
    }
  `;
  const data = await callShopify(gql, { query });
  const edges = data?.products?.edges || [];
  return edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    image: node.images.edges[0]?.node || null,
    price: node.priceRange.minVariantPrice.amount,
    currency: node.priceRange.minVariantPrice.currencyCode,
  }));
}

// Get recent orders for a customer by email
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
                  totalPriceSet { shopMoney { amount currencyCode } }
                  fulfillments(first: 1) {
                    status
                    estimatedDeliveryAt
                    trackingInfo(first: 5) { company number url }
                  }
                  lineItems(first: 5) {
                    edges { node { title quantity } }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await callShopify(gql, { email });
  const customer = data?.customers?.edges?.[0]?.node;
  if (!customer) {
    return [];
  }
  return customer.orders.edges.map(({ node: order }) => ({
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
  }));
}

// Fetch a simple list of products
async function getProducts() {
  const gql = `
    query {
      products(first: 5) {
        edges { node { id title } }
      }
    }
  `;
  const data = await callShopify(gql);
  const edges = data?.products?.edges || [];
  return edges.map(({ node }) => ({ id: node.id, title: node.title }));
}

// Map function names to implementations
const functionMap = {
  find_product: findProduct,
  get_customer_orders: getCustomerOrders,
  get_products: getProducts,
};

// Define function signatures for OpenAI
const functions = [
  {
    name: 'find_product',
    description: 'Search Shopify products by query string.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_customer_orders',
    description: 'Retrieve recent orders for a customer by email address.',
    parameters: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
  },
  {
    name: 'get_products',
    description: 'Fetch a simple list of products when no search query is provided.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// Helper to call OpenAI with optional function execution
async function runAssistant(message) {
  // First call to decide on function
  const first = await openai.chat.completions.create({
    model: 'gpt-4-0613',
    messages: [
      { role: 'system', content: 'You are a helpful AI assistant for a Shopify store.' },
      { role: 'user', content: message },
    ],
    functions,
    function_call: 'auto',
  });
  const reply = first.choices[0].message;
  if (reply.function_call) {
    const { name, arguments: args } = reply.function_call;
    const fn = functionMap[name];
    const parsedArgs = args ? JSON.parse(args) : {};
    const data = await fn(parsedArgs);
    // Second call with function result
    const second = await openai.chat.completions.create({
      model: 'gpt-4-0613',
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant for a Shopify store.' },
        { role: 'user', content: message },
        reply,
        { role: 'function', name, content: JSON.stringify(data) },
      ],
    });
    return { reply: second.choices[0].message.content, data };
  }
  return { reply: reply.content };
}

// Export as Vercel serverless function
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const { message } = req.body || {};
    if (typeof message !== 'string' || !message) {
      res.status(400).json({ error: 'Request body must include a `message` string.' });
      return;
    }
    const result = await runAssistant(message);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
