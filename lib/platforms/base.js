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

/* =============================================================================
 * webhookSignatureOk — the ONE place that decides whether an inbound webhook is
 * trustworthy (audit SEC-04).
 *
 * Every adapter previously wrote its own variant of
 *     if (cfg.webhookSecret && sig) { ...verify... }
 * which fails OPEN twice over: with no secret configured nothing is checked,
 * and — far worse — an attacker who simply OMITS the signature header skips
 * verification entirely. Store ids are visible in the admin UI and embedded in
 * the public checkout-page lead-capture snippet, so POST /webhook/store/:id was
 * effectively an open order-injection endpoint: forged orders auto-assigned to
 * a real agent, reserved stock, and could trigger real shipment creation at the
 * carrier.
 *
 * The rule now:
 *   - A secret IS configured  -> a valid signature is REQUIRED. A missing or
 *                               wrong header is rejected. This is the bypass fix.
 *   - No secret configured    -> accepted, but flagged as unverified so the
 *                               caller can log it. Rejecting outright would
 *                               break every live integration that has not had a
 *                               secret set yet.
 *   - REQUIRE_WEBHOOK_SIGNATURES=1 -> unsigned webhooks are refused as well.
 *                               This is the recommended production setting once
 *                               every store and carrier has a secret.
 *
 * @returns {{ok:boolean, verified:boolean, reason:string}}
 * ========================================================================== */
function webhookSignatureOk({ rawBody, secret, signature }) {
  const strict = /^(1|true|yes)$/i.test(String(process.env.REQUIRE_WEBHOOK_SIGNATURES || ''));

  if (!secret) {
    return strict
      ? { ok: false, verified: false, reason: 'no webhook secret configured and REQUIRE_WEBHOOK_SIGNATURES is on' }
      : { ok: true, verified: false, reason: 'no webhook secret configured — payload accepted unverified' };
  }
  if (!signature) {
    // The bypass. Previously this branch skipped verification and accepted.
    return { ok: false, verified: false, reason: 'signature header missing but a secret is configured' };
  }
  if (!verifyHmacSha256(rawBody, secret, signature)) {
    return { ok: false, verified: false, reason: 'signature did not match' };
  }
  return { ok: true, verified: true, reason: 'signature verified' };
}

module.exports = { ADAPTER_SHAPE, httpFetch, verifyHmacSha256, webhookSignatureOk };
