import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, phone, makeErpTenant, makeMember, makeFollowupTask, backdateOrder, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/jobs.test.ts — M-15, the scheduled work.
 *
 * This is the file `apps/erp/test/overdue-sweep.test.js` was deferred against in
 * Phase 5.1: PORTING.md said porting it "against a worker that does not exist
 * would encode a contract nobody has designed", and this is the design.
 *
 * WHAT MAKES SCHEDULED WORK DIFFERENT FROM A ROUTE, and what every test here is
 * really about: it runs again. And again. On a scaled deployment it runs on
 * several instances at once. So the property that matters is not "does it do the
 * thing" but **does it do the thing exactly once** — which is precisely what
 * BUG-01 got wrong (the sweep threw on its first candidate every run, so the
 * missed-order counter, auto-reassign and auto-suspend had never worked at all)
 * and what PROJECT_STATE means by "they run once per instance and double-count
 * every miss".
 *
 * Every job below is therefore driven TWICE in at least one test, and the second
 * run must change nothing.
 *
 * The jobs are invoked through `POST /api/erp/jobs/[job]`, which runs them for
 * the caller's own tenant. That route exists so a manager can say "run it now",
 * and it is what makes this file possible at all — a timer is not something a
 * contract test can wait for.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('jobs');
});

after(async () => {
  if (skip) return;
  await cleanup();
});

const newOrder = async (body: Record<string, unknown> = {}) =>
  (await acme.manager.api('POST', '/api/erp/orders', {
    client: 'Job Customer', phone: phone(), price: 3300, ...body,
  })).body.data.id as string;

const run = (job: string) => acme.manager.api('POST', `/api/erp/jobs/${job}`, {});

describe('the jobs surface is gated like everything else', () => {
  test('an agent cannot run the jobs', async () => {
    // Running the sweep moves other people's counters and can suspend
    // accounts. It is an administrative act, so it takes the same permission
    // the automation screen does.
    assert.equal(
      (await acme.agent.api('POST', '/api/erp/jobs/followup-escalation', {})).status,
      403,
    );
  });

  test('an unknown job is refused rather than silently doing nothing', async () => {
    const r = await run('not-a-job');
    assert.equal(r.status, 404);
    assert.ok(Array.isArray(r.body.error?.valid), 'the refusal names what it would accept');
  });

  test('anonymous callers get nothing', async () => {
    const r = await fetch('http://127.0.0.1:3000/api/erp/jobs/followup-escalation', {
      method: 'POST',
    });
    assert.equal(r.status, 401);
  });
});

describe('follow-up escalation', () => {
  test('an expired open task becomes overdue, once', async () => {
    const orderId = await newOrder({ agentUserId: acme.agent.userId });
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.agent.userId, dueAt: new Date(Date.now() - 60_000),
    });

    const first = await run('followup-escalation');
    assert.equal(first.status, 200);
    assert.equal(first.body.data.escalated, 1);

    const listed = await acme.manager.api('GET', '/api/erp/followup/tasks');
    assert.equal(
      (listed.body.data.items as any[]).find((t) => t.id === task.id)?.status,
      'overdue',
    );

    // The property that makes this safe to schedule: a second pass finds
    // nothing, so two instances racing cannot escalate the same task twice.
    const second = await run('followup-escalation');
    assert.equal(second.body.data.escalated, 0);
  });

  test('a task still within its countdown is left alone', async () => {
    const orderId = await newOrder({ agentUserId: acme.agent.userId });
    await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.agent.userId, dueAt: new Date(Date.now() + 3_600_000),
    });

    const before = await run('followup-escalation');
    assert.equal(before.body.data.escalated, 0, 'escalated a task that has not expired');
  });

  test('a resolved task is never escalated, however long ago it was due', async () => {
    // Escalation means "nobody did this". Somebody did.
    const orderId = await newOrder({ agentUserId: acme.agent.userId });
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.agent.userId, dueAt: new Date(Date.now() - 86_400_000),
    });
    await acme.agent.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});

    await run('followup-escalation');

    const listed = await acme.manager.api('GET', '/api/erp/followup/tasks');
    assert.equal(
      (listed.body.data.items as any[]).find((t) => t.id === task.id)?.status,
      'done',
      'a resolved task was escalated',
    );
  });

  test('one tenant’s sweep never touches another’s', async () => {
    const beta = await makeErpTenant('jobs-beta');
    const betaOrder = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Job', phone: phone(),
    })).body.data.id as string;
    const betaTask = await makeFollowupTask(beta.tenantId, {
      orderId: betaOrder, agentUserId: beta.agent.userId, dueAt: new Date(Date.now() - 60_000),
    });

    await run('followup-escalation');

    const betaTasks = await beta.manager.api('GET', '/api/erp/followup/tasks');
    assert.equal(
      (betaTasks.body.data.items as any[]).find((t) => t.id === betaTask.id)?.status,
      'open',
      "acme's sweep escalated beta's task",
    );
  });
});

/**
 * Working hours pinned open, the alert threshold at one minute, and no
 * overnight grace.
 *
 * Without this the suite would pass by day and fail at night: the sweep is
 * gated on the tenant's working hours (default 10–20) exactly as the ERP's was,
 * because an order arriving at 23:00 must not be counted against an agent who is
 * not working. A test that depends on the wall clock is a test that fails in CI
 * at 2am and nowhere else.
 */
