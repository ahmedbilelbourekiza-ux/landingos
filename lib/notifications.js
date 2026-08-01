/* =============================================================================
 * lib/notifications.js — Persistent notifications + broadcast bridge.
 *
 * Notifications are now persisted in SQLite (so they survive reloads and can be
 * listed server-side) AND pushed live to connected clients over SSE. This module
 * wraps both: callers call push() once and it stores + broadcasts.
 * ========================================================================== */

const db = require('./db');

let _broadcast = null;   // injected from index.js (the SSE broadcast fn)

/** index.js injects its broadcast(payload, target) function on boot. */
function setBroadcaster(fn) { _broadcast = fn; }

/**
 * Create + broadcast a notification.
 * @param {Object} n  { type, title, body, orderId, shipmentId, target }
 */
function push(n) {
  db.addNotification({
    type: n.type || '',
    title: n.title || '',
    body: n.body || '',
    orderId: n.orderId || '',
    shipmentId: n.shipmentId || '',
  });
  if (_broadcast) {
    _broadcast({
      type: n.type ? 'notif_' + n.type : 'notification',
      title: n.title,
      body: n.body,
      orderId: n.orderId,
      shipmentId: n.shipmentId,
      time: Date.now(),
    }, n.target || null);
  }
}

module.exports = { setBroadcaster, push };
