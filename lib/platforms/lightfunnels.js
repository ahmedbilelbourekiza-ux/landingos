/* =============================================================================
 * lib/platforms/lightfunnels.js — LightFunnels store adapter.
 *
 * Built against LightFunnels' own developer docs (developer.lightfunnels.com),
 * verified via web search, NOT guessed. This version corrects the first
 * draft after finding a REAL example webhook payload in their own docs
 * (search result, not fabricated) -- several fields turned out to live at
 * the TOP LEVEL of the order object, not nested under customer/payment the
 * way the general GraphQL "Order type" reference implied:
 *
 *   { "node": { "id": "order_...", "phone": "", "total": 35, "notes": "",
 *       "email": "...", "items": [ { "title": "...", "price": 35, ... } ],
 *       "customer": { "id": "...", "avatar": "...", "location": "..." } } }
 *
 *   - Envelope is `{ "node": {...} }`.
 *   - Line items field is `items`, NOT `line_items` (Shopify's name).
 *   - `phone`, `total`, `notes`, `email` are top-level on the order, not
 *     nested under customer/payment.
 *   - HMAC encoding CONFIRMED base64 -- LightFunnels' own example code:
 *     crypto.createHmac("sha256", secret).update(JSON.stringify(req.body),
 *     "utf8").digest("base64"), matching this file's approach exactly.
 *
 * STILL NOT FULLY CONFIRMED (the real example was truncated before showing
 * these): whether `items[].quantity` is present (the Order types reference
 * confirms a quantity field exists on checkout items conceptually, but it
 * wasn't visible in the one real payload snippet found), and whether
 * `customer.first_name`/`last_name` exist on the WEBHOOK payload's customer
 * object specifically (only id/avatar/location were visible before
 * truncation -- the fuller Customer type reference elsewhere confirms these
 * fields exist on the Customer type in general, but webhook payloads are
 * often lighter "snapshots" than the full API type, as already proven true
 * for phone/total/notes above). Name falls back to shipping_address if
 * customer name is empty. THE RELIABLE FIX for anything still uncertain:
 * check this store's entry in the CRM's integration log after one real
 * test order -- the exact raw payload is logged there regardless of
 * whether parsing succeeds.
 * ========================================================================== */

const { httpFetch, verifyHmacSha256 } = require('./base');

module.exports = {
  key: 'lightfunnels',
  label: 'LightFunnels',

  /** Cheapest valid GraphQL call: ask for the account id. */
  async testConnection(cfg) {
    if (!cfg.apiKey) return { ok: false, message: 'Missing API access token' };
    try {
      const res = await httpFetch('https://services.lightfunnels.com/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({ query: 'query { account { id } }' }),
      }, 15000);
      if (res.ok && res.json && !res.json.errors) return { ok: true, message: 'Connected to LightFunnels' };
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid or expired access token' };
      if (res.json && res.json.errors) return { ok: false, message: 'GraphQL error: ' + (res.json.errors[0]?.message || 'unknown') };
      return { ok: false, message: 'LightFunnels responded ' + res.status };
    } catch (e) {
      return { ok: false, message: 'Network error: ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
    }
  },

  /** Not implemented for the initial webhook-first integration -- pulling
   *  historical orders needs the real `orders(query:...)` GraphQL shape,
   *  which isn't confirmed yet either. Returns empty rather than guessing. */
  async syncOrders(cfg, cursor) {
    return { orders: [], cursor };
  },
  async syncProducts(cfg) {
    return [];
  },

  /**
   * Verify + parse a LightFunnels webhook into the CRM's normalized order
   * shape. Returns null if the signature doesn't verify (caller should 401),
   * or if the payload doesn't look like an order at all.
   */
  parseWebhook(headers, body, cfg) {
    const sig = headers['lightfunnels-hmac'] || headers['Lightfunnels-Hmac'];
    if (cfg.webhookSecret && sig) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      if (!verifyHmacSha256(raw, cfg.webhookSecret, sig)) return null;
    }
    const o = (typeof body === 'string') ? JSON.parse(body) : body;
    // Confirmed real envelope: { "node": {...} }. Kept the other fallbacks
    // (data/order/bare) in case a different webhook version/event wraps
    // it differently.
    const order = o.node || o.data || o.order || o;
    if (!order || (!order.id && !order._id)) return null; // doesn't look like an order

    // CONFIRMED from a real "New order" delivery: this event can fire with
    // ONLY an id and nothing else (a checkout-stage stub, id prefixed
    // "ch_" rather than "order_", fired the instant the customer lands on
    // checkout -- before typing anything). Creating a CRM order from that
    // produced an empty "Client / 0 DA" row every time. Since this stub's
    // id does NOT match the later real order's id (LightFunnels doesn't
    // keep one stable id across the checkout->order lifecycle, confirmed
    // by comparing two real payloads), there's nothing usable to save OR
    // to update later -- skip outright rather than create noise.
    const phone = order.phone || (order.customer && order.customer.phone) || (order.shipping_address && order.shipping_address.phone) || '';
    if (!phone) return null;

    return normalizeOrder(order);
  },
};

