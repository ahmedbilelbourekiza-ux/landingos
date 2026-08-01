/* =============================================================================
 * test/indexes.test.js — audit PERF-01.
 *
 * The busiest table in the system had exactly one index, and order_calls had
 * none, so attachCalls() scanned the whole calls table once per order and
 * GET /api/orders was quadratic. Measured on 5,000 orders: 3,006 ms before,
 * 290 ms after.
 *
 * Asserting on wall-clock time would be flaky on shared CI, so these tests
 * assert on the two things that actually caused it: the indexes exist, and the
 * planner uses them instead of scanning.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startServer, uid } = require('./helpers');

let srv, raw;

before(async () => {
  srv = await startServer();
  // Enough rows that the planner prefers an index over a scan; with an empty
  // table SQLite will happily scan and the plan assertions mean nothing.
  const db = new Database(srv.dbPath);
  const insert = db.transaction(() => {
    for (let i = 1; i <= 800; i++) {
      const id = 'PERF-' + String(i).padStart(5, '0');
      db.prepare(`INSERT INTO orders (id, client, phone, agent, status, createdAt, shopifyId, trackingNumber, deliveryOutcome, lineItems)
        VALUES (?,?,?,?,?,?,?,?,?,'[]')`).run(
        id, 'C' + i, '05' + i, i % 2 ? 'Amine' : 'Karim',
        i === 7 ? 'cancelled' : (i % 3 ? 'pending' : 'confirmed'), Date.now() - i * 1000,
        'SHOP-' + i, 'TRK-' + i, i % 5 ? '' : 'delivered');
      db.prepare(`INSERT INTO order_calls (orderId, time, result) VALUES (?,?,?)`).run(id, Date.now(), 'no_answer');
    }
  });
  insert();
  db.exec('ANALYZE');
  db.close();
  raw = new Database(srv.dbPath, { readonly: true });
});
after(async () => { if (raw) raw.close(); if (srv) await srv.stop(); });

const indexesOn = (table) =>
  raw.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_%'`)
    .all(table).map((r) => r.name);

const plan = (sql) =>
  raw.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');

describe('the indexes exist', () => {
  const expected = {
    orders: [
      'idx_orders_created', 'idx_orders_status_created', 'idx_orders_agent_status',
      'idx_orders_followup_agent', 'idx_orders_shopify_id', 'idx_orders_store',
      'idx_orders_tracking', 'idx_orders_outcome', 'idx_orders_phone_normalized',
    ],
    order_calls: ['idx_order_calls_order'],
    shipments: ['idx_shipments_order', 'idx_shipments_tracking', 'idx_shipments_provider'],
    notifications: ['idx_notifications_target'],
    sessions: ['idx_sessions_agent', 'idx_sessions_expiry'],
  };

  for (const [table, names] of Object.entries(expected)) {
    test(`${table} has its indexes`, () => {
      const present = indexesOn(table);
      for (const n of names) assert.ok(present.includes(n), `${table} is missing ${n}`);
    });
  }
});

describe('the planner uses them instead of scanning', () => {
  const cases = [
    ['the main list ordering', 'SELECT * FROM orders ORDER BY createdAt DESC', 'idx_orders_created'],
    ['call history per order', "SELECT * FROM order_calls WHERE orderId = 'PERF-00001'", 'idx_order_calls_order'],
    ['selective status filter', "SELECT * FROM orders WHERE status = 'cancelled' ORDER BY createdAt DESC", 'idx_orders_status_created'],
    ['per-agent lookup', "SELECT * FROM orders WHERE agent = 'Karim'", 'idx_orders_agent_status'],
    ['webhook dedup by external id', "SELECT * FROM orders WHERE shopifyId = 'SHOP-1'", 'idx_orders_shopify_id'],
    ['delivery webhook by tracking', "SELECT * FROM orders WHERE trackingNumber = 'TRK-1'", 'idx_orders_tracking'],
    ['profit calculator outcome filter', "SELECT * FROM orders WHERE deliveryOutcome = 'delivered'", 'idx_orders_outcome'],
  ];

  for (const [label, sql, index] of cases) {
    test(label, () => {
      const p = plan(sql);
      assert.ok(p.includes(index), `expected ${index}, planner said: ${p}`);
      assert.ok(!p.includes('TEMP B-TREE'), `still sorting in memory: ${p}`);
    });
  }

  test('attachCalls no longer scans the calls table per order', () => {
    const p = plan("SELECT * FROM order_calls WHERE orderId = 'PERF-00001' ORDER BY id ASC");
    assert.ok(p.includes('USING INDEX') || p.includes('USING COVERING INDEX'),
      `this ran once PER ORDER, making the list quadratic: ${p}`);
    assert.ok(!/^SCAN order_calls/.test(p), 'must not be a full scan');
  });
});

describe('the API still returns the same data', () => {
  test('the seeded orders are all readable and correctly shaped', async () => {
    const { status, body } = await srv.api('GET', '/api/orders');
    assert.equal(status, 200);
    const seeded = body.filter((o) => o.id.startsWith('PERF-'));
    assert.equal(seeded.length, 800, 'every seeded order comes back');
    const one = seeded.find((o) => o.id === 'PERF-00001');
    assert.equal(one.calls.length, 1, 'call history is still attached');
    assert.equal(one.agent, 'Amine');
  });

  test('newest-first ordering is preserved', async () => {
    const { body } = await srv.api('GET', '/api/orders');
    for (let i = 1; i < body.length; i++) {
      assert.ok((body[i - 1].createdAt || 0) >= (body[i].createdAt || 0),
        'the list must stay newest-first');
    }
  });
});

describe('index creation is safe on an existing database', () => {
  test('a database created before this change gains the indexes on boot', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-preindex-'));
    const dbPath = path.join(dir, 'crm.db');

    // A minimal pre-index database with real rows in it.
    // Build it the way a real pre-upgrade database exists: created by this
    // schema, then stripped of the indexes so boot has to add them back.
    {
      const boot = await startServer({ CRM_DB_PATH: dbPath });
      await boot.api('POST', '/api/orders', { client: 'Legacy', phone: '0555000111' });
      await boot.stop();
      const strip = new Database(dbPath);
      for (const r of strip.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all()) {
        strip.exec('DROP INDEX IF EXISTS ' + r.name);
      }
      assert.equal(
        strip.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name='idx_orders_created'").get().c,
        0, 'the index really was removed');
      strip.close();
    }

    const s = await startServer({ CRM_DB_PATH: dbPath });
    try {
      const check = new Database(dbPath, { readonly: true });
      const names = check.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='orders'`).all().map((r) => r.name);
      check.close();
      assert.ok(names.includes('idx_orders_created'), 'indexes were added to the existing table');

      const { body } = await s.api('GET', '/api/orders');
      const legacy = body.find((o) => o.client === 'Legacy');
      assert.ok(legacy, 'the pre-existing row survived the index migration');
      assert.equal(legacy.phone, '0555000111');
    } finally {
      await s.stop();
    }
  });
});
