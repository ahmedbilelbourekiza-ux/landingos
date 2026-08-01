/* =============================================================================
 * test/notifications.test.js
 *
 * The audit found this subsystem built twice and connected once: rows were
 * written to the database and never read back, `target` was accepted but had no
 * column to land in, the badge was a bare in-memory counter, and the read flag
 * was global — one person opening their panel marked everything read for
 * everybody.
 *
 * These tests cover persistence, recipient targeting, per-account read state,
 * SSE delivery and replay, and XSS-safety.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, waitFor, uid } = require('./helpers');

let srv, agentA, agentB, providerCode;
const nameA = 'NotifA ' + uid();
const nameB = 'NotifB ' + uid();

before(async () => {
  srv = await startServer();
  await srv.api('POST', '/api/agents', { name: nameA, pass: 'notifa12345', role: 'both' });
  await srv.api('POST', '/api/agents', { name: nameB, pass: 'notifb12345', role: 'both' });
  agentA = await srv.as(nameA, 'notifa12345');
  agentB = await srv.as(nameB, 'notifb12345');

  providerCode = 'nk' + uid();
  const { body: p } = await srv.api('POST', '/api/providers', {
    name: 'Notif Carrier', code: providerCode, adapter: 'mock', apiEnabled: true,
  });
  await srv.api('POST', `/api/providers/${p.id}/default`);
  await srv.api('PUT', '/api/settings', { autoCreateShipment: true });
});
after(async () => { if (srv) await srv.stop(); });

/** Open an authenticated SSE stream and collect parsed frames + raw ids. */
async function openStream(token, { lastEventId } = {}) {
  const controller = new AbortController();
  const events = [];
  const ids = [];
  const qs = lastEventId ? `?lastEventId=${lastEventId}` : '';
  const headers = { Cookie: `crm_session=${token}` };

  const res = await fetch(`${srv.base}/api/notifications/subscribe${qs}`, { headers, signal: controller.signal });
  assert.equal(res.status, 200, 'stream opened');

  const done = (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const idLine = frame.split('\n').find((l) => l.startsWith('id: '));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (idLine) ids.push(Number(idLine.slice(4)));
          if (dataLine) { try { events.push(JSON.parse(dataLine.slice(6))); } catch {} }
        }
      }
    } catch { /* aborted */ }
  })();

  await waitFor(async () => events.some((e) => e.type === 'connected'), { label: 'SSE connect' });
  return { events, ids, close: async () => { controller.abort(); await done; } };
}

/** Drive a parcel to delivered, which raises a real delivery notification. */
async function deliverOrderFor(agentName) {
  const { body: order } = await srv.api('POST', '/api/orders', {
    client: 'Notif Buyer', phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
    price: 4000, agent: agentName, delivery: providerCode,
  });
  await srv.api('PUT', `/api/orders/${order.id}`, { status: 'confirmed' });
  for (let i = 0; i < 8; i++) {
    const { body } = await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);
    if ((body.events || []).some((e) => e.crmStatus === 'delivered')) break;
  }
  return order;
}

describe('persistence and history', () => {
  test('a notification raised by a real event is stored and readable', async () => {
    const order = await deliverOrderFor(nameA);
    const list = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications');
      return body.items.some((n) => n.orderId === order.id) ? body : null;
    }, { label: 'a stored delivery notification' });

    const n = list.items.find((x) => x.orderId === order.id);
    assert.ok(n.id > 0, 'has an id');
    assert.ok(n.type.startsWith('delivery_'), 'typed');
    assert.ok(n.title, 'has a title');
    assert.ok(n.createdAt > 0);
  });

  test('history survives a server restart', async () => {
    const { body: before } = await srv.api('GET', '/api/notifications');
    assert.ok(before.items.length > 0);

    const dbPath = srv.dbPath;
    await srv.stop();
    srv = await startServer({ CRM_DB_PATH: dbPath });
    agentA = await srv.as(nameA, 'notifa12345');
    agentB = await srv.as(nameB, 'notifb12345');

    const { body: after } = await srv.api('GET', '/api/notifications');
    assert.equal(after.items.length, before.items.length, 'nothing was lost on restart');
    assert.equal(after.items[0].id, before.items[0].id);
  });

  test('history paginates backwards', async () => {
    const { body: page1 } = await srv.api('GET', '/api/notifications?limit=2');
    if (page1.items.length < 2) return;   // not enough data yet
    const { body: page2 } = await srv.api('GET', `/api/notifications?limit=2&beforeId=${page1.items[1].id}`);
    for (const n of page2.items) {
      assert.ok(n.id < page1.items[1].id, 'strictly older');
    }
  });
});

