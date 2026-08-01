/* =============================================================================
 * lib/providers/zr-webhook.js — ZR Express (and Maystro-style) inbound adapter.
 *
 * This matches the existing /webhook/delivery contract that was already in the
 * CRM: ZR/Maystro POST { trackingNumber, status, orderId }. This adapter is
 * INBOUND-ONLY — it can't create parcels outbound — so when an order is
 * confirmed the CRM records the shipment row but expects the tracking number to
 * arrive later via webhook (or be entered manually by the agent).
 *
 * When you provide the real ZR/Yalidine/Noest outbound API docs + keys, a new
 * adapter file replaces the "generic" outbound behavior with real createShipment.
 * ========================================================================== */

const { mapStatus } = require('../statusMap');

// ZR / Maystro commonly used status labels → CRM status. Extend as real values
// are confirmed from the carrier's documentation.
const STATUS_MAP = {
  'création': 'created',
  'creation': 'created',
  'créé': 'created',
  'dispatché': 'dispatched',
  'dispatche': 'dispatched',
  'en route': 'in_transit',
  'en transit': 'in_transit',
  'au bureau': 'at_office',
  'bureau': 'at_office',
  'sorti en livraison': 'out_for_delivery',
  'en livraison': 'out_for_delivery',
  'livré': 'delivered',
  'livre': 'delivered',
  'delivered': 'delivered',
  'refusé': 'refused',
  'refuse': 'refused',
  'refus': 'refused',
  'retour': 'returned',
  'retourné': 'returned',
  'annulé': 'cancelled',
  'annule': 'cancelled',
  'cancel': 'cancelled',
};

module.exports = {
  key: 'zr-webhook',
  label: 'ZR Express / Maystro (webhook in)',
  canCreateOutbound: false,        // tracking numbers come from the carrier
  statusMap: STATUS_MAP,

  // Inbound-only adapter: "connection" means a webhook receiver is configured.
  async testConnection(cfg) {
    if (!cfg.webhookUrl) {
      return { ok: false, message: 'No webhook URL configured — set the inbound webhook so the carrier can push updates' };
    }
    return { ok: true, message: 'Webhook receiver configured (inbound-only adapter)', mode: 'webhook' };
  },
  // No outbound parcel creation. Shipment row is created on confirm and the
  // tracking number is attached when the first webhook arrives (or manually).
  async createShipment(input, cfg) {
    throw new Error('zr-webhook adapter does not create shipments outbound — awaiting tracking number from carrier');
  },

  // No polling endpoint documented for this adapter; relies on webhooks.
  async getTracking(trackingNumber, cfg) {
    return [];
  },

  parseWebhook(headers, body, cfg) {
    const b = body || {};
    const trackingNumber = b.trackingNumber || b.tracking_number || b.code_suivi || '';
    const status = b.status || b.deliveryStatus || b.etat || '';
    if (!trackingNumber && !status) return null;
    return {
      eventTime: b.eventTime || b.timestamp || Date.now(),
      trackingNumber,
      originalStatus: status,
      crmStatus: mapStatus(status, STATUS_MAP),
      description: b.description || b.message || status || '',
      raw: { inbound: true, body: b, headers: pickHeaders(headers) },
    };
  },
};

function pickHeaders(h) {
  if (!h) return {};
  const out = {};
  for (const k of ['x-provider', 'x-webhook-source', 'user-agent', 'x-event-type']) {
    if (h[k] !== undefined) out[k] = h[k];
  }
  return out;
}
