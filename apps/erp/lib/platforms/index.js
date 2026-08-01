/* =============================================================================
 * lib/platforms/index.js — Store-platform registry.
 *
 * Resolves the right adapter for a platform token (shopify, lightfunnels, …).
 * Platforms without a registered adapter fall back to a generic stub that does
 * structural credential validation only — so the CRM works for any platform out
 * of the box, and gains real API behavior when an adapter is added.
 * ========================================================================== */

const { httpFetch, verifyHmacSha256 } = require('./base');

// Registered platform adapters. To add support for a new ecommerce platform,
// create lib/platforms/<platform>.js exporting an adapter and add it here.
const adapters = {
  shopify: require('./shopify'),
  lightfunnels: require('./lightfunnels'),
};

// All selectable platform tokens for the UI dropdown, with human labels.
const ALL_PLATFORMS = [
  { key: 'shopify',      label: 'Shopify' },
  { key: 'lightfunnels', label: 'LightFunnels' },
  { key: 'justsell',     label: 'JustSell' },
  { key: 'ayor',         label: 'Ayor' },
  { key: 'woocommerce',  label: 'WooCommerce' },
  { key: 'ecwid',        label: 'Ecwid' },
  { key: 'magento',      label: 'Magento' },
  { key: 'bigcommerce',  label: 'BigCommerce' },
  { key: 'custom',       label: 'Custom / Other' },
];

const GENERIC = {
  key: 'generic',
  label: 'Generic',
  // Structural validation only — enough config to be usable?
  async testConnection(cfg) {
    const ok = !!(cfg.apiUrl && (cfg.apiKey || cfg.apiSecret));
    return { ok, message: ok ? 'Credentials present (generic validation)' : 'Missing API URL or credentials' };
  },
  async syncOrders() { return { orders: [], cursor: null }; },
  async syncProducts() { return []; },
  parseWebhook() { return null; },
};

function getAdapter(platformKey) {
  return adapters[platformKey] || GENERIC;
}
function listPlatforms() { return ALL_PLATFORMS; }
function isRegistered(platformKey) { return !!adapters[platformKey]; }

module.exports = { getAdapter, listPlatforms, isRegistered, GENERIC };