describe('recipient targeting', () => {
  test('a manager-only alert never reaches the agent it is about', async () => {
    // Force an overdue sweep so a real agent_overdue alert is raised.
    const s = await startServer({ CRM_SWEEP_INTERVAL_MS: '300' });
    try {
      const victim = 'Missed ' + uid();
      await s.api('POST', '/api/agents', { name: victim, pass: 'missed12345', role: 'confirmation' });
      await s.api('PUT', '/api/settings', {
        workHoursStart: 0, workHoursEnd: 24, reassignMinutes: 0.01,
        nightGraceMinutes: 0.01, autoReassign: false, autoSuspend: false,
      });
      await s.api('POST', '/api/orders', {
        client: 'Ignored', phone: '0555' + Math.floor(100000 + Math.random() * 899999), agent: victim,
      });

      const managerView = await waitFor(async () => {
        const { body } = await s.api('GET', '/api/notifications');
        return body.items.some((n) => n.type === 'agent_overdue') ? body : null;
      }, { label: 'the manager to receive agent_overdue', timeout: 10000 });

      const alert = managerView.items.find((n) => n.type === 'agent_overdue');
      assert.equal(alert.target, 'manager', 'stored as manager-only');
      assert.match(alert.body, new RegExp(victim), 'it is about this agent');

      const asVictim = await s.as(victim, 'missed12345');
      const { body: victimView } = await asVictim.api('GET', '/api/notifications');
      assert.ok(!victimView.items.some((n) => n.type === 'agent_overdue'),
        'the agent must NOT see the alert about their own missed order');
    } finally {
      await s.stop();
    }
  });

  test('a delivery notification reaches its own agent and the manager, nobody else', async () => {
    const order = await deliverOrderFor(nameA);

    const forA = await waitFor(async () => {
      const { body } = await agentA.api('GET', '/api/notifications');
      return body.items.some((n) => n.orderId === order.id) ? body : null;
    }, { label: 'agent A to receive it' });
    assert.ok(forA.items.some((n) => n.orderId === order.id));

    const { body: forB } = await agentB.api('GET', '/api/notifications');
    assert.ok(!forB.items.some((n) => n.orderId === order.id),
      'a different agent must not see it');

    const { body: forManager } = await srv.api('GET', '/api/notifications');
    assert.ok(forManager.items.some((n) => n.orderId === order.id),
      'the manager sees everything');
  });

  test('an agent cannot read another account’s notifications by any parameter', async () => {
    const { body } = await agentB.api('GET', '/api/notifications?limit=200');
    for (const n of body.items) {
      assert.ok(n.target === null || n.target === '' || n.target === nameB,
        `agent B received a notification targeted at ${n.target}`);
    }
  });
});