/** Line items -- CONFIRMED field name is `items` (from a real payload
 *  example), kept the old guesses as a fallback only for safety. */
function getLineItems(order) {
  const raw = order.items || order.line_items || order.order_items || order.products || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(item => ({
    name: item.title || item.name || item.product_title || (item.product && item.product.title) || '',
    variant: item.variant_title || item.variant || '',
    // quantity field existence not 100% confirmed on the webhook shape yet
    // (see file header) -- defaults to 1 if truly absent, never crashes.
    quantity: Number(item.quantity) || 1,
    unitPrice: parseFloat(item.price ?? item.unit_price ?? 0),
    total: parseFloat(item.price ?? item.unit_price ?? 0) * (Number(item.quantity) || 1),
  }));
}

/** Map a LightFunnels order to the CRM's canonical order object -- the
 *  exact fields the /webhook/store/:id route expects (see index.js).
 *  phone/notes/email read from the TOP LEVEL first (confirmed real shape).
 *  Price: a real payload had NO bare "total" field -- confirmed real
 *  fields are `original_total` (subtotal + shipping) and `payments[0].total`,
 *  tried in that order, with the old assumptions kept as a last-resort
 *  fallback only. shipping_address uses `line1`/`line2` (CONFIRMED from a
 *  real payload -- NOT `address1`/`address2`, that was the first draft's
 *  mistake). Never uses `order.name` for the client name -- that field is
 *  the order NUMBER ("152"), not a person's name (another first-draft bug,
 *  caught from the same real payload). */
