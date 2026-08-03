import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, uid, phone, waitFor, makeTenant, makeMember, makeErpTenant, backdateOrder, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/notifications.test.ts — M-16.
 *
 * The port of `apps/erp/test/notifications.test.js`, deferred in Phase 5.1 with
 * the reason recorded in PORTING.md: porting it "against a transport that does
 * not exist would encode a contract nobody has designed". This is the design.
 *
 * WHAT THE AUDIT FOUND, and what every test here is really about. The subsystem
 * was built twice and connected once: rows were written and never read back,
 * `target` was accepted by `push()` and had no column to land in, the badge was
 * an in-memory counter, and the read flag was GLOBAL — one person opening their
 * panel marked everything read for everybody.
 *
 * WHAT CHANGED ON THE PLATFORM, and why the tests look different in one place.
 * The ERP stored one row with a free-text audience and interpreted it on every
 * read; here the audience is resolved AT WRITE TIME and one row is written per
 * recipient. So there is no watermark to poison — the ERP's `{"upToId":
 * 999999999}` parked its watermark in the future and suppressed that account's
 * badge until a million notifications had passed — and the equivalent tests
 * assert the PROPERTY that protected (a hostile read call cannot break your
 * badge) rather than the mechanism that has gone.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let carrierCode = '';

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('notif');

  carrierCode = `nk${uid()}`;
  const created = await acme.manager.api('POST', '/api/erp/carriers', {
    name: 'Notif Carrier', code: carrierCode, adapter: 'mock', apiEnabled: true,
  });
  assert.equal(created.status, 201);
  await acme.manager.api('POST', `/api/erp/carriers/${created.body.data.id}/default`, {});
  await acme.manager.api('PUT', '/api/erp/settings', { autoCreateShipment: true });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

type Caller = Awaited<ReturnType<typeof makeMember>>;

const feed = async (who: Caller, query = '') =>
  (await who.api('GET', `/api/platform/notifications${query}`)).body.data as {
    items: Array<{ id: string; type: string; title: string; body: string; product: string; entityId: string | null; read: boolean; createdAt: string }>;
    unread: number;
  };

const newOrder = async (body: Record<string, unknown> = {}) =>
  (await acme.manager.api('POST', '/api/erp/orders', {
    client: `Notif Buyer ${uid()}`, phone: phone(), price: 4000, carrierCode, ...body,
  })).body.data as { id: string; reference: string };

describe('a notification is stored, not only broadcast', () => {
  test('a new order raises one that survives a reload', async () => {
    // "The single most important thing that happens in this system", and it was
    // broadcast-only: it disappeared on refresh, and anything arriving while the
    // console was closed was never seen at all.
    const order = await newOrder({ agentUserId: acme.agent.userId });

    const seen = await waitFor(
      async () => (await feed(acme.agent)).items.find((n) => n.entityId === order.id),
      { label: 'a stored new_order notification' },
    );

    assert.equal(seen.type, 'new_order');
    assert.equal(seen.product, 'erp', 'the feed says which product raised it');
    assert.ok(seen.title, 'it has something to read');
    assert.ok(seen.createdAt, 'and a time');

    // A "reload" is another GET. The feed comes from the database, not from a
    // counter that resets when the page does.
    const again = await feed(acme.agent);
    assert.ok(again.items.some((n) => n.id === seen.id), 'the notification did not survive a reload');
  });

  test('the feed paginates backwards', async () => {
    await newOrder({ agentUserId: acme.agent.userId });
    await newOrder({ agentUserId: acme.agent.userId });

    const page1 = await feed(acme.agent, '?limit=2');
    if (page1.items.length < 2) return;

    const page2 = await feed(acme.agent, `?limit=2&beforeId=${page1.items[1].id}`);
    for (const n of page2.items) {
      assert.ok(BigInt(n.id) < BigInt(page1.items[1].id), 'a page was not strictly older');
    }
  });

  test('an anonymous caller gets nothing', async () => {
    const r = await fetch('http://127.0.0.1:3000/api/platform/notifications');
    assert.equal(r.status, 401);
  });
});

describe('who a notification is for', () => {
  test('an order’s own agent is told, and a colleague is not', async () => {
    const order = await newOrder({ agentUserId: acme.agent.userId });

    await waitFor(
      async () => (await feed(acme.agent)).items.some((n) => n.entityId === order.id),
      { label: 'the assigned agent to be told' },
    );

    const other = await feed(acme.other, '?limit=200');
    assert.ok(
      !other.items.some((n) => n.entityId === order.id),
      'a different agent was told about somebody else’s order',
    );
  });

  test('whoever sees the whole book is told as well', async () => {
    // The manager holds `erp:clients:read`, which is the same predicate
    // `seesWholeBook` uses to decide who may see every order — so "supervisors"
    // means the same set here as everywhere else in the product.
    const order = await newOrder({ agentUserId: acme.agent.userId });
    await waitFor(
      async () => (await feed(acme.manager, '?limit=200')).items.some((n) => n.entityId === order.id),
      { label: 'the manager to be told' },
    );
  });

  test('a suspicious call is manager-only, and never reaches the agent it is about', async () => {
    // The flag exists because an agent can clear their queue by marking orders
    // confirmed without dialling, and be paid per confirmed order for it.
    // Telling them they were flagged tells them exactly what to change.
    const order = await newOrder({ agentUserId: acme.agent.userId });
    // No call-start, so the result is flagged as `noStart`.
    const logged = await acme.agent.api('POST', `/api/erp/orders/${order.id}/call`, {
      result: 'confirmed',
    });
    assert.equal(logged.body.data.suspicious, true, 'precondition: the call was flagged');

    const forManager = await waitFor(
      async () =>
        (await feed(acme.manager, '?limit=200')).items.find(
          (n) => n.type === 'suspicious_call' && n.entityId === order.id,
        ),
      { label: 'the manager to receive the suspicious-call alert' },
    );
    assert.ok(forManager);

    const forAgent = await feed(acme.agent, '?limit=200');
    assert.ok(
      !forAgent.items.some((n) => n.type === 'suspicious_call'),
      'the agent was told they had been flagged',
    );
  });

  test('an agent never receives an alert about accountability', async () => {
    // agent_overdue and agent_suspended were both stored with `target: null` —
    // "everyone" — in the ERP, so an alert about an agent's own missed order was
    // stored for that agent to read.
    const solo = await makeTenant(`notif-overdue-${uid()}`);
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const victim = await makeMember(solo, {
      role: 'MEMBER', permissions: ['erp:orders:write'], jobRole: 'confirmation',
    });
    await boss.api('PUT', '/api/erp/settings', {
      reassignMinutes: 1, workHoursStart: 0, workHoursEnd: 24, nightGraceMinutes: 0,
    });
    const ignored = (await boss.api('POST', '/api/erp/orders', {
      client: 'Ignored', phone: phone(), agentUserId: victim.userId,
    })).body.data.id as string;
    await backdateOrder(solo, ignored, 10);

    const swept = await boss.api('POST', '/api/erp/jobs/overdue-sweep', {});
    assert.ok(swept.body.data.flagged >= 1, 'precondition: something was flagged');

    const forBoss = await feed(boss, '?limit=200');
    assert.ok(
      forBoss.items.some((n) => n.type === 'agent_overdue'),
      'nobody was told an order went unanswered',
    );

    const forVictim = await feed(victim, '?limit=200');
    assert.ok(
      !forVictim.items.some((n) => n.type === 'agent_overdue'),
      'the agent was told about their own missed order',
    );
  });

  test('a tenant’s notifications are invisible to another', async () => {
    const order = await newOrder({ agentUserId: acme.agent.userId });
    await waitFor(
      async () => (await feed(acme.agent)).items.some((n) => n.entityId === order.id),
      { label: 'the notification' },
    );

    const beta = await makeErpTenant('notif-beta');
    const betaFeed = await feed(beta.manager, '?limit=200');
    assert.equal(
      betaFeed.items.filter((n) => n.entityId === order.id).length, 0,
      "a neighbouring tenant could see this tenant's notifications",
    );
  });

  test('no parameter widens what a caller can see', async () => {
    // The ERP accepted a client-supplied audience filter in three places and
    // honoured it. There is no such parameter here, and asking for one changes
    // nothing.
    const mine = await feed(acme.other, '?limit=200');
    const asked = (await acme.other.api(
      'GET',
      `/api/platform/notifications?limit=200&targetUserId=${acme.manager.userId}&userId=${acme.manager.userId}`,
    )).body.data as { items: Array<{ id: string }> };

    assert.deepEqual(
      asked.items.map((n) => n.id), mine.items.map((n) => n.id),
      'a caller-supplied parameter changed whose feed was returned',
    );
  });
});

describe('the badge is per account and cannot be broken', () => {
  test('one person reading theirs does not clear anybody else’s', async () => {
    // The old global `read` flag did exactly that.
    const order = await newOrder({ agentUserId: acme.agent.userId });
    await waitFor(async () => (await feed(acme.agent)).unread > 0, { label: 'agent unread' });
    await waitFor(async () => (await feed(acme.manager)).unread > 0, { label: 'manager unread' });

    const managerBefore = (await feed(acme.manager)).unread;

    const read = await acme.agent.api('POST', '/api/platform/notifications/read', {});
    assert.equal(read.status, 200);
    assert.equal(read.body.data.unread, 0, 'the agent is not clear');

    assert.equal(
      (await feed(acme.manager)).unread, managerBefore,
      "somebody else reading cleared the manager's badge",
    );
    void order;
  });

  test('reading up to an id leaves newer ones unread', async () => {
    await acme.manager.api('POST', '/api/platform/notifications/read', {});
    assert.equal((await feed(acme.manager)).unread, 0);

    const first = await newOrder();
    await waitFor(async () => (await feed(acme.manager)).unread >= 1, { label: 'one unread' });
    const upTo = (await feed(acme.manager, '?limit=1')).items[0].id;

    const second = await newOrder();
    await waitFor(async () => (await feed(acme.manager)).unread >= 2, { label: 'two unread' });

    await acme.manager.api('POST', '/api/platform/notifications/read', { upToId: upTo });

    const after = await feed(acme.manager, '?limit=200');
    assert.ok(after.unread >= 1, 'reading up to an id cleared newer ones too');
    assert.equal(
      after.items.find((n) => n.entityId === first.id)?.read, true,
      'the older one is not marked read',
    );
    assert.equal(
      after.items.find((n) => n.entityId === second.id)?.read, false,
      'a notification newer than the watermark was swallowed',
    );
  });

  test('a hostile read call cannot suppress the badge', async () => {
    // The ERP's watermark was a stored number, so `{"upToId": 999999999}` parked
    // it in the future and this account's badge stayed at zero until a million
    // notifications had been raised. There is no such number here — marking read
    // is an UPDATE over rows that exist — and this asserts the property that
    // protected rather than the mechanism.
    await acme.manager.api('POST', '/api/platform/notifications/read', { upToId: '999999999999' });
    assert.equal((await feed(acme.manager)).unread, 0);

    const order = await newOrder();
    const back = await waitFor(
      async () => {
        const f = await feed(acme.manager, '?limit=200');
        return f.unread > 0 ? f : null;
      },
      { label: 'the badge to work again after a hostile read' },
    );
    assert.ok(back.items.some((n) => n.entityId === order.id));
  });

  test('junk never breaks the account', async () => {
    for (const upToId of [-5, 'abc', null, {}, [], true]) {
      const r = await acme.manager.api('POST', '/api/platform/notifications/read', { upToId });
      assert.equal(r.status, 200, `upToId=${JSON.stringify(upToId)} errored`);
      assert.ok(Number.isFinite(r.body.data.unread), 'the count is still a number');
    }
    // And the feed still works afterwards.
    assert.ok(Array.isArray((await feed(acme.manager)).items));
  });

  test('the unread count is exactly the unread rows', async () => {
    await acme.manager.api('POST', '/api/platform/notifications/read', {});
    await newOrder();
    await newOrder();

    const after = await waitFor(
      async () => {
        const f = await feed(acme.manager, '?limit=200');
        return f.unread >= 2 ? f : null;
      },
      { label: 'two unread notifications' },
    );
    assert.equal(
      after.unread, after.items.filter((n) => !n.read).length,
      'the badge disagrees with the feed it is counting',
    );
  });
});

describe('the scheduled work reports itself', () => {
  test('escalating follow-up reminders tells the supervisors, once', async () => {
    const solo = await makeTenant(`notif-esc-${uid()}`);
    const boss = await makeMember(solo, { role: 'ADMIN' });
    const worker = await makeMember(solo, {
      role: 'MEMBER', permissions: ['erp:orders:write'], jobRole: 'both',
    });
    const orderId = (await boss.api('POST', '/api/erp/orders', {
      client: 'Escalate', phone: phone(),
    })).body.data.id as string;

    const { makeFollowupTask } = await import('./helpers.ts');
    await makeFollowupTask(solo, {
      orderId, agentUserId: worker.userId, dueAt: new Date(Date.now() - 60_000),
    });

    const first = await boss.api('POST', '/api/erp/jobs/followup-escalation', {});
    assert.equal(first.body.data.escalated, 1);

    const forBoss = await feed(boss, '?limit=200');
    const alerts = forBoss.items.filter((n) => n.type === 'followup_overdue');
    assert.equal(alerts.length, 1, 'the escalation was not reported exactly once');

    // The second pass escalates nothing, so it must say nothing. An alert that
    // repeats every minute for the same fact is an alert nobody reads.
    await boss.api('POST', '/api/erp/jobs/followup-escalation', {});
    assert.equal(
      (await feed(boss, '?limit=200')).items.filter((n) => n.type === 'followup_overdue').length,
      1,
      'a pass that escalated nothing still raised an alert',
    );
  });

  test('the stale-order alert counts what is waiting, and uses alertMinutes', async () => {
    // The ERP's second loop, and the home `alertMinutes` always had. It is a
    // supervision number — how much work is untouched right now — which is a
    // different question from the sweep's "who is at fault", and a different
    // threshold.
    const solo = await makeTenant(`notif-stale-${uid()}`);
    const boss = await makeMember(solo, { role: 'ADMIN' });
    await boss.api('PUT', '/api/erp/settings', {
      alertMinutes: 600, workHoursStart: 0, workHoursEnd: 24,
    });

    const orderId = (await boss.api('POST', '/api/erp/orders', {
      client: 'Waiting', phone: phone(),
    })).body.data.id as string;
    await backdateOrder(solo, orderId, 60);

    const quiet = await boss.api('POST', '/api/erp/jobs/stale-orders', {});
    assert.equal(quiet.body.data.stale, 0, 'an hour-old order was stale at a ten-hour threshold');

    await boss.api('PUT', '/api/erp/settings', { alertMinutes: 30 });
    const loud = await boss.api('POST', '/api/erp/jobs/stale-orders', {});
    assert.ok(loud.body.data.stale >= 1, 'the threshold was never reached');

    const alert = (await feed(boss, '?limit=200')).items.find((n) => n.type === 'stale_orders');
    assert.ok(alert, 'nobody was told');
    assert.match(alert!.body, /30 minutes/, 'the alert does not say what threshold it used');
  });

  test('a called order is not counted as waiting', async () => {
    const solo = await makeTenant(`notif-stale2-${uid()}`);
    const boss = await makeMember(solo, { role: 'ADMIN' });
    await boss.api('PUT', '/api/erp/settings', {
      alertMinutes: 1, workHoursStart: 0, workHoursEnd: 24,
    });
    const orderId = (await boss.api('POST', '/api/erp/orders', {
      client: 'Tried', phone: phone(),
    })).body.data.id as string;
    await boss.api('POST', `/api/erp/orders/${orderId}/call`, { result: 'no_answer' });
    await backdateOrder(solo, orderId, 30);

    const r = await boss.api('POST', '/api/erp/jobs/stale-orders', {});
    assert.equal(r.body.data.stale, 0, 'an order somebody has already tried was counted as untouched');
  });
});

describe('delivery', () => {
  test('a parcel moving tells whoever is chasing it', async () => {
    const order = await newOrder({ agentUserId: acme.agent.userId });
    await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment/refresh`, {});

    const seen = await waitFor(
      async () =>
        (await feed(acme.agent, '?limit=200')).items.find(
          (n) => n.entityId === order.id && n.type === 'delivery_update',
        ),
      { label: 'a delivery notification' },
    );
    assert.ok(seen.title.includes(order.reference), 'the alert does not name the order');
  });
});