describe('read state and badge counts', () => {
  test('the unread count is per account, not global', async () => {
    await deliverOrderFor(nameA);
    await waitFor(async () => (await agentA.api('GET', '/api/notifications')).body.unread > 0,
      { label: 'agent A has unread' });

    const aBefore = (await agentA.api('GET', '/api/notifications')).body.unread;
    const mBefore = (await srv.api('GET', '/api/notifications')).body.unread;
    assert.ok(aBefore > 0 && mBefore > 0);

    // Agent A reads theirs. The manager's count must be untouched — the old
    // global `read` flag cleared it for everyone.
    const { body: read } = await agentA.api('POST', '/api/notifications/read', {});
    assert.equal(read.unread, 0, 'agent A is now clear');
    assert.equal((await srv.api('GET', '/api/notifications')).body.unread, mBefore,
      'the manager count is unaffected by somebody else reading');
  });

  test('the badge count survives a refresh', async () => {
    await srv.api('POST', '/api/notifications/read', {});
    assert.equal((await srv.api('GET', '/api/notifications')).body.unread, 0);

    await deliverOrderFor(nameB);
    const after = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications');
      return body.unread > 0 ? body : null;
    }, { label: 'a new unread notification' });

    // A "refresh" is just another GET — the count comes from the server, not
    // from a counter that resets to zero when the page reloads.
    const reloaded = (await srv.api('GET', '/api/notifications')).body;
    assert.equal(reloaded.unread, after.unread, 'the same count on reload');
    assert.ok(reloaded.lastReadId >= 0);
  });

  test('reading up to a specific id leaves newer ones unread', async () => {
    const s = await startServer();
    try {
      const a = 'Water ' + uid();
      await s.api('POST', '/api/agents', { name: a, pass: 'water12345', role: 'both' });
      const client = await s.as(a, 'water12345');

      // Raise three, addressed to this agent.
      for (let i = 0; i < 3; i++) {
        await s.api('POST', `/api/agents/${encodeURIComponent(a)}/suspend`).catch(() => {});
      }
      // Simpler and deterministic: use the manager's own feed.
      const { body: all } = await s.api('GET', '/api/notifications?limit=200');
      if (all.items.length < 2) return;

      const middle = all.items[Math.floor(all.items.length / 2)].id;
      await s.api('POST', '/api/notifications/read', { upToId: middle });
      const { body } = await s.api('GET', '/api/notifications');
      const expected = all.items.filter((n) => n.id > middle).length;
      assert.equal(body.unread, expected, 'only notifications newer than the watermark stay unread');
      assert.equal(body.lastReadId, middle);
      void client;
    } finally {
      await s.stop();
    }
  });

  test('the read watermark never moves backwards', async () => {
    const { body: first } = await srv.api('POST', '/api/notifications/read', {});
    const high = first.lastReadId;
    assert.ok(high > 0);
    const { body: second } = await srv.api('POST', '/api/notifications/read', { upToId: 1 });
    assert.equal(second.lastReadId, high,
      'a late or out-of-order request must not resurrect dismissed notifications');
  });
});

