/* =============================================================================
 * lib/platforms/base.js — Store-platform adapter contract.
 *
 * The CRM must support ANY ecommerce platform (Shopify, LightFunnels, JustSell,
 * Ayor, WooCommerce, Ecwid, Magento, BigCommerce, custom, …) without hardcoding
 * any of them. Each platform implements this shape; the CRM calls the generic
 * methods and never knows platform specifics.
 *
 * Adding a platform = add one file in lib/platforms/ exporting an object that
 * matches ADAPTER_SHAPE, then register it in lib/platforms/index.js.
 * ========================================================================== */

const ADAPTER_SHAPE = {
  key: 'string',                       // platform token: shopify | lightfunnels | …
  label: 'string',
  /** Validate the store's credentials by calling the platform API. */
  async testConnection(cfg) { throw new Error('testConnection not implemented'); },
  /** Pull orders since a cursor/timestamp. @returns {Promise<{orders, cursor}>} */
  async syncOrders(cfg, cursor) { throw new Error('syncOrders not implemented'); },
  /** Pull products. @returns {Promise<products[]>} */
  async syncProducts(cfg) { throw new Error('syncProducts not implemented'); },
  /** Transform an inbound webhook payload into a normalized order object. */
  parseWebhook(headers, body, cfg) { return null; },
};

/** Shared fetch helper with timeout + HMAC verification support. */
async function httpFetch(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, text, json, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

/** Verify an HMAC-SHA256 signature (used by Shopify & many platforms). */
function verifyHmacSha256(body, secret, signature) {
  const crypto = require('crypto');
  const computed = crypto.createHmac('sha256', secret).update(body).digest('base64');
  // timing-safe-ish comparison
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

module.exports = { ADAPTER_SHAPE, httpFetch, verifyHmacSha256 };