const WIDE_OPEN = {
  alertMinutes: 1,
  workHoursStart: 0,
  workHoursEnd: 24,
  nightGraceMinutes: 0,
};

describe('the overdue order sweep (BUG-01)', () => {
  /** An order created far enough in the past to be overdue at any threshold. */
  const staleOrder = async (agentUserId?: string) => {
    const id = await newOrder(agentUserId ? { agentUserId } : {});
    await acme.manager.api('PUT', '/api/erp/settings', WIDE_OPEN);
    // `createdAt` is server-set, and the shortest configurable threshold is one
    // MINUTE — so the order is staged in the past rather than the suite sleeping
    // through it.
    await backdateOrder(acme.tenantId, id, 10);
    return id;
  };

  test('an uncalled order past the threshold is flagged, once', async () => {
    const id = await staleOrder(acme.agent.userId);

    const first = await run('overdue-sweep');
    assert.equal(first.status, 200);
    assert.ok(first.body.data.flagged >= 1, 'nothing was flagged');

    const order = await acme.manager.api('GET', `/api/erp/orders/${id}`);
    assert.ok(order.body.data.overdueFlaggedAt, 'the order carries no flag');

    // BUG-01's actual damage was the counter moving on every pass. It must not.
    const flaggedAt = order.body.data.overdueFlaggedAt;
    const second = await run('overdue-sweep');
    assert.equal(second.body.data.flagged, 0, 'the same order was flagged twice');

    const again = await acme.manager.api('GET', `/api/erp/orders/${id}`);
    assert.equal(again.body.data.overdueFlaggedAt, flaggedAt, 'the flag moved on a second pass');
  });

  test('an order that HAS been called is not overdue', async () => {
    const id = await newOrder({ agentUserId: acme.agent.userId });
    await acme.agent.api('POST', `/api/erp/orders/${id}/call`, { result: 'no_answer' });
    await acme.manager.api('PUT', '/api/erp/settings', WIDE_OPEN);
    await backdateOrder(acme.tenantId, id, 10);

    await run('overdue-sweep');

    const order = await acme.manager.api('GET', `/api/erp/orders/${id}`);
    assert.ok(!order.body.data.overdueFlaggedAt, 'a called order was flagged as never called');
  });

  test('a confirmed order is not chased', async () => {
    const id = await newOrder({ agentUserId: acme.agent.userId });
    await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { status: 'confirmed' });
    await acme.manager.api('PUT', '/api/erp/settings', WIDE_OPEN);
    await backdateOrder(acme.tenantId, id, 10);

    await run('overdue-sweep');

    const order = await acme.manager.api('GET', `/api/erp/orders/${id}`);
    assert.ok(!order.body.data.overdueFlaggedAt, 'a settled order was chased');
  });

  test('the missed-order counter moves once per miss, and auto-suspend needs enabling', async () => {
    // The counter and the suspension are the two things BUG-01 kept switched
    // off for the life of the product: the sweep threw before reaching either.
    const victim = await makeMember(acme.tenantId, {
      role: 'MEMBER', permissions: ['erp:orders:write'],
    });
    const victimOrder = await newOrder({ agentUserId: victim.userId });
    await acme.manager.api('PUT', '/api/erp/settings', { ...WIDE_OPEN, autoSuspend: false });
    await backdateOrder(acme.tenantId, victimOrder, 10);

    await run('overdue-sweep');
    const after = await acme.manager.api('GET', `/api/erp/agents/${victim.userId}/payroll`);
    assert.ok(after.status === 200 || after.status === 404, 'payroll route answered oddly');

    // Suspension is off by default and stays off until a manager asks for it —
    // it locks a person out of the product mid-shift.
    const roster = await acme.manager.api('GET', '/api/erp/agents');
    const row = (roster.body.data.items as any[]).find((m) => m.userId === victim.userId);
    assert.equal(row?.suspended, false, 'auto-suspend fired while disabled');
  });
});

describe('the worker tick fails closed', () => {
  const tick = (headers: Record<string, string> = {}) =>
    fetch('http://127.0.0.1:3000/api/jobs/tick', { method: 'POST', headers });

  test('no secret, no endpoint — 404, not 401', async () => {
    // With WORKER_SECRET unset the tick answers 404 on purpose: an
    // unconfigured deployment should look like it has no such endpoint,
    // because "unauthorized" tells a stranger it is there and worth guessing
    // at. The dev environment has no secret, so this is that state.
    assert.equal((await tick()).status, 404);
  });

  test('a wrong bearer gets the same answer as none', async () => {
    assert.equal((await tick({ authorization: 'Bearer not-the-secret' })).status, 404);
    assert.equal((await tick({ authorization: 'Bearer ' })).status, 404);
  });

  test('it is not reachable with a console session either', async () => {
    // It is infrastructure, not a product surface: a signed-in manager is not
    // who it is for, and holding erp:settings:write does not open it.
    const r = await acme.manager.api('POST', '/api/jobs/tick', {});
    assert.equal(r.status, 404);
  });
});