describe('live delivery over SSE', () => {
  test('a stored notification arrives live with an id', async () => {
    const stream = await openStream(srv.jar.get('crm_session'));
    try {
      const order = await deliverOrderFor(nameA);
      const ev = await waitFor(
        async () => stream.events.find((e) => e.notificationId && e.orderId === order.id),
        { label: 'a live notification frame', timeout: 12000 }
      );
      assert.ok(ev.notificationId > 0, 'carries the stored id');
      // The presence of notificationId — not a name prefix — is what marks an
      // event as storable, so clients keep branching on the type they always
      // did while the badge counts only what the server also persisted.
      assert.ok(ev.type && !ev.type.startsWith('notif_'), 'the type stays unprefixed for existing handlers');
      assert.equal(ev.notifType, ev.type, 'notifType mirrors it for generic rendering');
      assert.ok(stream.ids.includes(ev.notificationId), 'sent with an SSE id: line for Last-Event-ID');
    } finally {
      await stream.close();
    }
  });

  test('an agent’s stream never receives a manager-only notification', async () => {
    const stream = await openStream(agentB.token);
    try {
      // A DISPOSABLE agent, because suspending an account revokes its sessions
      // — suspending agentA here would silently break every later test that
      // still uses agentA's token.
      const throwaway = 'Throwaway ' + uid();
      await srv.api('POST', '/api/agents', { name: throwaway, pass: 'throw12345', role: 'confirmation' });
      await srv.api('POST', `/api/agents/${encodeURIComponent(throwaway)}/suspend`);
      await new Promise((r) => setTimeout(r, 600));
      assert.ok(!stream.events.some((e) => String(e.type).includes('agent_suspended')),
        'agent B must not be told another agent was suspended');
    } finally {
      await stream.close();
    }
  });

  test('missed notifications are replayed on reconnect', async () => {
    // Note where we are, disconnect, generate traffic, reconnect from that id.
    const { body: before } = await srv.api('GET', '/api/notifications');
    const lastSeen = before.items[0]?.id || 0;

    const order = await deliverOrderFor(nameA);
    await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications');
      return body.items.some((n) => n.orderId === order.id);
    }, { label: 'notification stored while disconnected' });

    const stream = await openStream(srv.jar.get('crm_session'), { lastEventId: lastSeen });
    try {
      const replayed = await waitFor(
        async () => stream.events.find((e) => e.replayed && e.orderId === order.id),
        { label: 'the missed notification to be replayed' }
      );
      assert.equal(replayed.replayed, true, 'flagged as a replay');
      assert.ok(replayed.notificationId > lastSeen);
    } finally {
      await stream.close();
    }
  });

  test('two tabs for the same account both receive events', async () => {
    const tab1 = await openStream(srv.jar.get('crm_session'));
    const tab2 = await openStream(srv.jar.get('crm_session'));
    try {
      const order = await deliverOrderFor(nameA);
      for (const [i, s] of [tab1, tab2].entries()) {
        await waitFor(async () => s.events.some((e) => e.orderId === order.id),
          { label: `tab ${i + 1} to receive it`, timeout: 12000 });
      }
    } finally {
      await tab1.close(); await tab2.close();
    }
  });

  test('closing one tab does not kill the other', async () => {
    const tab1 = await openStream(srv.jar.get('crm_session'));
    const tab2 = await openStream(srv.jar.get('crm_session'));
    await tab1.close();                       // the old code deleted the shared entry here
    try {
      const order = await deliverOrderFor(nameA);
      await waitFor(async () => tab2.events.some((e) => e.orderId === order.id),
        { label: 'the surviving tab to still receive events', timeout: 12000 });
    } finally {
      await tab2.close();
    }
  });

  test('the stream refuses an unauthenticated subscriber', async () => {
    const r = await fetch(`${srv.base}/api/notifications/subscribe`);
    assert.equal(r.status, 401);
  });
});

describe('XSS safety', () => {
  test('a hostile customer name is stored verbatim and never rendered as HTML', async () => {
    const payload = '<img src=x onerror="window.__xss=1">';
    const { body: order } = await srv.api('POST', '/api/orders', {
      client: payload, phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
      price: 1000, agent: nameA, delivery: providerCode,
    });
    await srv.api('PUT', `/api/orders/${order.id}`, { status: 'confirmed' });

    const list = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications?limit=100');
      return body.items.some((n) => n.orderId === order.id) ? body : null;
    }, { label: 'a notification mentioning the hostile name' });

    // The API is a JSON API: it stores and returns the value unchanged. The
    // defence belongs in the renderer, which is asserted below.
    assert.ok(list.items.some((n) => n.orderId === order.id));

    // Both clients must escape before writing into innerHTML.
    const fs = require('node:fs');
    for (const file of ['index.html', 'agent.html']) {
      const src = fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
      const fn = src.slice(src.indexOf('function renderNotifList'));
      const body = fn.slice(0, fn.indexOf('\n}'));
      assert.ok(body.includes('escapeHtml(String(n.title'), `${file} escapes the title`);
      assert.ok(body.includes('escapeHtml(String(n.body'), `${file} escapes the body`);
      assert.ok(!/\$\{n\.title\}|'\+n\.title\+'/.test(body), `${file} has no raw title interpolation`);
      assert.ok(!/\$\{n\.body\}|'\+n\.body\+'/.test(body), `${file} has no raw body interpolation`);
    }
  });
});

