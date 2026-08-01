/* =============================================================================
 * lib/providers/index.js — Provider registry + shipment service.
 * ========================================================================== */

const db = require('../db');
const { shouldNotify, CRM_STATUS_LABEL, mapStatus: mapStatusFallback } = require('../statusMap');

const rawAdapters = {
  mock:        require('./mock'),
  'zr-webhook':require('./zr-webhook'),
  'zr':        require('./zr'),
  'ecom':      require('./ecom'),
  generic:     require('./mock'),
};

/* Every adapter must answer the full ADAPTER_SHAPE contract (see ./base.js),
 * but that shape is a documentation object — it was never actually merged into
 * anything, so an adapter that simply forgot a member produced a TypeError at
 * the call site instead of a sensible default. mock.js never defined
 * mapStatus(), and because getAdapter() falls back to mock for any key without
 * an implementation, EVERY unimplemented carrier in the admin dropdown
 * (yalidine, noest, ems, dhl, ups, fedex, aramex) crashed shipment creation
 * with "adapter.mapStatus is not a function" — silently, since the caller
 * catches and logs. Filling the contract in one place here fixes all of them
 * at once and stops the same class of bug for any adapter added later. */
const ADAPTER_DEFAULTS = {
  canCreateOutbound: false,
  statusMap: {},
  async createShipment() { throw new Error('createShipment is not implemented by this adapter'); },
  async getTracking() { return []; },
  parseWebhook() { return null; },
  mapStatus(originalStatus) { return mapStatusFallback(originalStatus, this.statusMap || {}); },
};

const adapters = Object.fromEntries(
  Object.entries(rawAdapters).map(([key, a]) => [key, { ...ADAPTER_DEFAULTS, ...a }])
);

const ALL_ADAPTER_KEYS = [
  { key: 'mock',        label: 'Mock Carrier (simulation)' },
  { key: 'zr-webhook',  label: 'ZR Express / Maystro (webhook in, ancienne méthode)' },
  { key: 'zr',          label: 'ZR Express (Algérie)' },
  { key: 'ecom',        label: 'Ecom Delivery (Algérie)' },
  { key: 'generic',     label: 'Generic / Custom API' },
  { key: 'yalidine',    label: 'Yalidine' },
  { key: 'noest',       label: 'Noest' },
  { key: 'ems',         label: 'EMS' },
  { key: 'dhl',         label: 'DHL' },
  { key: 'ups',         label: 'UPS' },
  { key: 'fedex',       label: 'FedEx' },
  { key: 'aramex',      label: 'Aramex' },
];

function getAdapter(adapterKey) { return adapters[adapterKey] || adapters.generic; }
function listAdapterKeys() { return ALL_ADAPTER_KEYS; }

function resolveProvider(idOrCode) {
  const cfg = db.getProviderSecrets(idOrCode);
  if (!cfg) return null;
  if (!cfg.active) return null;
  return { cfg, adapter: getAdapter(cfg.adapter) };
}

async function createShipmentForOrder(order, opts = {}) {
  const actor = opts.actor || 'system';
  const existing = db.getShipmentByOrder(order.id);
  if (existing) return existing;

  let resolved = null;
  if (order.providerId) resolved = resolveProvider(order.providerId);
  if (!resolved && order.delivery) resolved = resolveProvider(order.delivery);
  if (!resolved) resolved = resolveProvider(db.getDefaultProvider()?.code);
  if (!resolved) {
    const err = new Error('No active delivery provider configured');
    err.code = 'NO_PROVIDER';
    throw err;
  }

  const { cfg, adapter } = resolved;
  const shipmentId = 'SHP-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

  let shipment;
  if (adapter.canCreateOutbound) {
    const result = await adapter.createShipment({ order }, cfg);
    shipment = db.saveShipment({
      id: shipmentId, orderId: order.id, providerId: cfg.id,
      trackingNumber: result.trackingNumber || '',
      providerShipmentId: result.providerShipmentId || '',
      providerReference: result.providerReference || '',
      crmStatus: adapter.mapStatus(result.originalStatus) || 'created',
      originalStatus: result.originalStatus || '',
      labelUrl: result.labelUrl || '',
      raw: result.raw || {},
      createdAt: Date.now(),
    });
    db.appendEvent({
      shipmentId: shipment.id, eventTime: Date.now(),
      originalStatus: result.originalStatus || 'Création',
      crmStatus: shipment.crmStatus,
      description: result.description || 'Shipment created at provider',
      raw: { source: 'createShipment', ...(result.raw || {}) },
    });
  } else {
    shipment = db.saveShipment({
      id: shipmentId, orderId: order.id, providerId: cfg.id,
      trackingNumber: order.trackingNumber || '',
      crmStatus: order.trackingNumber ? 'created' : 'pending',
      originalStatus: order.trackingNumber ? 'Création' : '',
      raw: { adapter: cfg.adapter, awaitingTracking: !order.trackingNumber },
      createdAt: Date.now(),
    });
    if (order.trackingNumber) {
      db.appendEvent({
        shipmentId: shipment.id, eventTime: Date.now(),
        originalStatus: 'Création', crmStatus: 'created',
        description: 'Tracking number recorded — awaiting carrier updates',
        raw: { source: 'manual-tracking' },
      });
    }
  }

  db.patchOrder(order.id, {
    shipmentId: shipment.id, providerId: cfg.id,
    trackingNumber: shipment.trackingNumber || order.trackingNumber || '',
  });
  db.audit('shipment', shipment.id, 'create', actor, { orderId: order.id, provider: cfg.code });
  return db.getShipment(shipment.id);
}

