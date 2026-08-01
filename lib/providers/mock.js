/* =============================================================================
 * lib/providers/mock.js — Reference adapter that simulates a real carrier.
 *
 * Proves the entire delivery workflow end-to-end without external dependencies:
 * createShipment() returns a tracking number immediately, and each subsequent
 * getTracking() advances the parcel one step along the lifecycle (created →
 * dispatched → in_transit → at_office → out_for_delivery → delivered).
 *
 * Progress is held in-memory keyed by tracking number; that's intentional — a
 * mock carrier has no persistence and is meant for demo/staging. Real adapters
 * query the carrier's actual API instead.
 * ========================================================================== */

const { buildShipmentInput, httpFetch } = require('./base');

// Lifecycle steps the mock walks through. Matches the universal CRM statuses.
const PIPELINE = [
  { crm: 'created',          label: 'Création',           desc: 'Colis enregistré chez le transporteur' },
  { crm: 'dispatched',       label: 'Dispatché',          desc: 'Colis dispatché vers le hub régional' },
  { crm: 'in_transit',       label: 'En route',           desc: 'Colis en route vers la wilaya de destination' },
  { crm: 'at_office',        label: 'Au bureau',          desc: 'Colis arrivé au bureau de destination' },
  { crm: 'out_for_delivery', label: 'Sorti en livraison', desc: 'Colis sorti en livraison' },
  { crm: 'delivered',        label: 'Livré',              desc: 'Colis livré au client' },
];

const state = new Map();   // trackingNumber -> step index reached so far

module.exports = {
  key: 'mock',
  label: 'Mock Carrier (simulation)',
  canCreateOutbound: true,
  statusMap: {},           // mock already speaks CRM statuses directly

  // The mock carrier is always reachable — Test Connection always succeeds.
  async testConnection(cfg) {
    return { ok: true, message: 'Mock carrier is online (simulation)', latencyMs: 12 };
  },
  async createShipment(input, cfg) {
    const { order } = buildShipmentInput(input.order);
    // Deterministic-ish but unique tracking number.
    const trackingNumber = 'MOCK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    state.set(trackingNumber, 0);   // start at "created"
    return {
      trackingNumber,
      providerShipmentId: 'SHP-' + trackingNumber,
      providerReference: order.id || '',
      labelUrl: '',
      originalStatus: PIPELINE[0].label,
      description: PIPELINE[0].desc,
      raw: { mock: true, created: true, client: order.client },
    };
  },

  async getTracking(trackingNumber, cfg) {
    const idx = state.has(trackingNumber) ? state.get(trackingNumber) : 0;
    // Advance one step on each poll, but never beyond delivered.
    const nextIdx = Math.min(idx + 1, PIPELINE.length - 1);
    state.set(trackingNumber, nextIdx);

    // Return every step from creation up to the current one — the polling job
    // dedupes against already-stored events, so re-reporting history is safe
    // and means a fresh shipment shows its full timeline after a poll or two.
    const now = Date.now();
    const events = [];
    for (let i = 0; i <= nextIdx; i++) {
      const step = PIPELINE[i];
      events.push({
        // Stagger times so the timeline looks natural (each step ~ a few hours apart).
        eventTime: now - (nextIdx - i) * 3 * 3600 * 1000,
        originalStatus: step.label,
        crmStatus: step.crm,
        description: step.desc,
        raw: { mock: true, step: i },
      });
    }
    return events;
  },

  parseWebhook(headers, body, cfg) {
    // The mock carrier has no real webhook; accept a simple shape for testing.
    const b = body || {};
    if (!b.trackingNumber) return null;
    const step = PIPELINE.find(s => s.crm === b.status || s.label === b.status) || PIPELINE[0];
    return {
      eventTime: b.eventTime || Date.now(),
      originalStatus: step.label,
      crmStatus: step.crm,
      description: step.desc,
      raw: { mock: true, webhook: true, body: b },
    };
  },
};
