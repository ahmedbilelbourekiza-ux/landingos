/* =============================================================================
 * test/validation.test.js — audit §4 (mass assignment and input validation).
 *
 * PUT /api/orders/:id spread req.body straight into storage and PUT
 * /api/settings accepted arbitrary keys with arbitrary values. Both were
 * demonstrated against a running server before being fixed: one PUT setting
 * {"deliveryOutcome":"delivered","price":999999} fabricated 999,999 of client
 * lifetime revenue.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uid } = require('./helpers');

let srv, agent;
const agentName = 'Val ' + uid();

before(async () => {
  srv = await startServer();
  await srv.api('POST', '/api/agents', { name: agentName, pass: 'valpass12345', role: 'both' });
  agent = await srv.as(agentName, 'valpass12345');
});
after(async () => { if (srv) await srv.stop(); });

const newOrder = (extra = {}) => srv.api('POST', '/api/orders', {
  client: 'Val Client', phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
  price: 1000, ...extra,
});

describe('order fields that no client may write', () => {
  const forbidden = [
    ['deliveryOutcome', 'delivered'],
    ['deliveryOutcomeAt', 1],
    ['phoneNormalized', 'tampered'],
    ['shipmentId', 'SHP-FAKE'],
    ['overdueFlaggedAt', 1],
    ['pendingCallStart', 1],
    ['shopifyId', 'FORGED'],
    ['source', 'forged'],
  ];

  for (const [field, value] of forbidden) {
    test(field + ' is ignored', async () => {
      const { body: o } = await newOrder();
      const before = o[field];
      const { status } = await srv.api('PUT', '/api/orders/' + o.id, { [field]: value });
      assert.equal(status, 200, 'the request still succeeds; the field is dropped');
      const after = (await srv.api('GET', '/api/orders')).body.find((x) => x.id === o.id);
      assert.deepEqual(after[field], before, field + ' must not be client-writable');
    });
  }

  test('forging deliveryOutcome no longer fabricates revenue', async () => {
    const phone = '05' + Math.floor(10000000 + Math.random() * 89999999);
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'Revenue', phone, price: 999999 });
    await srv.api('PUT', '/api/orders/' + o.id, { deliveryOutcome: 'delivered', deliveryOutcomeAt: Date.now() });

    const { body } = await srv.api('GET', '/api/clients?search=' + phone);
    assert.equal(body.items[0].deliveredOrders, 0, 'no delivery was fabricated');
    assert.equal(body.items[0].totalSpent, 0, 'no revenue was fabricated');
  });

  test('the order id itself cannot be changed', async () => {
    const { body: o } = await newOrder();
    await srv.api('PUT', '/api/orders/' + o.id, { id: 'HIJACKED' });
    const { body } = await srv.api('GET', '/api/orders');
    assert.ok(body.some((x) => x.id === o.id));
    assert.ok(!body.some((x) => x.id === 'HIJACKED'));
  });

  test('prototype pollution attempts are dropped', async () => {
    const { body: o } = await newOrder();
    await srv.api('PUT', '/api/orders/' + o.id, JSON.parse('{"__proto__":{"polluted":true},"client":"Safe"}'));
    assert.equal({}.polluted, undefined, 'Object.prototype was not polluted');
    const after = (await srv.api('GET', '/api/orders')).body.find((x) => x.id === o.id);
    assert.equal(after.client, 'Safe', 'the legitimate field still applied');
  });
});

describe('order fields by privilege', () => {
  test('an agent can correct the details they legitimately fix', async () => {
    const { body: o } = await newOrder({ agent: agentName });
    const { status } = await agent.api('PUT', '/api/orders/' + o.id, {
      wilaya: 'Oran', commune: 'Es Senia', quantity: 3, note: 'customer wants three',
    });
    assert.equal(status, 200);
    const after = (await agent.api('GET', '/api/orders')).body.find((x) => x.id === o.id);
    assert.equal(after.wilaya, 'Oran');
    assert.equal(after.quantity, 3);
  });

  test('an agent cannot write manager-only fields', async () => {
    const { body: o } = await newOrder({ agent: agentName });
    await agent.api('PUT', '/api/orders/' + o.id, { managerNote: 'sneaky', marketer: 'me' });
    const after = (await srv.api('GET', '/api/orders')).body.find((x) => x.id === o.id);
    assert.equal(after.managerNote, '', 'managerNote is manager-only');
    assert.equal(after.marketer, '', 'marketer is manager-only');
  });

  test('a manager can write them', async () => {
    const { body: o } = await newOrder();
    await srv.api('PUT', '/api/orders/' + o.id, { managerNote: 'checked', marketer: 'Sara' });
    const after = (await srv.api('GET', '/api/orders')).body.find((x) => x.id === o.id);
    assert.equal(after.managerNote, 'checked');
    assert.equal(after.marketer, 'Sara');
  });
});

describe('settings validation', () => {
  test('an unknown key is refused, not stored', async () => {
    const { status, body } = await srv.api('PUT', '/api/settings', { totallyMadeUpKey: 'yes' });
    assert.equal(status, 400);
    assert.equal(body.code, 'INVALID_SETTINGS');
    const { body: s } = await srv.api('GET', '/api/settings');
    assert.equal(s.totallyMadeUpKey, undefined);
  });

  test('a string where a boolean belongs is refused', async () => {
    // This mattered: `if (s.autoSuspend)` is TRUE for the string "false", so a
    // typo would silently switch on automatic account suspension.
    const { status } = await srv.api('PUT', '/api/settings', { autoSuspend: 'not-a-boolean' });
    assert.equal(status, 400);
    const { body: s } = await srv.api('GET', '/api/settings');
    assert.equal(typeof s.autoSuspend, 'boolean');
  });

  test('out-of-range numbers are refused', async () => {
    const cases = [['suspendThreshold', -5], ['workHoursStart', 99], ['minCallSeconds', -1], ['trackingPollMinutes', 0]];
    for (const [k, v] of cases) {
      const { status } = await srv.api('PUT', '/api/settings', { [k]: v });
      assert.equal(status, 400, k + '=' + v + ' must be refused');
    }
  });

  test('an impossible working-hours window is refused', async () => {
    const { status, body } = await srv.api('PUT', '/api/settings', { workHoursStart: 20, workHoursEnd: 9 });
    assert.equal(status, 400);
    assert.match(body.error, /workHoursEnd/);
  });

  test('an invalid reservation mode is refused', async () => {
    assert.equal((await srv.api('PUT', '/api/settings', { reservationMode: 'whenever' })).status, 400);
    assert.equal((await srv.api('PUT', '/api/settings', { reservationMode: 'on_confirm' })).status, 200);
  });

  test('the internal migration marker cannot be set by hand', async () => {
    const { status } = await srv.api('PUT', '/api/settings', { deliveryOutcomeBackfillAt: 0 });
    assert.equal(status, 400, 'clearing it by hand would re-run the migration');
  });

  test('valid settings still round-trip and coerce numerically', async () => {
    const { status, body } = await srv.api('PUT', '/api/settings', { minCallSeconds: '45', autoAssign: true });
    assert.equal(status, 200);
    assert.equal(body.minCallSeconds, 45, 'a numeric string is coerced to a number');
    assert.equal(body.autoAssign, true);
    assert.equal(body.autoCreateShipment, true, 'unrelated settings are preserved');
  });

  test('a rejected batch changes nothing at all', async () => {
    const { body: before } = await srv.api('GET', '/api/settings');
    await srv.api('PUT', '/api/settings', { minCallSeconds: 33, bogusKey: 1 });
    const { body: after } = await srv.api('GET', '/api/settings');
    assert.equal(after.minCallSeconds, before.minCallSeconds,
      'the valid half of an invalid request must not be applied');
  });

  test('settings changes are recorded in the audit trail', async () => {
    await srv.api('PUT', '/api/settings', { alertMinutes: 77 });
    const Database = require('better-sqlite3');
    const db = new Database(srv.dbPath, { readonly: true });
    const row = db.prepare("SELECT * FROM audit_log WHERE entity='settings' ORDER BY id DESC LIMIT 1").get();
    db.close();
    assert.ok(row, 'a settings change is auditable');
    assert.ok(JSON.parse(row.payload).keys.includes('alertMinutes'));
  });
});
