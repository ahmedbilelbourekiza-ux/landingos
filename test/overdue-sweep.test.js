/* =============================================================================
 * test/overdue-sweep.test.js — audit BUG-01.
 *
 * runOverdueSweep() referenced an undeclared `minutes`, so it threw
 * ReferenceError on the first overdue order of every run. The setInterval
 * wrapper caught and logged it, so the only symptom was that the entire
 * accountability system — missed-order counter, manager alert, reassignment,
 * unassigned queue and auto-suspend — never did anything.
 *
 * These tests drive the real sweep on a shortened interval and assert each
 * downstream effect actually happens.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, waitFor, uid } = require('./helpers');

let srv;

before(async () => {
  srv = await startServer({ CRM_SWEEP_INTERVAL_MS: '400' });
  // Work around the working-hours gate so the sweep runs whatever time the
  // test happens to execute, and make every pending order immediately overdue.
  await srv.api('PUT', '/api/settings', {
    workHoursStart: 0, workHoursEnd: 24,
    reassignMinutes: 0.01, nightGraceMinutes: 0.01,   // ~600ms: Number(0)||5 would mean 5 MINUTES
    autoReassign: false, autoSuspend: false, suspendThreshold: 3,
    autoAssign: false,
  });
});
after(async () => { if (srv) await srv.stop(); });

/** Create an agent and an order already assigned to them, with no calls. */
async function seedOverdueOrder(agentName, opts = {}) {
  await srv.api('POST', '/api/agents', { name: agentName, pass: 'x', role: 'confirmation', ...opts });
  const { body: order } = await srv.api('POST', '/api/orders', {
    client: 'Overdue ' + agentName,
    phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
    agent: agentName,
  });
  return order;
}


/* Suspend every agent EXCEPT the signed-in manager, so reassignment has a
 * deterministic candidate pool. Suspending the manager would revoke this
 * test's own session — which the server now refuses outright. */
async function parkOtherAgents() {
  const { body } = await srv.api('GET', '/api/agents');
  const others = body.filter((a) => a.name !== srv.admin.name && !a.suspended);
  for (const a of others) await srv.api('POST', `/api/agents/${encodeURIComponent(a.name)}/suspend`);
  return others;
}
async function unparkAgents(list) {
  for (const a of list) await srv.api('POST', `/api/agents/${encodeURIComponent(a.name)}/reactivate`);
}

const agentByName = async (name) =>
  (await srv.api('GET', '/api/agents')).body.find((a) => a.name === name);

describe('overdue sweep (BUG-01)', () => {
  test('the sweep runs without throwing', async () => {
    const name = 'Sweep ' + uid();
    await seedOverdueOrder(name);
    await waitFor(async () => (await agentByName(name)).missedOrders > 0, {
      label: 'missedOrders to increment', timeout: 8000,
    });
    assert.ok(!srv.logs().includes('ReferenceError'), 'the sweep must not throw');
    assert.ok(!srv.logs().includes('run failed'), 'the interval wrapper caught nothing');
  });

  test('an overdue order increments the agent missed counter exactly once', async () => {
    const name = 'Once ' + uid();
    await seedOverdueOrder(name);
    await waitFor(async () => (await agentByName(name)).missedOrders >= 1, { label: 'first flag' });
    // Several more sweep ticks must not double-count the same timeout.
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal((await agentByName(name)).missedOrders, 1, 'the same timeout is counted once');
  });

  test('the order is flagged so it leaves the candidate set', async () => {
    const name = 'Flag ' + uid();
    const order = await seedOverdueOrder(name);
    await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/orders');
      return body.find((o) => o.id === order.id)?.overdueFlaggedAt;
    }, { label: 'overdueFlaggedAt to be set' });
  });

  test('the miss is written to the audit trail with elapsed minutes', async () => {
    const name = 'Audit ' + uid();
    const order = await seedOverdueOrder(name);
    await waitFor(async () => (await agentByName(name)).missedOrders >= 1, { label: 'flagged' });

    const Database = require('better-sqlite3');
    const db = new Database(srv.dbPath, { readonly: true });
    const row = db.prepare(
      "SELECT * FROM audit_log WHERE entity='order' AND entityId=? AND action='overdue_missed'"
    ).get(order.id);
    db.close();

    assert.ok(row, 'an overdue_missed audit row was written');
    const payload = JSON.parse(row.payload);
    assert.equal(payload.agent, name);
    assert.equal(typeof payload.minutes, 'number', 'elapsed minutes is a real number');
    assert.ok(Number.isFinite(payload.minutes));
    assert.equal(typeof payload.thresholdMinutes, 'number');
  });

  test('a call in progress protects the order from being swept', async () => {
    const name = 'InCall ' + uid();
    const order = await seedOverdueOrder(name);
    await srv.api('POST', `/api/orders/${order.id}/call-start`);
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal((await agentByName(name)).missedOrders, 0, 'an agent mid-call is never pulled');
  });

  test('an order with a logged call is never swept', async () => {
    const name = 'Called ' + uid();
    const order = await seedOverdueOrder(name);
    await srv.api('POST', `/api/orders/${order.id}/call`, { result: 'no_answer' });
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal((await agentByName(name)).missedOrders, 0, 'a logged call clears the order');
  });

  test('a manager can reset the missed counter', async () => {
    const name = 'Reset ' + uid();
    await seedOverdueOrder(name);
    await waitFor(async () => (await agentByName(name)).missedOrders >= 1, { label: 'flagged' });
    await srv.api('POST', `/api/agents/${encodeURIComponent(name)}/reset-missed`);
    assert.equal((await agentByName(name)).missedOrders, 0);
  });
});