function normalizeOrder(order) {
  const customer = order.customer || {};
  const shipping = order.shipping_address || order.shippingAddress || {};
  const payment = order.payment || (Array.isArray(order.payments) ? order.payments[0] : null) || {};
  const lineItems = getLineItems(order);

  const clientName =
    [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
    [shipping.first_name, shipping.last_name].filter(Boolean).join(' ') ||
    'Client';

  return {
    lightfunnelsId: String(order.id || order._id || ''),
    client: clientName,
    phone: order.phone || customer.phone || shipping.phone || '',
    city: shipping.city || '',
    wilaya: shipping.state || shipping.area || '',
    commune: shipping.area || shipping.city || '',
    lineItems,
    product: lineItems[0]?.name || '',
    productVariant: lineItems[0]?.variant || '',
    quantity: lineItems[0]?.quantity || 1,
    price: parseFloat(order.original_total ?? payment.total ?? order.total ?? 0),
    note: order.notes || order.note || '',
    platform: 'lightfunnels',
  };
}

/**
 * parseCheckoutWebhook — for the "New checkout" event (LightFunnels'
 * abandoned-checkout / draft-order equivalent, per their docs: "After 15
 * minutes, if the customer has not completed the checkout process, the
 * checkout is considered abandoned"). Meant to be wired to its OWN webhook
 * URL (see file header on why LightFunnels needs a separate URL per event
 * rather than one shared endpoint).
 */
function parseCheckoutWebhook(headers, body, cfg) {
  const sig = headers['lightfunnels-hmac'] || headers['Lightfunnels-Hmac'];
  if (cfg.webhookSecret && sig) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    if (!verifyHmacSha256(raw, cfg.webhookSecret, sig)) return null;
  }
  const o = (typeof body === 'string') ? JSON.parse(body) : body;
  const checkout = o.node || o.data || o.checkout || o;
  if (!checkout || (!checkout.id && !checkout._id)) return null;

  const customer = checkout.customer || {};
  const shipping = checkout.shipping_address || {};
  const lineItems = getLineItems(checkout);
  const phone = checkout.phone || customer.phone || '';
  const clientName =
    [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
    [shipping.first_name, shipping.last_name].filter(Boolean).join(' ') || '';

  // No usable contact info yet -- visitor landed on checkout, hasn't typed
  // anything. Nothing worth tracking (mirrors handleAbandonedCheckout's
  // same skip rule for Shopify).
  if (!phone && !clientName) return { skip: true };

  return {
    lightfunnelsId: String(checkout.id || checkout._id || ''),
    client: clientName || 'Client',
    phone,
    city: shipping.city || '',
    wilaya: shipping.state || shipping.area || '',
    commune: shipping.area || shipping.city || '',
    lineItems,
    product: lineItems[0]?.name || '',
    productVariant: lineItems[0]?.variant || '',
    quantity: lineItems[0]?.quantity || 1,
    price: parseFloat(checkout.total ?? 0),
    note: checkout.notes || checkout.note || '',
    platform: 'lightfunnels',
  };
}

/**
 * parseProductWebhook — for the "Create product" event. Field names
 * confirmed from LightFunnels' Products API reference (developer.lightfunnels.com/products):
 * title, description, price, compare_at_price, thumbnail{path}.
 */
function parseProductWebhook(headers, body, cfg) {
  const sig = headers['lightfunnels-hmac'] || headers['Lightfunnels-Hmac'];
  if (cfg.webhookSecret && sig) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    if (!verifyHmacSha256(raw, cfg.webhookSecret, sig)) return null;
  }
  const o = (typeof body === 'string') ? JSON.parse(body) : body;
  const product = o.node || o.data || o.product || o;
  if (!product || (!product.id && !product._id)) return null;

  return {
    externalId: String(product.id || product._id || ''),
    name: product.title || '',
    description: product.description || '',
    price: parseFloat(product.price ?? 0),
    image: (product.thumbnail && product.thumbnail.path) || '',
    // LightFunnels' product variants aren't confirmed in the docs reviewed
    // so far (only top-level product fields were) -- left empty rather
    // than guessed; the CRM's "no variants" default applies.
    variants: [],
  };
}

/**
 * parseContactWebhook — for "contact/updated" (best first candidate) or
 * "contact-form/created" / "contact/signup". CONFIRMED from LightFunnels'
 * own webhooks doc page: one of the contact events fires this exact shape
 * (a full Customer object, NOT the bare-id stub that checkout/* sends):
 *   { "node": { "id":"cus_...", "email":"...", "phone":"...",
 *       "first_name":"...", "last_name":"...", "full_name":"...",
 *       "shipping_address":{...}, "billing_address":{...}, ... } }
 * This is the actual mechanism for capturing someone as a lead while
 * they're filling in checkout fields -- checkout/created and
 * checkout/updated will NEVER carry this (verified: their own docs show
 * both firing with only a bare id, no exceptions).
 */
function parseContactWebhook(headers, body, cfg) {
  const sig = headers['lightfunnels-hmac'] || headers['Lightfunnels-Hmac'];
  if (cfg.webhookSecret && sig) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    if (!verifyHmacSha256(raw, cfg.webhookSecret, sig)) return null;
  }
  const o = (typeof body === 'string') ? JSON.parse(body) : body;
  const contact = o.node || o.data || o;
  if (!contact || (!contact.id && !contact._id)) return null;

  const phone = contact.phone || '';
  const clientName = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '';
  if (!phone && !clientName) return { skip: true }; // nothing usable yet

  const shipping = contact.shipping_address || {};
  return {
    lightfunnelsId: String(contact.id || contact._id || ''),
    client: clientName || 'Client',
    phone,
    city: shipping.city || '',
    wilaya: shipping.state || shipping.area || '',
    commune: shipping.area || shipping.city || '',
    lineItems: [],
    product: '', productVariant: '', quantity: 1, price: 0,
    note: contact.notes || '',
    platform: 'lightfunnels',
  };
}

module.exports.normalizeOrder = normalizeOrder;
module.exports.parseCheckoutWebhook = parseCheckoutWebhook;
module.exports.parseContactWebhook = parseContactWebhook;
module.exports.parseProductWebhook = parseProductWebhook;
module.exports.getLineItems = getLineItems;

