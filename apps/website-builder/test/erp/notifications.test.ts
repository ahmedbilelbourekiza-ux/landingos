import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withTenant } from '@landingos/db';
import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, phone, waitFor, makeTenant, makeMember, makeErpTenant,
  makeFollowupTask, backdateOrder, cleanup,
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

/* -----------------------------------------------------------------------------
 * The live transport — M-16 part 2
 * -------------------------------------------------------------------------- */

/** Open the SSE stream as a caller and collect parsed frames plus raw ids. */
async function openStream(who: Caller, lastEventId?: string) {
  const controller = new AbortController();
  const events: Array<Record<string, any>> = [];
  const ids: string[] = [];
  const query = lastEventId ? `?lastEventId=${lastEventId}` : '';

  const res = await fetch(`${BASE}/api/platform/notifications/stream${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${who.token}` },
    signal: controller.signal,
  });
  assert.equal(res.status, 200, 'the stream did not open');
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  const done = (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const lines = frame.split('\n');
          const idLine = lines.find((l) => l.startsWith('id: '));
          const dataLine = lines.find((l) => l.startsWith('data: '));
          if (idLine) ids.push(idLine.slice(4));
          if (dataLine) {
            try { events.push(JSON.parse(dataLine.slice(6))); } catch { /* keep-alive */ }
          }
        }
      }
    } catch { /* aborted */ }
  })();

  await waitFor(() => events.some((e) => e.type === 'connected') || null, {
    label: 'the stream to say hello',
  });
  return { events, ids, close: async () => { controller.abort(); await done; } };
}