describe('overdue sweep — reassignment and suspension', () => {
  // The bootstrapped manager is created with role 'both', so it is itself an
  // eligible confirmation agent and would compete for reassigned orders. It
  // cannot be suspended (it is the only manager, and the server refuses), so
  // move it out of the confirmation pool by role instead.
  before(async () => {
    await srv.api('PUT', `/api/agents/${encodeURIComponent(srv.admin.name)}/role`, { role: 'followup' });
  });

  test('with autoReassign on, the order moves to another eligible agent', async () => {
    // Earlier tests leave eligible agents behind, and reassignment picks the
    // least-loaded of ALL candidates — so park them first to make the target
    // deterministic.
    const existing = await parkOtherAgents();

    await srv.api('PUT', '/api/settings', { autoReassign: true });
    const from = 'From ' + uid();
    const to = 'To ' + uid();
    await srv.api('POST', '/api/agents', { name: to, pass: 'x', role: 'confirmation' });
    const order = await seedOverdueOrder(from);

    const moved = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/orders');
      const o = body.find((x) => x.id === order.id);
      return o && o.agent !== from ? o : null;
    }, { label: 'the order to be reassigned' });

    assert.equal(moved.agent, to, 'reassigned to the only other eligible agent');
    assert.equal((await agentByName(from)).missedOrders, 1, 'the original agent still takes the miss');
    assert.equal(moved.overdueFlaggedAt, null, 'the flag is cleared so the new agent gets a fresh clock');

    await srv.api('PUT', '/api/settings', { autoReassign: false });
    await unparkAgents(existing);
  });

  test('an agent on their weekly day off is never given a reassigned order', async () => {
    const existing = await parkOtherAgents();

    await srv.api('PUT', '/api/settings', { autoReassign: true });
    const from = 'DayOffFrom ' + uid();
    const off = 'DayOffTo ' + uid();
    await srv.api('POST', '/api/agents', { name: off, pass: 'x', role: 'confirmation' });
    // Mark today (Algeria local) as this agent's recurring day off.
    const todayAlgeria = new Date(Date.now() + 3600 * 1000).getUTCDay();
    await srv.api('PUT', `/api/agents/${encodeURIComponent(off)}/days-off`, { weeklyDaysOff: [todayAlgeria] });

    const order = await seedOverdueOrder(from);
    const result = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/orders');
      const o = body.find((x) => x.id === order.id);
      return o && o.agent !== from ? o : null;
    }, { label: 'the order to leave the original agent' });

    assert.equal(result.agent, '', 'it goes to the unassigned queue, not to the agent who is off');

    await srv.api('PUT', '/api/settings', { autoReassign: false });
    await unparkAgents(existing);
  });

  test('with no eligible agent, the order lands in the unassigned queue', async () => {
    await srv.api('PUT', '/api/settings', { autoReassign: true });
    const lonely = 'Lonely ' + uid();
    // Suspend everyone else so no candidate remains.
    const all = await parkOtherAgents();
    const order = await seedOverdueOrder(lonely);

    const orphaned = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/orders');
      const o = body.find((x) => x.id === order.id);
      return o && o.agent === '' ? o : null;
    }, { label: 'the order to be unassigned' });

    assert.ok(orphaned.overdueFlaggedAt, 'flagged, which is what distinguishes it from never-assigned');
    // Restore for later tests.
    await unparkAgents(all);
    await srv.api('PUT', '/api/settings', { autoReassign: false });
  });

  test('an agent is auto-suspended once the threshold is reached', async () => {
    await srv.api('PUT', '/api/settings', { autoSuspend: true, suspendThreshold: 2, autoReassign: false });
    const name = 'Strike ' + uid();
    await seedOverdueOrder(name);
    await waitFor(async () => (await agentByName(name)).missedOrders >= 1, { label: 'first miss' });

    // A second, separate order produces the second miss and crosses the threshold.
    await srv.api('POST', '/api/orders', {
      client: 'Second', phone: '05' + Math.floor(10000000 + Math.random() * 89999999), agent: name,
    });
    await waitFor(async () => (await agentByName(name)).suspended === true, {
      label: 'the agent to be auto-suspended', timeout: 8000,
    });

    const a = await agentByName(name);
    assert.ok(a.missedOrders >= 2);
    assert.equal(a.suspended, true);
    await srv.api('PUT', '/api/settings', { autoSuspend: false });
  });

  test('the working-hours window gates the sweep', async () => {
    // A window that cannot contain "now" — the sweep must do nothing.
    const nowHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Algiers', hour: 'numeric', hourCycle: 'h23',
    }).format(Date.now()));
    const start = (nowHour + 2) % 24;
    const end = start + 1;
    await srv.api('PUT', '/api/settings', { workHoursStart: start, workHoursEnd: end });

    const name = 'OffHours ' + uid();
    await seedOverdueOrder(name);
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal((await agentByName(name)).missedOrders, 0, 'nothing is counted outside working hours');

    await srv.api('PUT', '/api/settings', { workHoursStart: 0, workHoursEnd: 24 });
  });
});
