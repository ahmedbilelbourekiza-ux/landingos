/* =============================================================================
 * lib/ai/context.js — PERMISSION-SCOPED, MASKED CRM read surface for the AI.
 *
 * WHY THIS EXISTS:
 * The raw DB layer (lib/db.js) is unsafe to hand to a language model:
 *   - getAgents() / loadOrdersData() return agent PASSWORDS in cleartext
 *   - getStoreSecrets() / getProviderSecrets() return live API keys
 *   - `raw: db` is an arbitrary-SQL escape hatch
 * The AI must never see secrets, never see more than its role permits, and
 * never reach the raw handle. This module is the ONLY sanctioned bridge between
 * CRM data and the model. It masks every secret and gates every dataset behind
 * a permission key.
 *
 * SAFETY GUARANTEES:
 *   1. No function here ever returns a password, API key, or secret.
 *   2. Every dataset requires an explicit permission; missing permission ⇒ [].
 *   3. PII (phone) is included for orders because the model needs it to answer
 *      "customers waiting for callback", but it never leaves the server — the
 *      model runs server-side. No data is sent to a third party beyond the
 *      configured AI provider's inference call, which is the explicit intent.
 *   4. No destructive permission exists in this module. The AI can only READ.
 * ========================================================================== */

const db = require('../db');

/**
 * Canonical permission catalog. Every key here is a capability the admin can
 * grant to an AI Agent. NOTE the absence of any write/delete/execute key — by
 * design the AI cannot mutate CRM data. (Future automation would add an
 * explicit, separately-audited execute_* capability, gated behind user approval.)
 */
const PERMISSIONS = {
  read_orders:       'Read orders (status, products, prices, dates)',
  read_customers:    'Read customer contact info (name, phone, wilaya)',
  read_products:     'Read products & inventory',
  read_delivery:     'Read shipment tracking & delivery events',
  read_analytics:    'Read aggregated metrics (rates by agent/wilaya/product)',
  read_agent_notes:  'Read call notes & call history',
  generate_reports:  'Produce summaries & reports from CRM data',
  suggest_actions:   'Recommend next actions (advisory only — never executes)',
};

const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

function has(permissions, key) {
  return Array.isArray(permissions) && permissions.includes(key);
}

const dayMs = 86400000;
const HOUR = 3600000;

/** Normalize "today" / "this week" boundaries from epoch-ms, in local time. */
function dateBounds(range) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  switch (range) {
    case 'today':  return { from: startOfDay, to: Date.now() };
    case 'week':   return { from: startOfDay - 6 * dayMs, to: Date.now() };
    case 'month':  return { from: startOfDay - 29 * dayMs, to: Date.now() };
    default:       return { from: 0, to: Date.now() };
  }
}

/* ---------------------------------------------------------------------------
 * Masked datasets. Each returns a SAFE shape (no secrets) or [] if the
 * permission is absent. Order/customer rows are trimmed to the fields a model
 * needs to reason — we don't dump every internal column.
 * ------------------------------------------------------------------------- */

/** Orders without secrets. Includes customer PII only if read_customers. */
function getOrders(permissions, { range, status, agent, wilaya, limit } = {}) {
  if (!has(permissions, 'read_orders')) return [];
  const allowCustomer = has(permissions, 'read_customers');
  const allowNotes = has(permissions, 'read_agent_notes');
  const { from, to } = range ? dateBounds(range) : { from: 0, to: Date.now() };
  let orders = db.loadOrdersData().orders || [];
  if (from || to) orders = orders.filter(o => (o.createdAt || 0) >= from && (o.createdAt || 0) <= to);
  if (status) orders = orders.filter(o => o.status === status);
  if (agent) orders = orders.filter(o => o.agent === agent);
  if (wilaya) orders = orders.filter(o => o.wilaya === wilaya);
  if (limit) orders = orders.slice(0, limit);
  return orders.map(o => ({
    id: o.id,
    client: allowCustomer ? (o.client || '') : undefined,
    phone: allowCustomer ? (o.phone || '') : undefined,
    city: allowCustomer ? (o.city || '') : undefined,
    wilaya: allowCustomer ? (o.wilaya || '') : undefined,
    commune: allowCustomer ? (o.commune || '') : undefined,
    product: o.product || '',
    productVariant: o.productVariant || '',
    quantity: o.quantity,
    price: o.price,
    agent: o.agent || '',
    delivery: o.delivery || '',
    status: o.status || '',
    deliveryStatus: o.deliveryStatus || '',
    trackingNumber: o.trackingNumber || '',
    storeId: o.storeId || '',
    createdAt: o.createdAt,
    shopifyCreatedAt: o.shopifyCreatedAt || null,
    source: o.source || '',
    ...(allowNotes ? { calls: (o.calls || []).map(c => ({
      result: c.result, note: c.note || '', time: c.time, duration: c.duration,
    })) } : {}),
  }));
}