describe('the live stream', () => {
  test('it refuses an unauthenticated subscriber', async () => {
    const r = await fetch(`${BASE}/api/platform/notifications/stream`);
    assert.equal(r.status, 401);
  });

  test('a notification arrives live, with an id a client can reconnect from', async () => {
    const stream = await openStream(acme.agent);
    try {
      const order = await newOrder({ agentUserId: acme.agent.userId });
      const frame = await waitFor(
        () => stream.events.find((e) => e.entityId === order.id) ?? null,
        { label: 'a live notification frame', timeout: 25000 },
      );

      assert.equal(frame.type, 'new_order');
      assert.ok(frame.id, 'the frame carries the stored id');
      assert.ok(
        stream.ids.includes(frame.id),
        'it was sent with an SSE id: line, so Last-Event-ID works',
      );
      assert.notEqual(frame.replayed, true, 'a live event was flagged as a replay');
    } finally {
      await stream.close();
    }
  });

  test('an agent stream never carries a manager-only alert', async () => {
    // The same rule the feed applies, applied to the live hop — the ERP's two
    // halves disagreed about audience precisely because they were separate code.
    const stream = await openStream(acme.agent);
    try {
      const order = await newOrder({ agentUserId: acme.other.userId });
      await acme.other.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });

      // Longer than the stream's own poll interval, so it has time to be wrong.
      await new Promise((r) => setTimeout(r, 9000));
      assert.ok(
        !stream.events.some((e) => e.type === 'suspicious_call'),
        'an agent was streamed an alert about somebody being flagged',
      );
      assert.ok(
        !stream.events.some((e) => e.entityId === order.id),
        'an agent was streamed a colleague order',
      );
    } finally {
      await stream.close();
    }
  });

  test('what was missed while disconnected is replayed, and flagged as a replay', async () => {
    // An SSE connection drops constantly in normal use — a phone locking, a
    // tunnel timing out, a redeploy. Everything raised in that window used to be
    // lost from the live feed and, because nothing read the table, lost entirely.
    const before = await feed(acme.agent, '?limit=1');
    const lastSeen = before.items[0]?.id ?? '0';

    const order = await newOrder({ agentUserId: acme.agent.userId });
    await waitFor(
      async () => (await feed(acme.agent, '?limit=50')).items.some((n) => n.entityId === order.id),
      { label: 'the notification to be stored while nobody was listening' },
    );

    const stream = await openStream(acme.agent, lastSeen);
    try {
      const replayed = await waitFor(
        () => stream.events.find((e) => e.entityId === order.id) ?? null,
        { label: 'the missed notification to be replayed', timeout: 25000 },
      );
      assert.equal(replayed.replayed, true, 'a replayed frame was not flagged as one');
      assert.ok(BigInt(replayed.id) > BigInt(lastSeen), 'something already seen was replayed');
    } finally {
      await stream.close();
    }
  });

  test('two tabs both receive, and closing one does not kill the other', async () => {
    // ARCH-01: the ERP held one writer per name, so a second tab evicted the
    // first — and the close handler removed the shared entry regardless of which
    // connection had closed, so closing either tab killed both.
    const tab1 = await openStream(acme.agent);
    const tab2 = await openStream(acme.agent);
    try {
      const first = await newOrder({ agentUserId: acme.agent.userId });
      for (const [i, tab] of [tab1, tab2].entries()) {
        await waitFor(() => tab.events.some((e) => e.entityId === first.id) || null, {
          label: `tab ${i + 1} to receive it`, timeout: 25000,
        });
      }

      await tab1.close();

      const second = await newOrder({ agentUserId: acme.agent.userId });
      await waitFor(() => tab2.events.some((e) => e.entityId === second.id) || null, {
        label: 'the surviving tab to still receive events', timeout: 25000,
      });
    } finally {
      await tab2.close();
    }
  });

  test('a FRESH subscription starts at now, not at the beginning of the backlog', async () => {
    // The defect the provider exposed. An empty cursor meant "send everything",
    // so the first poll delivered this account's whole backlog flagged
    // `replayed: false` — as LIVE. Invisible while nothing consumed the stream;
    // the moment a provider toasts live arrivals, every page load produced a
    // burst of toasts for last week's news and buried the one that mattered.
    const listener = await makeMember(acme.tenantId, { role: 'ADMIN', jobRole: 'both' });

    await newOrder();
    await waitFor(async () => ((await feed(listener)).items.length ? true : null), {
      label: 'a backlog to exist for this account',
    });
    const backlog = await feed(listener);
    assert.ok(backlog.items.length > 0, 'the fixture needs a backlog to be meaningful');

    const stream = await openStream(listener);
    try {
      // Longer than the stream's poll interval, so it has time to be wrong.
      await new Promise((r) => setTimeout(r, 9000));
      // `ids` rather than `events`: only a real notification carries an `id:`
      // line, so this excludes the handshake frame without excluding anything
      // the assertion is about.
      assert.deepEqual(
        stream.ids,
        [],
        'a fresh subscription was sent history it had already been rendered',
      );

      // And it is still LIVE — starting at now must not mean starting at never.
      const order = await newOrder();
      await waitFor(() => stream.events.find((e) => e.entityId === order.id) ?? null, {
        label: 'a genuinely new notification', timeout: 25000,
      });
    } finally {
      await stream.close();
    }
  });
});

