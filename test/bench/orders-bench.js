/* =============================================================================
 * test/bench/orders-bench.js — measures the cost of the order read path.
 *
 * Not a test: a measurement, so the index work has a before/after number rather
 * than an assertion that something "feels faster". Seeds a realistic dataset
 * directly through the data layer, then times the queries the API actually
 * runs.
 *
 *   node test/bench/orders-bench.js [orderCount]
 * ========================================================================== */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COUNT = Number(process.argv[2]) || 5000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-bench-'));
process.env.CRM_DB_PATH = path.join(dir, 'crm.db');

const db = require('../../lib/db');

const AGENTS = ['Amine', 'Karim', 'Sara', 'Yacine', 'Nadia'];
const STATUSES = ['pending', 'no_answer', 'callback', 'confirmed', 'cancelled', 'tentative1'];
const WILAYAS = ['Alger', 'Oran', 'Constantine', 'Blida', 'Sétif'];

function seed() {
  const t0 = Date.now();
  for (const a of AGENTS) {
    try { db.addAgent(a, 'x', 'both'); } catch { /* exists */ }
  }
  const insert = db.raw.transaction(() => {
    for (let i = 1; i <= COUNT; i++) {
      const id = 'ORD-' + String(i).padStart(6, '0');
      db.raw.prepare(`INSERT INTO orders
        (id, client, phone, phoneNormalized, wilaya, product, quantity, price,
         agent, status, delivery, source, createdAt, lineItems, deliveryOutcome)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, 'Client ' + i, '05' + String(10000000 + i), '05' + String(10000000 + i),
        WILAYAS[i % WILAYAS.length], 'Product ' + (i % 40), 1 + (i % 3), 1000 + (i % 90) * 100,
        AGENTS[i % AGENTS.length], STATUSES[i % STATUSES.length], 'zr', 'shopify',
        Date.now() - i * 60000, '[]', i % 7 === 0 ? 'delivered' : ''
      );
      // Two thirds of orders carry call history — this is what makes
      // attachCalls() expensive without an index on order_calls.orderId.
      const calls = i % 3 === 0 ? 0 : 1 + (i % 3);
      for (let c = 0; c < calls; c++) {
        db.raw.prepare(`INSERT INTO order_calls (orderId, time, duration, threshold, suspicious, result, note, agent)
          VALUES (?,?,?,?,?,?,?,?)`).run(id, Date.now() - c * 3600000, 45 + c, 40, 0, 'no_answer', '', AGENTS[i % AGENTS.length]);
      }
    }
  });
  insert();
  return Date.now() - t0;
}

function time(label, fn, runs = 3) {
  fn();                                   // warm
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const ms = times.reduce((a, b) => a + b, 0) / times.length;
  console.log('  ' + label.padEnd(52) + ms.toFixed(1).padStart(9) + ' ms');
  return ms;
}

console.log(`\nSeeding ${COUNT.toLocaleString()} orders + call history...`);
console.log(`  done in ${seed()} ms\n`);
console.log('Indexes currently on orders / order_calls / shipments:');
for (const t of ['orders', 'order_calls', 'shipments']) {
  const idx = db.raw.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_%'`).all(t);
  console.log('  ' + t.padEnd(14) + (idx.length ? idx.map(i => i.name).join(', ') : '(none)'));
}

console.log('\nQuery timings (mean of 3):');
time('loadOrdersData()  — what GET /api/orders calls', () => db.loadOrdersData());
time('findOrder() by shopifyId — webhook dedup path', () => db.findOrder((o) => o.shopifyId === 'nope'));
time("count pending by agent  — auto-assign", () =>
  db.raw.prepare("SELECT COUNT(*) c FROM orders WHERE agent=? AND status='pending'").get('Karim'));
time('listOverdueUnansweredOrders() — the sweep', () => db.listOverdueUnansweredOrders());
time('getOrdersByDeliveryOutcome() — profit calc', () =>
  db.getOrdersByDeliveryOutcome({ outcome: 'delivered', since: 0, until: Date.now() }));
time('computeAgentPayroll() — one agent', () =>
  db.computeAgentPayroll('Karim', 0, Date.now(), 'month'));

console.log('\nQuery plans:');
for (const [label, sql] of [
  ['orders ORDER BY createdAt', 'SELECT * FROM orders ORDER BY createdAt DESC'],
  ['order_calls by orderId', "SELECT * FROM order_calls WHERE orderId = 'ORD-000001'"],
  ['orders by status', "SELECT * FROM orders WHERE status = 'pending'"],
  ['orders by agent', "SELECT * FROM orders WHERE agent = 'Karim'"],
]) {
  const plan = db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');
  console.log('  ' + label.padEnd(30) + plan);
}
console.log();