/** Agents — names ONLY. Never the password. */
function getAgents(permissions) {
  if (!has(permissions, 'read_orders') && !has(permissions, 'read_analytics')) return [];
  return (db.getAgents() || []).map(a => ({ name: a.name }));
}

/** Products — no secrets in this table, but still gated. */
function getProducts(permissions) {
  if (!has(permissions, 'read_products')) return [];
  return (db.getProducts() || []).map(p => ({
    id: p.id, name: p.name, sku: p.sku, price: p.price,
    stock: p.stock, description: p.description,
  }));
}

/** Delivery: shipments + their event timelines. */
function getDelivery(permissions, { activeOnly } = {}) {
  if (!has(permissions, 'read_delivery')) return [];
  let ships = activeOnly ? db.listActiveShipments() : (db.raw.prepare('SELECT * FROM shipments').all());
  return ships.map(s => {
    const ship = s.crmStatus ? s : dbRawToShipment(s);
    return {
      id: ship.id, orderId: ship.orderId, providerId: ship.providerId,
      trackingNumber: ship.trackingNumber, crmStatus: ship.crmStatus,
      originalStatus: ship.originalStatus, createdAt: ship.createdAt, updatedAt: ship.updatedAt,
      events: (db.getEvents(ship.id) || []).map(e => ({
        eventTime: e.eventTime, crmStatus: e.crmStatus, originalStatus: e.originalStatus, description: e.description,
      })),
    };
  });
}
function dbRawToShipment(r) {
  if (!r) return null;
  return {
    id: r.id, orderId: r.orderId, providerId: r.providerId, trackingNumber: r.trackingNumber,
    crmStatus: r.crmStatus, originalStatus: r.originalStatus, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/**
 * Aggregated analytics — computed deterministically (never by the model). The
 * model explains these; it never invents the numbers. Returns {} without the
 * read_analytics permission.
 */
function getAnalytics(permissions, { range } = {}) {
  if (!has(permissions, 'read_analytics')) return {};
  const orders = db.loadOrdersData().orders || [];
  const { from, to } = range ? dateBounds(range) : { from: 0, to: Date.now() };
  const scoped = orders.filter(o => (o.createdAt || 0) >= from && (o.createdAt || 0) <= to);

  const by = (arr, keyFn) => {
    const groups = {};
    for (const o of arr) {
      const k = keyFn(o); if (!k) continue;
      if (!groups[k]) groups[k] = { total: 0, confirmed: 0, cancelled: 0, other: 0 };
      groups[k].total++;
      if (o.status === 'confirmed') groups[k].confirmed++;
      else if (o.status === 'cancelled') groups[k].cancelled++;
      else groups[k].other++;
    }
    for (const k of Object.keys(groups)) {
      const g = groups[k];
      g.confirmationRate = g.total ? +(g.confirmed / g.total).toFixed(3) : 0;
      g.cancellationRate = g.total ? +(g.cancelled / g.total).toFixed(3) : 0;
    }
    return groups;
  };

  return {
    range: range || 'all',
    from, to,
    totals: {
      orders: scoped.length,
      confirmed: scoped.filter(o => o.status === 'confirmed').length,
      cancelled: scoped.filter(o => o.status === 'cancelled').length,
      pending: scoped.filter(o => ['pending','no_answer','callback','tentative1','tentative2','tentative3','unreachable'].includes(o.status)).length,
      revenue: scoped.filter(o => o.status === 'confirmed').reduce((s, o) => s + (o.price || 0), 0),
    },
    byStatus: by(scoped, o => o.status),
    byWilaya: by(scoped, o => o.wilaya),
    byAgent: by(scoped, o => o.agent),
    byProduct: by(scoped, o => o.product),
    byStore: by(scoped, o => o.storeId),
    agentRoster: (db.getAgents() || []).map(a => a.name),
  };
}

/**
 * Build the full context object the model will receive, honoring an AI Agent's
 * permission set. This is what gets injected as the "CRM data" system context.
 * Pass { actor: 'agent:<name>' } to scope orders to a single agent (agent.html).
 */
function buildContext(permissions, opts = {}) {
  const ctx = { generatedAt: new Date().toISOString() };
  const orders = getOrders(permissions, {
    range: opts.range,
    agent: opts.scopedAgent || undefined,
    limit: opts.orderLimit || 500,
  });
  if (orders.length) ctx.orders = orders;
  const agents = getAgents(permissions);
  if (agents.length) ctx.agents = agents;
  const products = getProducts(permissions);
  if (products.length) ctx.products = products;
  const delivery = getDelivery(permissions, { activeOnly: opts.activeDeliveryOnly });
  if (delivery.length) ctx.delivery = delivery;
  const analytics = getAnalytics(permissions, { range: opts.range });
  if (Object.keys(analytics).length > 1) ctx.analytics = analytics;
  return ctx;
}

module.exports = {
  PERMISSIONS, ALL_PERMISSIONS,
  has, dateBounds,
  getOrders, getAgents, getProducts, getDelivery, getAnalytics,
  buildContext,
};