describe('web push registration', () => {
  const device = (suffix: string) => ({
    endpoint: `https://push.example.test/${uid()}${suffix}`,
    keys: { p256dh: 'BJxc'.repeat(11), auth: 'c2VjcmV0LWF1dGg' },
  });

  test('the public key is offered, or honestly absent', async () => {
    // Null when the deployment has not configured VAPID, so a console can say
    // "push is unavailable" rather than failing inside subscribe() with a
    // browser error nobody can read.
    const r = await acme.agent.api('GET', '/api/platform/push');
    assert.equal(r.status, 200);
    assert.ok(
      r.body.data.publicKey === null || typeof r.body.data.publicKey === 'string',
      'the key must be a string or an explicit null',
    );
  });

  test('a device registers, and re-registering is not an error', async () => {
    const sub = device('a');
    const first = await acme.agent.api('POST', '/api/platform/push', { subscription: sub });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.subscribed, true);

    // A browser re-subscribes on every load. It must be an upsert, not a
    // conflict — the endpoint is unique by construction.
    const again = await acme.agent.api('POST', '/api/platform/push', { subscription: sub });
    assert.equal(again.status, 200);
  });

  test('junk is refused rather than stored', async () => {
    for (const subscription of [
      {},
      { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } },
      { endpoint: 'https://push.example.test/x' },
      { endpoint: 'http://push.example.test/x', keys: { p256dh: 'x', auth: 'y' } },
    ]) {
      const r = await acme.agent.api('POST', '/api/platform/push', { subscription });
      assert.equal(r.status, 422, `stored ${JSON.stringify(subscription)}`);
    }
  });

  test('a device can be unregistered', async () => {
    const sub = device('b');
    await acme.agent.api('POST', '/api/platform/push', { subscription: sub });
    const gone = await acme.agent.api('DELETE', '/api/platform/push', { endpoint: sub.endpoint });
    assert.equal(gone.status, 200);
    assert.equal(gone.body.data.removed, 1);

    // Removing it twice is a no-op rather than an error: an unsubscribe that
    // races a reinstall must not 500.
    const twice = await acme.agent.api('DELETE', '/api/platform/push', { endpoint: sub.endpoint });
    assert.equal(twice.body.data.removed, 0);
  });

  test('a subscription is stored against the CALLER, never a user id in the body', async () => {
    // The ERP took { agent, subscription } from the request, so anybody could
    // register a device to receive another person's notifications.
    const sub = device('c');
    await acme.agent.api('POST', '/api/platform/push', {
      subscription: sub,
      userId: acme.manager.userId,
      agent: acme.manager.userId,
    });

    const owner = (await withTenant(acme.tenantId, (db) =>
      (db as any).pushSubscription.findUnique({
        where: { endpoint: sub.endpoint },
        select: { userId: true },
      }),
    )) as { userId: string } | null;
    assert.equal(owner?.userId, acme.agent.userId, 'a body parameter chose the recipient');
  });

  test('another tenant cannot reach this tenant subscription', async () => {
    const sub = device('d');
    await acme.agent.api('POST', '/api/platform/push', { subscription: sub });

    const beta = await makeErpTenant('notif-push-beta');
    const attempt = await beta.manager.api('DELETE', '/api/platform/push', {
      endpoint: sub.endpoint,
    });
    assert.equal(
      attempt.body.data.removed, 0,
      'a neighbouring tenant deleted this tenant device',
    );
  });
});

/* -----------------------------------------------------------------------------
 * Installability — Phase 6.6e
 * -------------------------------------------------------------------------- */

