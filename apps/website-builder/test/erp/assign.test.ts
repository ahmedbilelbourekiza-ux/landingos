import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withTenant } from '@landingos/db';

import {
  skip, phone, makeTenant, makeMember, backdateOrder, slugOf, storefront, checkout, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/assign.test.ts — who work lands on, and when it moves.
 *
 * Three ERP behaviours that Phase 5 never carried across, all of them sharing
 * one eligibility-and-workload rule, which is why they are ported together:
 *
 *   1. `autoAssign()`   — a new order goes to the least-loaded confirmation
 *                         agent (apps/erp/index.js:655).
 *   2. `assignFollowup()` — a confirmed order gets a follow-up agent
 *                         (apps/erp/lib/followup.js:66).
 *   3. auto-reassign    — an order nobody has called moves to somebody else
 *                         (apps/erp/index.js:861).
 *
 * WHAT EVERY TEST HERE IS REALLY ABOUT: work must never be handed to somebody
 * who cannot do it. The ERP could be relaxed about that because its `agents`
 * table held call-centre staff by construction — every row was an agent.
 * `Membership` is not that table. It is EVERYBODY in the company: the
 * bookkeeper, the person who only uses the website builder, the owner. So the
 * eligibility rule is stricter here than it was there, in two ways that each
 * have a test below (D-06.5 and D-06.6).
 *
 * BUG-03 IS THE OTHER HALF. The ERP's follow-up auto-assign setting did nothing
 * for the life of the product: both callers passed `{auto: true}`, so
 * `opts.auto || settings.followupAutoAssign` short-circuited before it ever read
 * the toggle. Every automatic behaviour below is therefore asserted TWICE —
 * once with its setting off and once with it on — because "the feature works" and
 * "the switch works" are different claims and the ERP only ever had the first.
 * ========================================================================== */

let tenantId: string;
/** ADMIN, deliberately with NO job role — see D-06.5. Drives the API. */
let manager: Awaited<ReturnType<typeof makeMember>>;
let alice: Awaited<ReturnType<typeof makeMember>>;
let bob: Awaited<ReturnType<typeof makeMember>>;

const AGENT = { role: 'MEMBER' as const, permissions: ['erp:orders:write'] };

before(async () => {
  if (skip) return;
  tenantId = await makeTenant('assign');
  manager = await makeMember(tenantId, { role: 'ADMIN' });
  alice = await makeMember(tenantId, { ...AGENT, jobRole: 'confirmation' });
  bob = await makeMember(tenantId, { ...AGENT, jobRole: 'confirmation' });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

const settings = (patch: Record<string, unknown>) =>
  manager.api('PUT', '/api/erp/settings', patch);

const newOrder = async (body: Record<string, unknown> = {}) =>
  (await manager.api('POST', '/api/erp/orders', {
    client: 'Assign Customer', phone: phone(), price: 2500, ...body,
  })).body.data as { id: string; agentUserId: string | null };

const readOrder = async (id: string) =>
  (await manager.api('GET', `/api/erp/orders/${id}`)).body.data;

describe('a new order goes to the least-loaded agent', () => {
  test('the setting decides — with autoAssign off, nothing is assigned', async () => {
    // BUG-03's lesson, applied to the other toggle. A feature that ignores its
    // own switch is a feature the manager cannot turn off.
    await settings({ autoAssign: false });
    const order = await newOrder();
    assert.equal(order.agentUserId, null, 'an order was assigned while autoAssign was off');
  });

  test('with autoAssign on, it lands on an eligible agent', async () => {
    await settings({ autoAssign: true });
    const order = await newOrder();
    assert.ok(
      order.agentUserId === alice.userId || order.agentUserId === bob.userId,
      `expected alice or bob, got ${order.agentUserId}`,
    );
  });

  test('a manager naming an agent is not overruled by the automation', async () => {
    await settings({ autoAssign: true });
    const order = await newOrder({ agentUserId: bob.userId });
    assert.equal(order.agentUserId, bob.userId);
  });

  test('D-06.5 — somebody with no job role is never chosen', async () => {
    // The ERP treated a missing role as "confirmation agent" (`!a.role` in
    // autoAssign) because every row in its `agents` table WAS one. On the
    // platform `Membership.jobRole` is null for everybody who has never been
    // made an ERP agent — the accountant, the person who only uses the builder,
    // the owner — so the same fallback would hand a customer's order to
    // somebody who has never seen the product.
    const solo = await makeTenant('assign-norole');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    await makeMember(solo, { ...AGENT }); // no jobRole
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'No Role', phone: phone(),
    })).body.data;
    assert.equal(order.agentUserId, null, 'a member with no job role was given an order');
  });

  test('D-06.6 — somebody who cannot work orders is never chosen', async () => {
    // A job role says what somebody does; the permission says whether the API
    // will let them. Assigning an order to a person `POST /orders/[id]/call`
    // answers 403 for is work nobody can do and a miss counted against somebody
    // who was never able to act — so the automation asks the same question the
    // route asks, with the same function.
    const solo = await makeTenant('assign-noperm');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    await makeMember(solo, { role: 'MEMBER', permissions: [], jobRole: 'confirmation' });
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'No Permission', phone: phone(),
    })).body.data;
    assert.equal(order.agentUserId, null, 'an order went to somebody who cannot log a call on it');
  });

  test('a follow-up-only agent is not part of the confirmation pipeline', async () => {
    const solo = await makeTenant('assign-fuonly');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    await makeMember(solo, { ...AGENT, jobRole: 'followup' });
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'Followup Only', phone: phone(),
    })).body.data;
    assert.equal(order.agentUserId, null, 'a follow-up agent was given a confirmation call');
  });

  test('a suspended agent receives no new work', async () => {
    const solo = await makeTenant('assign-suspended');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const benched = await makeMember(solo, { ...AGENT, jobRole: 'confirmation' });
    await boss.api('POST', `/api/erp/agents/${benched.userId}/suspend`, {});
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'Suspended', phone: phone(),
    })).body.data;
    assert.equal(order.agentUserId, null, 'a suspended agent was given an order');
  });

  test('an agent on their weekly day off receives no new work', async () => {
    // The recurring day-off schedule exists so no order lands on somebody who
    // is not there, every week, with no manager action needed.
    const solo = await makeTenant('assign-dayoff');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const away = await makeMember(solo, { ...AGENT, jobRole: 'confirmation' });
    await boss.api('PUT', `/api/erp/agents/${away.userId}/days-off`, {
      weeklyDaysOff: [new Date().getDay()],
    });
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'Day Off', phone: phone(),
    })).body.data;
    assert.equal(order.agentUserId, null, 'an order landed on an agent who is off today');
  });

  test('another tenant’s agents are never candidates', async () => {
    const solo = await makeTenant('assign-isolation');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    // This tenant has no agents of its own; alice and bob belong to another
    // company. The binding and row-level security are what make that true, and
    // this asserts the assignment path did not find a way around them.
    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'Other Tenant', phone: phone(),
    })).body.data;
    assert.equal(order.agentUserId, null, "another tenant's agent was assigned an order");
  });

  test('the load is spread rather than piled on one person', async () => {
    const solo = await makeTenant('assign-balance');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const one = await makeMember(solo, { ...AGENT, jobRole: 'confirmation' });
    const two = await makeMember(solo, { ...AGENT, jobRole: 'both' });
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const assigned: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      const order = (await boss.api('POST', '/api/erp/orders', {
        client: `Balance ${i}`, phone: phone(),
      })).body.data;
      assigned.push(order.agentUserId);
    }

    assert.equal(assigned.filter((id) => id === one.userId).length, 2);
    assert.equal(assigned.filter((id) => id === two.userId).length, 2);
  });

  test('a storefront sale is assigned the same way a typed-in order is', async () => {
    // The ERP auto-assigned every inbound order, whatever door it came through
    // (`resolveAgent('')` appears on nine separate paths). A storefront checkout
    // that arrived unassigned while a phoned-in one did not would be an order
    // the queue never surfaces to anybody in particular — and the storefront is
    // where most orders come from.
    const solo = await makeTenant('assign-storefront');
    const boss = await makeMember(solo, { role: 'OWNER' });
    const worker = await makeMember(solo, { ...AGENT, jobRole: 'confirmation' });
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const shop = await storefront(solo);
    const placed = await checkout(await slugOf(solo), shop);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));

    const fulfilment = (await withTenant(solo, (db) =>
      (db as any).fulfillmentOrder.findUnique({
        where: { salesOrderId: placed.body.data.id },
        select: { agentUserId: true },
      }),
    )) as { agentUserId: string | null } | null;
    assert.equal(fulfilment?.agentUserId, worker.userId, 'a storefront sale arrived unassigned');
  });

  test('a checkout still succeeds when there is nobody to assign it to', async () => {
    // Assignment is a convenience layered on top of an order; it must never be
    // able to fail a customer's purchase. A tenant that has switched autoAssign
    // on and has no eligible staff yet is the ordinary version of that.
    const solo = await makeTenant('assign-storefront-empty');
    const boss = await makeMember(solo, { role: 'OWNER' });
    await boss.api('PUT', '/api/erp/settings', { autoAssign: true });

    const shop = await storefront(solo);
    const placed = await checkout(await slugOf(solo), shop);
    assert.equal(placed.status, 201, 'the sale was lost because nobody could be assigned');
  });
});