function ingestTrackingEvents(shipment, events, broadcaster, opts = {}) {
  if (!shipment || !Array.isArray(events) || events.length === 0) return [];

  const adapter = getAdapter(db.getProviderSecrets(shipment.providerId)?.adapter);
  const inserted = [];
  let latest = null;

  for (const ev of events) {
    const crmStatus = ev.crmStatus || adapter.mapStatus(ev.originalStatus);
    const eventTime = ev.eventTime || Date.now();
    const didInsert = db.appendEvent({
      shipmentId: shipment.id, eventTime,
      originalStatus: ev.originalStatus || '',
      crmStatus,
      description: ev.description || CRM_STATUS_LABEL[crmStatus] || '',
      raw: ev.raw || {},
    });
    if (didInsert) {
      inserted.push({ ...ev, eventTime, crmStatus });
      if (!latest || eventTime > latest.eventTime) latest = { ...ev, eventTime, crmStatus };
    }
  }

  if (!latest) return [];

  const prevShipment = db.getShipment(shipment.id);
  const oldCrmStatus = prevShipment?.crmStatus || '';
  const oldOriginalStatus = prevShipment?.originalStatus || '';
  const updated = db.saveShipment({ ...prevShipment, crmStatus: latest.crmStatus, originalStatus: latest.originalStatus });

  const order = db.getOrder(updated.orderId);
  if (order) {
    db.patchOrder(order.id, {
      trackingNumber: updated.trackingNumber || order.trackingNumber,
      deliveryStatus: latest.originalStatus || CRM_STATUS_LABEL[latest.crmStatus],
    });
  }

  const carrierRow = updated.providerId ? db.getProvider(updated.providerId) : null;
  const carrierName = carrierRow?.name || order?.delivery || '';

  if (shouldNotify(latest.crmStatus)) {
    const title = '🚚 ' + (CRM_STATUS_LABEL[latest.crmStatus] || latest.crmStatus);
    const body  = [order?.id, updated.trackingNumber].filter(Boolean).join(' · ');
    db.addNotification({ type: 'delivery_' + latest.crmStatus, title, body, orderId: order?.id || '', shipmentId: updated.id });
  }

  if (broadcaster) {
    broadcaster('delivery_update', {
      orderId: order?.id, orderNumber: order?.shopifyName || order?.id || '',
      customer: order?.client || '', shipmentId: updated.id,
      trackingNumber: updated.trackingNumber, carrier: carrierName,
      crmStatus: latest.crmStatus, originalStatus: latest.originalStatus,
      oldCrmStatus, oldOriginalStatus,
      newStatusLabel: CRM_STATUS_LABEL[latest.crmStatus] || latest.crmStatus,
      oldStatusLabel: CRM_STATUS_LABEL[oldCrmStatus] || oldCrmStatus || '—',
      description: latest.description,
      time: latest.eventTime || Date.now(), event: latest,
    }, order?.agent || null);
  }

  if (order) {
    try {
      const task = require('../followup').onDeliveryStatus(order.id, {
        crmStatus: latest.crmStatus, originalStatus: latest.originalStatus, description: latest.description,
      }, opts.actor || 'system');
      if (task && broadcaster) {
        broadcaster('followup_reminder', { orderId: order.id, taskId: task.id, dueAt: task.dueAt, reason: task.reason, agent: order.followupAgent || '' }, order.followupAgent || order.agent || null);
      }
    } catch (e) { /* advisory */ }
  }

  db.audit('shipment', updated.id, 'tracking', opts.actor || 'system', { inserted: inserted.length, crmStatus: latest.crmStatus });
  return inserted;
}

async function refreshShipment(shipmentId, broadcaster) {
  const shipment = db.getShipment(shipmentId);
  if (!shipment) return null;
  const resolved = resolveProvider(shipment.providerId);
  if (!resolved) return null;
  let events = [];
  try { events = await resolved.adapter.getTracking(shipment.trackingNumber, resolved.cfg); }
  catch (e) { return { error: e.message }; }
  const inserted = ingestTrackingEvents(shipment, events, broadcaster);
  return { inserted: inserted.length };
}

module.exports = { getAdapter, listAdapterKeys, resolveProvider, createShipmentForOrder, ingestTrackingEvents, refreshShipment };