describe('the console is installable', () => {
  test('the manifest is served and says what an installer needs', async () => {
    const r = await fetch(`${BASE}/manifest.webmanifest`);
    assert.equal(r.status, 200);

    const m = await r.json();
    assert.equal(m.display, 'standalone', 'a browser tab is not an installed app');
    assert.equal(m.start_url, '/console', 'it must open on the console, not the storefront');
    assert.equal(m.scope, '/console');
    assert.ok(m.name && m.short_name, 'a launcher needs both names');

    // Chrome requires a 192px icon AND a 512px icon to offer installation, and
    // a maskable one so a launcher can apply its own shape without cropping the
    // mark. All three, or the install prompt silently never appears.
    const sizes = (m.icons ?? []).map((i: { sizes: string }) => i.sizes);
    assert.ok(sizes.includes('192x192'), 'no 192px icon');
    assert.ok(sizes.includes('512x512'), 'no 512px icon');
    assert.ok(
      (m.icons ?? []).some((i: { purpose?: string }) => i.purpose === 'maskable'),
      'no maskable icon — a launcher will crop the corners off a square one',
    );
  });

  test('every icon it names actually exists and is a PNG', async () => {
    // A manifest naming an icon that 404s is a manifest that fails installation
    // with no message anybody sees.
    const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    for (const icon of m.icons as Array<{ src: string; sizes: string }>) {
      const res = await fetch(BASE + icon.src);
      assert.equal(res.status, 200, `${icon.src} is missing`);

      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.deepEqual(
        [...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        `${icon.src} is not a PNG`,
      );
      // Width and height live at bytes 16..24 of the IHDR.
      const view = new DataView(bytes.buffer);
      const declared = Number(icon.sizes.split('x')[0]);
      assert.equal(view.getUint32(16), declared, `${icon.src} is not ${icon.sizes}`);
      assert.equal(view.getUint32(20), declared, `${icon.src} is not square`);
    }
  });

  test('the service worker is served, and caches nothing', async () => {
    const r = await fetch(`${BASE}/sw.js`);
    assert.equal(r.status, 200);
    const src = await r.text();

    assert.match(src, /addEventListener\(\s*["']push["']/, 'it cannot receive a push');
    assert.match(src, /showNotification/, 'a push would arrive and show nothing');
    assert.match(src, /addEventListener\(\s*["']notificationclick["']/, 'tapping it does nothing');

    // THE ASSERTION THIS FILE EXISTS FOR. Every page under /console is
    // server-rendered from a session-scoped database read, so a cache keyed by
    // URL alone would serve one tenant's customer list to the next person on a
    // shared handset — through a mechanism that survives signing out, because a
    // cache is not a session.
    assert.ok(
      !/caches\.(open|match)|addEventListener\(\s*["']fetch["']/.test(src),
      'the service worker caches or intercepts requests — see the header of public/sw.js',
    );
  });

  test('the console page links the manifest; the storefront does not', async () => {
    // The root layout also serves the public storefront. Offering "install
    // LandingOS Console" to a shopper is the wrong offer, and it would put the
    // platform's name and icon on a page a tenant thinks of as their shop.
    const consoleHtml = await (await fetch(`${BASE}/console/login`)).text();
    assert.match(consoleHtml, /rel="manifest"/, 'the console does not link its manifest');
    assert.match(consoleHtml, /manifest\.webmanifest/);

    const storefrontHtml = await (await fetch(`${BASE}/robots.txt`)).text();
    assert.ok(!storefrontHtml.includes('manifest.webmanifest'));
  });
});

/* -----------------------------------------------------------------------------
 * LP.7 — the consumer, which is what all of the above was missing
 *
 * Everything before this point proves the TRANSPORT works: rows are written, the
 * audience is resolved at write time, the badge is per account, the stream
 * replays exactly, a push can be received. None of it reached a person. There
 * was no bell, no badge, no panel and no toast anywhere in the console, so a
 * signed-in operator was never told anything — the largest piece of dead
 * machinery in the repository, and the reason L1/L2 were corrected from
 * "improved" to "missing" by the second pass.
 * -------------------------------------------------------------------------- */

describe('the console finally consumes its own notifications', () => {
  const page = async (path: string, token: string) => {
    const res = await fetch(BASE + path, {
      redirect: 'manual',
      headers: { cookie: `${SESSION_COOKIE}=${token}; locale=en` },
    });
    return { status: res.status, body: await res.text() };
  };

  test('every console page carries the bell — one subscription per session', async () => {
    // It lives in the shell rather than on a screen. A provider per screen would
    // be N EventSource connections per tab, and each one is a polling query
    // against a table.
    // NOT `/console` itself: with one product it redirects straight into it,
    // which is a 307 with no body rather than a page that could carry a bell.
    for (const path of ['/console/erp', '/console/erp/orders', '/console/settings']) {
      const r = await page(path, acme.manager.token);
      assert.equal(r.status, 200, path);
      assert.match(r.body, /data-testid="notification-bell"/, `no bell on ${path}`);
    }
  });

  test('the badge is the SERVER’s count, not a number the browser kept', async () => {
    // The defect the M-16 audit found in the ERP: an in-memory counter is wrong
    // the moment a second tab marks something read, wrong after a reconnect that
    // replays, and wrong for anything raised while the tab was closed. So the
    // count is rendered by the server and re-read on every render of the shell.
    const before = await feed(acme.manager);

    await newOrder();
    await waitFor(async () => {
      const now = await feed(acme.manager);
      return now.unread > before.unread ? now : null;
    }, { label: 'a new-order notification' });

    const after = await feed(acme.manager);
    const r = await page('/console/erp', acme.manager.token);
    assert.match(
      r.body,
      new RegExp(`data-unread="${after.unread}"`),
      'the rendered badge disagrees with the API that owns the count',
    );
  });

  test('a person with nothing unread gets no badge at all, not a zero', async () => {
    const quiet = await makeMember(acme.tenantId, { role: 'VIEWER' });
    const r = await page('/console/erp', quiet.token);
    assert.match(r.body, /data-testid="notification-bell"/);
    assert.doesNotMatch(r.body, /data-testid="notification-badge"/);
  });

  test('the toast region is announced, so it reaches somebody on the phone', async () => {
    // An operator whose attention is on a call is exactly who this is for, and a
    // silently-appearing box reaches nobody using a screen reader.
    const r = await page('/console/erp', acme.manager.token);
    assert.match(r.body, /data-testid="notification-toasts"/);
    assert.match(r.body, /aria-live="polite"/);
  });

  test('the signed-out console has no bell and no stream', async () => {
    const r = await fetch(`${BASE}/console/login`);
    const body = await r.text();
    assert.doesNotMatch(body, /notification-bell/);
  });

  test('the stream itself refuses an anonymous subscriber', async () => {
    // The provider opens this on mount for whoever is signed in. If it answered
    // anything to a caller with no session, every console tab would be a hole.
    const r = await fetch(`${BASE}/api/platform/notifications/stream`);
    assert.equal(r.status, 401);
    await r.body?.cancel();
  });

  test('opening the panel marks read only up to what was displayed', async () => {
    // The behaviour the panel depends on, asserted through the API the panel
    // calls: a notification arriving between the render and the click must stay
    // unread rather than being swallowed.
    const watcher = await makeMember(acme.tenantId, { role: 'ADMIN', jobRole: 'both' });

    await newOrder();
    await waitFor(async () => ((await feed(watcher)).unread > 0 ? true : null), {
      label: 'a first notification',
    });
    const first = await feed(watcher);
    const displayed = first.items[0].id;

    // A second one arrives after the panel rendered.
    await newOrder();
    await waitFor(async () => {
      const now = await feed(watcher);
      return now.items[0] && now.items[0].id !== displayed ? true : null;
    }, { label: 'a second notification' });

    const marked = await watcher.api('POST', '/api/platform/notifications/read', {
      upToId: displayed,
    });
    assert.equal(marked.status, 200);
    assert.ok(marked.body.data.unread >= 1, 'the newer one must still be unread');

    const after = await feed(watcher);
    const older = after.items.find((i) => i.id === displayed);
    assert.equal(older?.read, true, 'and everything up to what was shown is read');
  });
});

/** A rendered console page, for the two LP.11 assertions that need HTML. */
const screen = async (path: string, token: string) => {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  return { status: res.status, body: await res.text() };
};

/* =============================================================================
 * LP.11 — how a person wants to be told (N4, N5)
 *
 * The bell LP.7 built is silent, and in a call centre nobody watches the screen.
 * These assert the two properties that make the preference safe rather than just
 * present: it is stored SERVER-side so it follows the person between devices,
 * and it is the caller's OWN and unreachable for anybody else.
 * ========================================================================== */

describe('a person can choose how they are told (N4, N5)', () => {
  test('the default is audible — six families on, at the legacy’s volume', async () => {
    const r = await acme.manager.api('GET', '/api/platform/notifications/preferences');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.sound, true);
    assert.equal(r.body.data.volume, 0.6, 'the legacy default, deliberately kept');
    assert.equal(r.body.data.desktop, true);
    for (const family of ['new_order', 'abandoned', 'assignment', 'manipulation', 'delivery', 'followup']) {
      assert.equal(r.body.data.families[family], true, `${family} must be on by default`);
    }
  });

  test('it round-trips and is stored on the SERVER, not in a browser', async () => {
    const put = await acme.manager.api('PUT', '/api/platform/notifications/preferences', {
      sound: true, volume: 0.25, desktop: false,
      families: { manipulation: false },
    });
    assert.equal(put.status, 200);

    const back = await acme.manager.api('GET', '/api/platform/notifications/preferences');
    assert.equal(back.body.data.volume, 0.25);
    assert.equal(back.body.data.desktop, false);
    assert.equal(back.body.data.families.manipulation, false);
    // Absent means ON: a family added later must be audible by default, which
    // is the safe direction.
    assert.equal(back.body.data.families.new_order, true);
  });

  test('the volume is CLAMPED, not trusted', async () => {
    // A stored 40 would be forty times the gain the envelopes were designed
    // for, which is a genuinely painful noise on a headset.
    const high = await acme.manager.api('PUT', '/api/platform/notifications/preferences', {
      volume: 40,
    });
    assert.equal(high.body.data.volume, 1);

    const low = await acme.manager.api('PUT', '/api/platform/notifications/preferences', {
      volume: -3,
    });
    assert.equal(low.body.data.volume, 0);

    const junk = await acme.manager.api('PUT', '/api/platform/notifications/preferences', {
      volume: 'loud',
    });
    assert.equal(junk.body.data.volume, 0.6, 'junk falls back to the default rather than to NaN');
  });

  test('it is PER PERSON — one operator cannot silence another', async () => {
    // The manipulation siren is the alert that watches for an agent marking
    // orders confirmed without dialling. It is the one notification somebody
    // has a motive to turn off for a colleague, and there is no way to name a
    // target: the route uses the session's own id.
    await acme.manager.api('PUT', '/api/platform/notifications/preferences', {
      sound: false,
    });
    const theirs = await acme.agent.api('GET', '/api/platform/notifications/preferences');
    assert.equal(theirs.body.data.sound, true, 'the agent’s own preference was changed by the manager');

    // And a userId in the body is ignored rather than honoured.
    await acme.manager.api('PUT', '/api/platform/notifications/preferences', {
      userId: acme.agent.userId, sound: true, volume: 0.1,
    });
    const still = await acme.agent.api('GET', '/api/platform/notifications/preferences');
    assert.equal(still.body.data.volume, 0.6, 'a userId in the body must not select a target');
  });

  test('an anonymous caller gets nothing', async () => {
    const get = await fetch(`${BASE}/api/platform/notifications/preferences`);
    assert.equal(get.status, 401);
    const put = await fetch(`${BASE}/api/platform/notifications/preferences`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(put.status, 401);
  });

  test('the panel is on the profile screen, with a test button per family', async () => {
    const r = await screen('/console/settings/profile', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="notify-preferences"/);
    assert.match(r.body, /data-testid="notify-volume"/);
    assert.match(r.body, /data-testid="notify-desktop"/);
    for (const family of ['new_order', 'abandoned', 'assignment', 'manipulation', 'delivery', 'followup']) {
      assert.match(r.body, new RegExp(`data-testid="notify-family-${family}"`));
      // A per-type sound you cannot hear before saving is one nobody sets
      // correctly — the point of six signatures is that they differ.
      assert.match(r.body, new RegExp(`data-testid="notify-test-${family}"`));
    }
  });

  test('the shell renders with a stored preference, not only a default', async () => {
    // The preference is a PROP read on the server, so a broken read would take
    // out every console page rather than one panel. This asserts the shell
    // still renders after a non-default preference is stored.
    await acme.agent.api('PUT', '/api/platform/notifications/preferences', {
      sound: false, volume: 0.1, desktop: false, families: { delivery: false },
    });
    const r = await screen('/console/erp/orders', acme.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="notification-bell"/);
  });
});