describe('confirming an order assigns a follow-up agent', () => {
  test('the setting decides — with followupAutoAssign off, nobody is assigned', async () => {
    // This is BUG-03 itself: in the ERP this toggle was unreachable, because
    // both callers forced `auto: true`.
    await settings({ autoAssign: false, followupAutoAssign: false, autoCreateShipment: false });
    const order = await newOrder({ agentUserId: alice.userId });
    await alice.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });

    const after = await readOrder(order.id);
    assert.equal(after.status, 'confirmed');
    assert.equal(after.followupUserId, null, 'a follow-up agent was assigned while the toggle was off');
  });

  test('with the toggle on, a confirmed order gets a follow-up agent and a timestamp', async () => {
    const solo = await makeTenant('assign-fu-on');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const worker = await makeMember(solo, { ...AGENT, jobRole: 'confirmation' });
    const chaser = await makeMember(solo, { ...AGENT, jobRole: 'followup' });
    await boss.api('PUT', '/api/erp/settings', {
      followupAutoAssign: true, autoCreateShipment: false,
    });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'Confirm Me', phone: phone(), agentUserId: worker.userId,
    })).body.data;
    await worker.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });

    const after = (await boss.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.equal(after.followupUserId, chaser.userId, 'the follow-up agent was not assigned');
    assert.ok(after.followupAssignedAt, 'the assignment was not timestamped');
  });

  test('a confirmation-only agent is never chosen to follow up', async () => {
    const solo = await makeTenant('assign-fu-role');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const worker = await makeMember(solo, { ...AGENT, jobRole: 'confirmation' });
    await boss.api('PUT', '/api/erp/settings', {
      followupAutoAssign: true, autoCreateShipment: false,
    });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'No Chaser', phone: phone(), agentUserId: worker.userId,
    })).body.data;
    await worker.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });

    const after = (await boss.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.equal(after.followupUserId, null, 'a confirmation-only agent was made the follow-up agent');
  });

  test('a manager’s own choice of follow-up agent is not overwritten', async () => {
    const solo = await makeTenant('assign-fu-manual');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const worker = await makeMember(solo, { ...AGENT, jobRole: 'confirmation' });
    const picked = await makeMember(solo, { ...AGENT, jobRole: 'both' });
    await makeMember(solo, { ...AGENT, jobRole: 'followup' });
    await boss.api('PUT', '/api/erp/settings', {
      followupAutoAssign: true, autoCreateShipment: false,
    });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'Hand Picked', phone: phone(), agentUserId: worker.userId,
    })).body.data;
    await boss.api('PATCH', `/api/erp/orders/${order.id}`, { followupUserId: picked.userId });
    await worker.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });

    const after = (await boss.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.equal(after.followupUserId, picked.userId, 'the automation overrode a deliberate choice');
  });

  test('the two ways of reaching confirmed behave the same', async () => {
    // The ERP learned this one the hard way: a status change through the
    // generic update endpoint skipped the confirm side effects, so stock did
    // not move for a manually-confirmed order. Two doors into one state that
    // behave differently is a bug that only shows up in whichever door is used
    // less.
    const solo = await makeTenant('assign-fu-patch');
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const chaser = await makeMember(solo, { ...AGENT, jobRole: 'followup' });
    await boss.api('PUT', '/api/erp/settings', {
      followupAutoAssign: true, autoCreateShipment: false,
    });

    const order = (await boss.api('POST', '/api/erp/orders', {
      client: 'Patched Confirm', phone: phone(),
    })).body.data;
    await boss.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });

    const after = (await boss.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.equal(after.followupUserId, chaser.userId, 'confirming via PATCH assigned nobody');
  });
});