describe('retention', () => {
  test('pruning keeps the newest rows and never breaks the watermark', async () => {
    const db = require('../lib/db');
    const before = db.getNotifications({ isManager: true, name: 'x' }, { limit: 200 });
    const removed = db.pruneNotifications(5);
    const after = db.getNotifications({ isManager: true, name: 'x' }, { limit: 200 });

    if (before.length > 5) {
      assert.ok(removed > 0, 'something was pruned');
      assert.ok(after.length <= 5 + 1);
      assert.equal(after[0].id, before[0].id, 'the newest row is kept');
    }
    assert.equal(db.pruneNotifications(5000), 0, 'a second prune under the limit is a no-op');
  });
});

describe('read watermark cannot be poisoned', () => {
  test('an id beyond the newest notification is clamped', async () => {
    const { body } = await srv.api('POST', '/api/notifications/read', { upToId: 999999999 });
    const { body: list } = await srv.api('GET', '/api/notifications?limit=1');
    const newest = list.items[0]?.id || 0;
    assert.equal(body.lastReadId, newest,
      'parking the watermark in the future would suppress this account badge forever');
  });

  test('a future watermark does not hide genuinely new notifications', async () => {
    await srv.api('POST', '/api/notifications/read', { upToId: 999999999 });
    const order = await deliverOrderFor(nameA);
    const seen = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications');
      return body.unread > 0 ? body : null;
    }, { label: 'a new notification to count as unread' });
    assert.ok(seen.unread > 0, 'the badge still works after a hostile read call');
    assert.ok(seen.items.some((n) => n.orderId === order.id));
  });

  test('junk values are handled without breaking the account', async () => {
    for (const upToId of [-5, 'abc', null, {}, []]) {
      const { status, body } = await srv.api('POST', '/api/notifications/read', { upToId });
      assert.equal(status, 200, `upToId=${JSON.stringify(upToId)} must not error`);
      assert.ok(Number.isFinite(body.lastReadId) && body.lastReadId >= 0);
    }
  });
});

describe('the badge cannot drift from the server', () => {
  test('a new order is a stored notification, not a transient broadcast', async () => {
    const { body: before } = await srv.api('GET', '/api/notifications?limit=200');
    const { body: order } = await srv.api('POST', '/api/orders', {
      client: 'Badge Test', phone: '05' + Math.floor(10000000 + Math.random() * 89999999), price: 1000,
    });
    const after = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications?limit=200');
      return body.items.some((n) => n.orderId === order.id && n.type === 'new_order') ? body : null;
    }, { label: 'the new order to be stored' });
    assert.ok(after.items.length > before.items.length, 'it survives a refresh');
  });

  test('a suspicious call is stored, and only the manager sees it', async () => {
    const { body: order } = await srv.api('POST', '/api/orders', {
      client: 'Suspicious', phone: '05' + Math.floor(10000000 + Math.random() * 89999999), agent: nameA,
    });
    // No call-start, so the result is flagged.
    await agentA.api('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' });

    const mgr = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications?limit=200');
      return body.items.find((n) => n.type === 'suspicious_call' && n.orderId === order.id);
    }, { label: 'the suspicious-call alert' });
    assert.equal(mgr.target, 'manager');

    const { body: agentView } = await agentA.api('GET', '/api/notifications?limit=200');
    assert.ok(!agentView.items.some((n) => n.type === 'suspicious_call'),
      'the agent must not be told they were flagged');
  });

  test('the unread count equals exactly the stored notifications since the watermark', async () => {
    await srv.api('POST', '/api/notifications/read', {});
    const { body: cleared } = await srv.api('GET', '/api/notifications');
    assert.equal(cleared.unread, 0);
    const watermark = cleared.lastReadId;

    await srv.api('POST', '/api/orders', { client: 'C1', phone: '0555010101' });
    await srv.api('POST', '/api/orders', { client: 'C2', phone: '0555020202' });

    const after = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/notifications?limit=200');
      return body.unread >= 2 ? body : null;
    }, { label: 'two new stored notifications' });

    const newer = after.items.filter((n) => n.id > watermark).length;
    assert.equal(after.unread, newer,
      'the badge is exactly the count of visible stored notifications past the watermark');
  });
});
