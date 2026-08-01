/* =============================================================================
 * lib/providers/base.js — The delivery-provider adapter contract.
 *
 * Every carrier (Ecom, Yalidine, ZR, Noest, DHL, …) implements this shape so the
 * CRM never needs to know carrier-specific details. Add a new carrier = add one
 * file in lib/providers/ exporting an object that matches ADAPTER_SHAPE, then
 * reference its key in the providers.adapter column.
 *
 * Each method receives the provider's secret config (apiUrl/apiKey/secretKey/
 * customFields) — never the masked public form — so adapters stay self-contained.
 * ========================================================================== */

const { mapStatus } = require('../statusMap');

/**
 * @typedef {Object} ProviderConfig  — secret, server-side only
 * @property {string} code
 * @property {string} apiUrl
 * @property {string} apiKey
 * @property {string} secretKey
 * @property {string} webhookUrl
 * @property {Object} customFields
 *
 * @typedef {Object} ShipmentInput — derived from a confirmed order
 * @property {Object} order          — the CRM order object
 * @property {string} trackingHint   — optional pre-existing tracking number
 *
 * @typedef {Object} ShipmentResult
 * @property {string} trackingNumber
 * @property {string} [providerShipmentId]
 * @property {string} [providerReference]
 * @property {string} [labelUrl]
 * @property {string} [originalStatus]
 * @property {string} [description]
 * @property {Object} raw
 *
 * @typedef {Object} TrackingEvent
 * @property {number} eventTime      — epoch ms
 * @property {string} originalStatus
 * @property {string} description
 * @property {Object} raw
 */

const ADAPTER_SHAPE = {
  /** Stable key matching providers.adapter. */
  key: 'string',
  /** Human label for the admin UI. */
  label: 'string',
  /** Whether this adapter can create parcels outbound (true) or only receive
   *  status updates via webhook (false, e.g. zr-webhook). */
  canCreateOutbound: false,
  /** Provider-specific native status string → CRM status map. */
  statusMap: {},
  /**
   * Create a shipment at the provider. Throws on failure.
   * @returns {Promise<ShipmentResult>}
   */
  async createShipment(input, cfg) { throw new Error('createShipment not implemented'); },
  /**
   * Pull the full tracking history for a tracking number. Throws on failure.
   * @returns {Promise<TrackingEvent[]>}
   */
  async getTracking(trackingNumber, cfg) { throw new Error('getTracking not implemented'); },
  /**
   * Parse an inbound webhook payload into one TrackingEvent.
   * @returns {TrackingEvent | TrackingEvent[] | null}
   */
  parseWebhook(headers, body, cfg) { return null; },
  /** Normalize a raw provider status using this adapter's statusMap. */
  mapStatus(originalStatus) { return mapStatus(originalStatus, this.statusMap); },
};

/**
 * Derive a compact ShipmentInput from an order. Centralized so every adapter
 * receives a consistent payload even if the order schema evolves.
 */
function buildShipmentInput(order) {
  return {
    order,
    trackingHint: order.trackingNumber || '',
    client: {
      name: order.client || '',
      phone: order.phone || '',
      wilaya: order.wilaya || '',
      commune: order.commune || '',
      city: order.city || order.commune || '',
      address: [order.commune, order.wilaya].filter(Boolean).join(', '),
    },
    parcel: {
      product: order.product || '',
      variant: order.productVariant || '',
      quantity: order.quantity || 1,
      price: order.price || 0,
      cod: (order.deliveryMethod || 'COD').toUpperCase() === 'COD' ? (order.price || 0) : 0,
      note: order.shippingNote || order.note || '',
      express: !!order.expressDelivery,
    },
  };
}

/** Small fetch helper with timeout, used by real outbound adapters later. */
async function httpFetch(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { ADAPTER_SHAPE, buildShipmentInput, httpFetch };
