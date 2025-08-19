# Shopify AI Chat Agent

This project provides a minimal proof‑of‑concept for an AI agent that can chat
with customers on a Shopify store.  It uses the OpenAI Chat Completions API with
function calling to fetch information from your Shopify store via the GraphQL
Admin API.  The agent can search products, list recent products and retrieve
customer orders (including tracking numbers and fulfillment status).

## Features

* **Natural‑language chat** powered by OpenAI.
* **Function calling**: the model knows when to call one of your predefined
  functions (e.g. `find_product`, `get_customer_orders`, `get_products`).
* **Shopify integration**: functions query your store using the GraphQL Admin
  API to return real data.
* **Express server** with a `/chat` endpoint that accepts a user message and
  returns a model reply plus any data fetched.

## Prerequisites

1. **Node.js** and **npm** must be installed.  This repo has been tested with
   Node 22 and npm 10.
2. A **Shopify custom app** with the following scopes:
   * `read_products` – to access product data.
   * `read_orders` – to access recent orders (by default only the last 60 days).
     Request `read_all_orders` if you need older orders.
   * Optionally `read_inventory` if you plan to extend the agent to check
     inventory levels.
3. An **Admin API access token** for your custom app.
4. An **OpenAI API key** with access to `gpt-4-1106-preview` or another model
   that supports function calling.

## Setup

1. Clone or copy this directory to your machine.
2. Install dependencies:

   ```bash
   cd shopify-agent
   npm install
   ```

3. Copy the environment template and fill in your credentials:

   ```bash
   cp .env.example .env
   # then edit .env with your editor
   ```

   * `OPENAI_API_KEY` – your OpenAI API key.
   * `SHOPIFY_STORE` – your store domain (e.g. `my‑shop.myshopify.com`).
   * `SHOPIFY_TOKEN` – the admin API token generated when you installed the
     custom app.
   * `PORT` – optional HTTP port (defaults to 3000).

4. Start the server:

   ```bash
   node index.js
   ```

   You should see `Shopify agent server is running on port 3000` in the
   console.

## Usage

Send a POST request to `http://localhost:3000/chat` with a JSON body
containing a `message` field.  For example using `curl`:

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "I would like to see products with \"coffee\" in the name"}'
```

The server will forward your message to OpenAI.  If the model decides it
needs to call one of the functions, it will automatically execute it, fetch
data from Shopify and then compose a final answer.  The JSON response
includes:

* `reply` – the assistant’s natural‑language reply.
* `data` – the raw data returned from the function (products or orders).

## Extending

This is a basic starting point.  You can extend it by:

* Adding more functions, such as `get_inventory_level` or `return_policy`.
* Using [Shopify Flow](https://apps.shopify.com/flow) for automated tasks
  like tagging orders or sending follow‑up emails【663140302541513†L250-L259】.
* Connecting to carrier APIs or using Shopify’s fulfillment `trackingInfo`
  fields to provide live shipment updates【334099776577176†L3415-L3419】.
* Integrating with a front‑end web chat widget or Shopify Inbox.

## Important notes

* **Security**: never expose your API keys or tokens.  Keep them in
  environment variables and do not commit them to version control.
* **Data access**: only request API scopes you truly need.  Shopify may
  restrict access if your app doesn’t have a legitimate use for order data【334099776577176†L152-L223】.
* **Function limits**: the current implementation returns at most five
  products or orders.  Adjust the GraphQL `first:` values if you need more.

Happy coding!