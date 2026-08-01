/* =============================================================================
 * lib/platforms/shopify.js — Shopify store adapter.
 *
 * This is the ONE concrete platform adapter (Shopify was already integrated via
 * webhooks); it sits behind the generic platform contract so the CRM treats it
 * like any other platform. Adding LightFunnels/JustSell/Ayor/WooCommerce/etc.
 * later means adding a sibling file — nothing in the core needs to change.
 * ========================================================================== */

const { httpFetch, verifyHmacSha256, webhookSignatureOk } = require('./base');

module.exports = {
  key: 'shopify',
  label: 'Shopify',

  /**
   * Validate Shopify credentials by hitting the Shop endpoint.
   * cfg: { apiUrl (e.g. https://store.myshopify.com), apiKey, apiSecret }
   */
  async testConnection(cfg) {
    if (!cfg.apiUrl) return { ok: false, message: 'Missing API URL (store domain)' };
    const base = cfg.apiUrl.replace(/\/$/, '');
    // The /admin/api/<version>/shop.json endpoint requires an access token via
    // the X-Shopify-Access-Token header. apiKey holds the access token here.
    const url = `${base}/admin/api/2024-04/shop.json`;
    try {
      const res = await httpFetch(url, {
        headers: {
          'X-Shopify-Access-Token': cfg.apiKey || '',
          'Content-Type': 'application/json',
        },
      }, 15000);
      if (res.ok && res.json && res.json.shop) {
        return { ok: true, message: `Connected to ${res.json.shop.name || 'store'}` };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Authentication failed (invalid access token)' };
      }
      return { ok: false, message: `Shopify responded ${res.status}` };
    } catch (e) {
      return { ok: false, message: 'Network error: ' + e.message };
    }
  },

  /** Pull recent orders since a cursor (created_at_min). */
  async syncOrders(cfg, cursor) {
    if (!cfg.apiUrl) return { orders: [], cursor: null };
    const base = cfg.apiUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ limit: '250', status: 'any' });
    if (cursor) params.set('created_at_min', cursor);
    const url = `${base}/admin/api/2024-04/orders.json?${params}`;
    const res = await httpFetch(url, {
      headers: { 'X-Shopify-Access-Token': cfg.apiKey || '', 'Content-Type': 'application/json' },
    }, 30000);
    if (!res.ok) throw new Error(`Shopify orders sync failed: ${res.status}`);
    const orders = (res.json && res.json.orders) || [];
    return { orders, cursor: orders.length ? new Date().toISOString() : cursor };
  },

  async syncProducts(cfg) {
    if (!cfg.apiUrl) return [];
    const base = cfg.apiUrl.replace(/\/$/, '');
    const url = `${base}/admin/api/2024-04/products.json?limit=250`;
    const res = await httpFetch(url, {
      headers: { 'X-Shopify-Access-Token': cfg.apiKey || '', 'Content-Type': 'application/json' },
    }, 30000);
    if (!res.ok) throw new Error(`Shopify products sync failed: ${res.status}`);
    return (res.json && res.json.products) || [];
  },

  /**
   * Verify + parse a Shopify webhook into a normalized order shape.
   * Returns null if the signature doesn't verify (caller should 401).
   */
  parseWebhook(headers, body, cfg) {
    const sig = headers['x-shopify-hmac-sha256'];
    // Fail CLOSED — see webhookSignatureOk in ./base.js (audit SEC-04).
    if (!webhookSignatureOk({
      rawBody: typeof body === 'string' ? body : JSON.stringify(body),
      secret: cfg.webhookSecret, signature: sig,
    }).ok) return null;
    const topic = headers['x-shopify-topic'] || '';
    // Only order creation is normalized here; other topics can be extended.
    if (!topic.startsWith('orders/')) return null;
    const o = (typeof body === 'string') ? JSON.parse(body) : body;
    return normalizeOrder(o);
  },
};

/** Map a Shopify order to the CRM's canonical order object. */
function normalizeOrder(order) {
  const billing = order.billing_address || {};
  const shipping = order.shipping_address || {};
  const addr = shipping.address1 ? shipping : billing;
  const lineItems = (order.line_items || []).map(item => ({
    name: item.name,
    variant: item.variant_title || '',
    quantity: item.quantity || 1,
    unitPrice: parseFloat(item.price || 0),
    total: parseFloat(item.price || 0) * (item.quantity || 1),
  }));
  return {
    shopifyId: String(order.id),
    shopifyName: order.name || '',
    client: addr.name || billing.name || order.email || 'Client',
    phone: order.phone || billing.phone || shipping.phone || '',
    city: addr.city || '',
    wilaya: addr.province || '',
    commune: addr.city || '',
    lineItems,
    product: lineItems[0]?.name || '',
    quantity: lineItems[0]?.quantity || 1,
    price: parseFloat(order.total_price || 0),
    note: order.note || '',
    financialStatus: order.financial_status || '',
    fulfillmentStatus: order.fulfillment_status || '',
    platform: 'shopify',
  };
}

module.exports.normalizeOrder = normalizeOrder;