/**
 * Working hours pinned open and the reassignment threshold at one minute.
 *
 * `reassignMinutes` — not `alertMinutes` — is what governs the sweep, which is
 * the setting the ERP used and the one the automation screen labels as the
 * reassignment delay. See the note in `lib/erp/jobs.ts`.
 */
const WIDE_OPEN = {
  reassignMinutes: 1,
  workHoursStart: 0,
  workHoursEnd: 24,
  nightGraceMinutes: 0,
};

describe('an order nobody has called moves on', () => {
  const runSweep = (caller: Awaited<ReturnType<typeof makeMember>>) =>
    caller.api('POST', '/api/erp/jobs/overdue-sweep', {});

  /** A tenant, a manager, and however many confirmation agents are asked for. */
  const stage = async (label: string, agents: number, patch: Record<string, unknown> = {}) => {
    const id = await makeTenant(label);
    const boss = await makeMember(id, { role: 'ADMIN' });
    const staff: Awaited<ReturnType<typeof makeMember>>[] = [];
    for (let i = 0; i < agents; i += 1) {
      staff.push(await makeMember(id, { ...AGENT, jobRole: 'confirmation' }));
    }
    await boss.api('PUT', '/api/erp/settings', { ...WIDE_OPEN, autoAssign: false, ...patch });
    return { id, boss, staff };
  };

  const staleOrder = async (
    tenant: Awaited<ReturnType<typeof stage>>,
    agentUserId: string,
  ) => {
    const order = (await tenant.boss.api('POST', '/api/erp/orders', {
      client: 'Ignored', phone: phone(), agentUserId,
    })).body.data;
    await backdateOrder(tenant.id, order.id, 10);
    return order.id as string;
  };

  test('with autoReassign off it stays put, flagged', async () => {
    const t = await stage('reassign-off', 2, { autoReassign: false });
    const id = await staleOrder(t, t.staff[0].userId);

    const result = await runSweep(t.boss);
    assert.equal(result.status, 200);
    assert.ok(result.body.data.flagged >= 1, 'nothing was flagged');
    assert.equal(result.body.data.reassigned, 0, 'it moved while autoReassign was off');

    const after = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    assert.equal(after.agentUserId, t.staff[0].userId, 'the order changed hands anyway');
    assert.ok(after.overdueFlaggedAt, 'the order was not flagged');
  });

  test('with autoReassign on it moves to somebody else, and the miss stays with the original agent', async () => {
    const t = await stage('reassign-on', 2, { autoReassign: true });
    const id = await staleOrder(t, t.staff[0].userId);

    const result = await runSweep(t.boss);
    assert.equal(result.body.data.reassigned, 1, 'the order did not move');

    const after = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    assert.equal(after.agentUserId, t.staff[1].userId, 'it went to the wrong person');

    // Accountability follows the person who had it, not the person who now
    // does. Crediting the miss to whoever it landed on next would punish an
    // agent for somebody else's inaction.
    const roster = (await t.boss.api('GET', '/api/erp/agents')).body.data.items as any[];
    assert.equal(roster.find((m) => m.userId === t.staff[0].userId)?.missedOrders, 1);
    assert.equal(roster.find((m) => m.userId === t.staff[1].userId)?.missedOrders, 0);
  });

  test('with nobody else eligible it goes to the unassigned queue', async () => {
    // One agent, so excluding them leaves nobody. The ERP cleared the agent
    // rather than leaving the order with somebody who has already ignored it,
    // and an unassigned order stays visible to every agent — `orderScope` shows
    // the unassigned queue to everyone precisely so work can be picked up.
    const t = await stage('reassign-alone', 1, { autoReassign: true });
    const id = await staleOrder(t, t.staff[0].userId);

    const result = await runSweep(t.boss);
    assert.equal(result.body.data.unassigned, 1, 'it was not moved to the unassigned queue');

    const after = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    assert.equal(after.agentUserId, null, 'the order still belongs to the agent who ignored it');

    const seen = (await t.staff[0].api('GET', '/api/erp/orders')).body.data.items as any[];
    assert.ok(seen.some((o) => o.id === id), 'the unassigned order is invisible to the agents');
  });

  test('a reassigned order is not flagged again the moment the sweep runs next', async () => {
    // THE FAILURE THIS EXISTS TO PREVENT. The ERP cleared `overdueFlaggedAt` on
    // reassignment while computing the deadline from `createdAt`, which never
    // changes — so the very next tick found the order overdue again, counted a
    // miss against the agent who had held it for sixty seconds, and moved it on.
    // One stale order would walk the whole roster in minutes and, with
    // auto-suspend on, lock everybody out. BUG-01 meant that sweep never ran in
    // production, so nobody ever saw it.
    //
    // The clock therefore restarts at the handover: `overdueFlaggedAt` IS the
    // marker, so a reassigned order gets a fresh threshold with its new agent.
    const t = await stage('reassign-clock', 3, { autoReassign: true });
    const id = await staleOrder(t, t.staff[0].userId);

    await runSweep(t.boss);
    const first = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    const holder = first.agentUserId;
    assert.ok(holder && holder !== t.staff[0].userId, 'precondition: it moved once');

    const second = await runSweep(t.boss);
    assert.equal(second.body.data.reassigned, 0, 'it moved twice inside one threshold');
    assert.equal(second.body.data.flagged, 0, 'a second miss was counted a moment later');

    const after = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    assert.equal(after.agentUserId, holder, 'the order changed hands again immediately');

    const roster = (await t.boss.api('GET', '/api/erp/agents')).body.data.items as any[];
    const total = roster.reduce((sum, m) => sum + (m.missedOrders ?? 0), 0);
    assert.equal(total, 1, 'one ignored order produced more than one miss');
  });

  test('once the threshold passes again, the new holder is accountable too', async () => {
    // The other half of the same rule: restarting the clock must not mean the
    // order is never chased again. Accountability continues, it just starts
    // from the handover.
    const t = await stage('reassign-again', 3, { autoReassign: true });
    const id = await staleOrder(t, t.staff[0].userId);

    await runSweep(t.boss);
    const first = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    const holder = first.agentUserId as string;

    // Move the handover into the past the same way the order was staged.
    await backdateOrder(t.id, id, 10, { overdueFlaggedAt: true });

    const second = await runSweep(t.boss);
    assert.equal(second.body.data.flagged, 1, 'the new holder was never chased');

    const roster = (await t.boss.api('GET', '/api/erp/agents')).body.data.items as any[];
    assert.equal(roster.find((m) => m.userId === holder)?.missedOrders, 1);
  });

  test('an order nobody holds is not chased', async () => {
    // The sweep asks "has this person done their job". An order assigned to
    // nobody has no such person, which is why the ERP's own query required a
    // non-empty agent — and why an order that ends up in the unassigned queue
    // leaves the sweep instead of being re-flagged forever.
    const t = await stage('reassign-unowned', 1, { autoReassign: true });
    const order = (await t.boss.api('POST', '/api/erp/orders', {
      client: 'Nobody', phone: phone(),
    })).body.data;
    await backdateOrder(t.id, order.id, 10);

    const result = await runSweep(t.boss);
    assert.equal(result.body.data.flagged, 0, 'an unassigned order was flagged');
  });

  test('reassignMinutes is the setting that governs it, not alertMinutes', async () => {
    // BUG-03 again, in the place it would be least visible: a threshold on the
    // automation screen that the sweep does not read is a manager changing a
    // number and watching nothing happen.
    //
    // The two settings are pinned APART deliberately — a short `alertMinutes`
    // and a long `reassignMinutes` — so this fails if the sweep reads the wrong
    // one. `alertMinutes` is the hourly stale-order alert and the queue badge;
    // it is not how long an agent has to make a call.
    const t = await stage('reassign-threshold', 2, {
      autoReassign: true, reassignMinutes: 600, alertMinutes: 1,
    });
    const id = await staleOrder(t, t.staff[0].userId);

    const result = await runSweep(t.boss);
    assert.equal(result.body.data.flagged, 0, 'an order ten minutes old was chased at a ten-hour threshold');

    const after = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    assert.equal(after.agentUserId, t.staff[0].userId);
  });

  test('a reassignment never crosses into another tenant’s roster', async () => {
    const t = await stage('reassign-isolation', 1, { autoReassign: true });
    const id = await staleOrder(t, t.staff[0].userId);

    await runSweep(t.boss);

    const after = (await t.boss.api('GET', `/api/erp/orders/${id}`)).body.data;
    assert.ok(
      after.agentUserId === null,
      `the order went to ${after.agentUserId}, which is not a member of this tenant`,
    );
  });
});
