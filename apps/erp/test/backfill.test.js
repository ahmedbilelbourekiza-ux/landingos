/* =============================================================================
 * test/backfill.test.js — audit BUG-02, migration half.
 *
 * Fixing the write path only helps parcels delivered from now on. An existing
 * installation has orders the carrier already reported as delivered or returned
 * that still read as unsettled, so their revenue stays invisible. The backfill
 * recovers them from shipment_events, which is append-only and therefore a
 * trustworthy record of what the carrier actually said.
 *
 * This test reproduces the real upgrade: run a server, deliver parcels, force
 * the database back into its pre-fix shape, then restart and assert recovery.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startServer, waitFor, uid } = require('./helpers');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crm-backfill-')), 'crm.db');
let srv;
let orderIds = [];
let phones = [];

before(async () => {
  // --- Run 1: generate real delivered orders through the normal pipeline ---
  srv = await startServer({ CRM_DB_PATH: dbPath });
  const code = 'bf' + uid();
  const { body: p } = await srv.api('POST', '/api/providers', {
    name: 'Backfill Carrier', code, adapter: 'mock', apiEnabled: true,
  });
  await srv.api('POST', `/api/providers/${p.id}/default`);
  await srv.api('PUT', '/api/settings', { autoCreateShipment: true });

  for (let i = 0; i < 2; i++) {
    const phone = '05' + Math.floor(10000000 + Math.random() * 89999999);
    const { body: order } = await srv.api('POST', '/api/orders', {
      client: 'Legacy Buyer ' + i, phone, price: 6000, delivery: code,
    });
    await srv.api('POST', `/api/orders/${order.id}/call-start`);
    await srv.api('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' });
    for (let n = 0; n < 8; n++) {
      const { body } = await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);
      if ((body.events || []).some((e) => e.crmStatus === 'delivered')) break;
    }
    await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/orders');
      return body.find((o) => o.id === order.id)?.deliveryOutcome === 'delivered';
    }, { label: 'delivery to settle' });
    orderIds.push(order.id);
    phones.push(phone);
  }
  await srv.stop();

  // --- Force the database back to its pre-fix state ---
  // deliveryOutcome unwritten, and the client counters it drives back to zero,
  // exactly as a real installation looks before this fix. shipment_events is
  // deliberately left intact — that is what the backfill reads.
  const db = new Database(dbPath);
  db.prepare("UPDATE orders SET deliveryOutcome = '', deliveryOutcomeAt = NULL").run();
  db.prepare('UPDATE clients SET deliveredOrders = 0, totalSpent = 0').run();
  db.prepare("DELETE FROM settings WHERE key = 'deliveryOutcomeBackfillAt'").run();
  const before = db.prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE deliveryOutcome = ''"
  ).get().c;
  assert.ok(before >= 2, 'the pre-fix state was staged');
  db.close();

  // --- Run 2: boot again; the backfill runs during startup ---
  srv = await startServer({ CRM_DB_PATH: dbPath });
});

after(async () => { if (srv) await srv.stop(); });

describe('deliveryOutcome backfill', () => {
  test('it recovers the outcome for already-delivered orders', async () => {
    const { body: orders } = await srv.api('GET', '/api/orders');
    for (const id of orderIds) {
      const o = orders.find((x) => x.id === id);
      assert.equal(o.deliveryOutcome, 'delivered', `${id} was recovered`);
      assert.ok(o.deliveryOutcomeAt > 0, `${id} has a settlement moment`);
    }
  });

  test('the settlement moment comes from the carrier event, not the migration clock', async () => {
    const db = new Database(dbPath, { readonly: true });
    for (const id of orderIds) {
      const order = db.prepare('SELECT deliveryOutcomeAt FROM orders WHERE id = ?').get(id);
      const event = db.prepare(`
        SELECT MIN(e.eventTime) AS t FROM shipment_events e
        JOIN shipments s ON s.id = e.shipmentId
        WHERE s.orderId = ? AND e.crmStatus = 'delivered'
      `).get(id);
      assert.equal(order.deliveryOutcomeAt, event.t,
        'the recovered timestamp matches the carrier event exactly');
    }
    db.close();
  });

  test('client lifetime counters are rebuilt by the backfill', async () => {
    for (const phone of phones) {
      const { body } = await srv.api('GET', '/api/clients?search=' + phone);
      const c = body.items[0];
      assert.equal(c.deliveredOrders, 1, 'delivered count restored');
      assert.equal(c.totalSpent, 6000, 'lifetime spend restored');
    }
  });

  test('it is recorded in the append-only audit trail', async () => {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'delivery_outcome_backfilled'"
    ).all();
    db.close();
    assert.equal(rows.length, orderIds.length);
    assert.equal(JSON.parse(rows[0].payload).outcome, 'delivered');
  });

  test('a second boot is a no-op — nothing is double-counted', async () => {
    await srv.stop();
    srv = await startServer({ CRM_DB_PATH: dbPath });

    for (const phone of phones) {
      const { body } = await srv.api('GET', '/api/clients?search=' + phone);
      assert.equal(body.items[0].deliveredOrders, 1, 'still 1, not 2');
      assert.equal(body.items[0].totalSpent, 6000, 'spend not double-counted');
    }
    assert.ok(
      !srv.logs().includes('delivery-outcome backfill complete'),
      'the settings marker skips the scan entirely on later boots'
    );
  });

  test('it never overwrites an outcome that is already set', async () => {
    const db = new Database(dbPath);
    // Stage an order settled as 'returned' plus a cleared marker, and confirm
    // the backfill leaves the existing value alone even though the event
    // history says 'delivered'.
    db.prepare("UPDATE orders SET deliveryOutcome = 'returned', deliveryOutcomeAt = 123 WHERE id = ?")
      .run(orderIds[0]);
    db.prepare("DELETE FROM settings WHERE key = 'deliveryOutcomeBackfillAt'").run();
    db.close();

    await srv.stop();
    srv = await startServer({ CRM_DB_PATH: dbPath });

    const { body: orders } = await srv.api('GET', '/api/orders');
    const o = orders.find((x) => x.id === orderIds[0]);
    assert.equal(o.deliveryOutcome, 'returned', 'an existing outcome is never rewritten');
    assert.equal(o.deliveryOutcomeAt, 123);
  });
});
