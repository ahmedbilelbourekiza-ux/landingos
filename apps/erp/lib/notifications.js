/* =============================================================================
 * lib/notifications.js — persistent notifications + live delivery.
 *
 * One call to push() does two things that must stay in step: it STORES the
 * notification (so it survives a refresh, and a client that was offline can
 * catch up) and it BROADCASTS it (so a connected client sees it immediately).
 *
 * The audience is decided once, here, and used for both. Previously `target`
 * was passed through to the live broadcast but dropped on the way to the
 * database — there was no column for it — so the two halves disagreed about who
 * an event was for. Now the stored row carries the same audience the live hop
 * used, and the id of that row is sent with the live event so a reconnecting
 * client can ask for "everything after this".
 *
 * AUDIENCE VALUES (see lib/db.js visibilityClause):
 *   null / ''      everyone
 *   'manager'      managers only — agent misconduct, suspensions, stale-order
 *                  sweeps. An agent must never see these about themselves.
 *   '<agent name>' that agent, plus managers.
 * ========================================================================== */

const db = require('./db');

let _broadcast = null;   // injected from index.js (the SSE broadcast fn)

/** index.js injects its broadcast(payload, target) function on boot. */
function setBroadcaster(fn) { _broadcast = fn; }

/** Managers-only audience, named so call sites read as intent, not convention. */
const MANAGER_ONLY = 'manager';
const EVERYONE = null;

/**
 * Store + broadcast a notification.
 *
 * @param {Object} n
 * @param {string} n.type      machine type, e.g. 'shipment_created'
 * @param {string} n.title     short human line (rendered as TEXT by clients)
 * @param {string} n.body      detail line
 * @param {string} [n.orderId]
 * @param {string} [n.shipmentId]
 * @param {string|null} [n.target]  audience — see the header
 * @returns {number} the stored notification id
 */
function push(n) {
  const target = n.target === undefined ? EVERYONE : n.target;
  const id = db.addNotification({
    type: n.type || '',
    title: n.title || '',
    body: n.body || '',
    orderId: n.orderId || '',
    shipmentId: n.shipmentId || '',
    target,
  });

  if (_broadcast) {
    _broadcast({
      /* The type is sent UNPREFIXED so clients keep branching on it exactly as
       * they always have ('new_order' refreshes the order list, 'delivery_*'
       * highlights a row). What marks an event as storable is the presence of
       * `notificationId` — which is also the only thing the badge counts, so
       * the client's unread number can never drift from the server's.
       *
       * `extra` carries whatever payload that event type's handler already
       * expects (e.g. the full order object), so a broadcast can become a
       * stored notification without changing the client's rendering path. */
      ...(n.extra || {}),
      type: n.type || 'notification',
      notificationId: id,
      notifType: n.type || '',
      title: n.title || '',
      body: n.body || '',
      orderId: n.orderId || '',
      shipmentId: n.shipmentId || '',
      time: Date.now(),
    }, target);
  }
  return id;
}

module.exports = { setBroadcaster, push, MANAGER_ONLY, EVERYONE };
