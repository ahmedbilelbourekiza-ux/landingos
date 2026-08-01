/* =============================================================================
 * lib/jobs.js — Server-side background sync.
 *
 * Two responsibilities:
 *   1. Tracking polling fallback — for every non-terminal shipment, periodically
 *      ask its provider's adapter for fresh tracking and ingest new events.
 *      This guarantees updates flow even when a carrier's webhook is silent.
 *   2. Stale-order alert — the alertMinutes setting finally gets used: orders
 *      not yet called within the threshold generate an alert notification.
 *
 * Uses plain setInterval (no extra dependency). Re-reads the interval from
 * settings on each tick so admins can change trackingPollMinutes live.
 * ========================================================================== */

const db = require('./db');
const providers = require('./providers');
const followup = require('./followup');

let pollTimer = null;
let alertTimer = null;
let followupTimer = null;

function start(broadcast, log) {
  const _log = log || (() => {});

  // --- Tracking poll loop ---
  const pollOnce = async () => {
    let interval;
    try {
      const s = db.getSettings();
      interval = Math.max(1, Number(s.trackingPollMinutes) || 15);
    } catch { interval = 15; }

    try {
      const active = db.listActiveShipments();
      if (active.length === 0) return scheduleNext(interval);

      let refreshed = 0;
      for (const shipment of active) {
        try {
          const res = await providers.refreshShipment(shipment.id, broadcast);
          if (res && !res.error && res.inserted) refreshed += res.inserted;
        } catch (e) {
          _log('error', 'jobs', 'tracking poll failed for shipment', { id: shipment.id, err: e.message });
        }
      }
      if (refreshed > 0) _log('info', 'jobs', 'tracking poll inserted new events', { count: refreshed, scanned: active.length });
    } catch (e) {
      _log('error', 'jobs', 'tracking poll cycle failed', { err: e.message });
    }
    scheduleNext(interval);
  };

  const scheduleNext = (minutes) => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(pollOnce, Math.max(1, minutes) * 60 * 1000);
  };

  // --- Stale-order alert loop (runs hourly, cheap) ---
  const alertOnce = () => {
    try {
      const s = db.getSettings();
      const alertMinutes = Number(s.alertMinutes) || 60;
      const cutoff = Date.now() - alertMinutes * 60 * 1000;
      const data = db.loadOrdersData();
      const stale = data.orders.filter(o =>
        o.status === 'pending' &&
        (!o.calls || o.calls.length === 0) &&
        o.createdAt && o.createdAt < cutoff
      );
      if (stale.length > 0) {
        // One summary notification per cycle (avoid spamming per-order).
        db.addNotification({
          type: 'stale_orders',
          title: '⏰ ' + stale.length + ' commande(s) non traitée(s)',
          body: 'Plus de ' + alertMinutes + ' min sans appel',
          orderId: '',
          shipmentId: '',
        });
        if (broadcast) broadcast({
          type: 'stale_orders', title: stale.length + ' commandes en retard', body: '', count: stale.length, time: Date.now(),
        });
      }
    } catch (e) {
      _log('error', 'jobs', 'stale-order alert failed', { err: e.message });
    }
    alertTimer = setTimeout(alertOnce, 60 * 60 * 1000);
  };

  // --- Follow-up (Suivi) overdue sweep loop (runs every 5 min) ---
  // Escalates call-reminders whose countdown has expired: marks them overdue,
  // highlights the order, and notifies the manager (req §1, call-reminder).
  const followupOnce = () => {
    try {
      const escalated = followup.sweepOverdue((n) => {
        db.addNotification({
          type: n.type || 'followup_overdue',
          title: n.title || '', body: n.body || '',
          orderId: n.orderId || '', shipmentId: '',
        });
        if (broadcast) broadcast({ type: 'followup_overdue', title: n.title, body: n.body, count: 1, time: Date.now() });
      });
      if (escalated.length) _log('info', 'jobs', 'follow-up overdue sweep escalated', { count: escalated.length });
    } catch (e) {
      _log('error', 'jobs', 'follow-up overdue sweep failed', { err: e.message });
    }
    followupTimer = setTimeout(followupOnce, 5 * 60 * 1000);
  };

  // Kick off both loops. First poll after 30s (let the server settle), alerts after 60s.
  pollTimer = setTimeout(pollOnce, 30 * 1000);
  alertTimer = setTimeout(alertOnce, 60 * 1000);
  followupTimer = setTimeout(followupOnce, 90 * 1000);
  _log('info', 'jobs', 'background sync started');
}

function stop() {
  if (pollTimer) clearTimeout(pollTimer);
  if (alertTimer) clearTimeout(alertTimer);
  if (followupTimer) clearTimeout(followupTimer);
  pollTimer = null;
  alertTimer = null;
  followupTimer = null;
}

module.exports = { start, stop };
