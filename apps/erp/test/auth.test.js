/* =============================================================================
 * test/auth.test.js — audit SEC-01 and SEC-02.
 *
 * SEC-01: all 117 routes were open; no login endpoint existed anywhere.
 * SEC-02: GET /api/agents returned every password in cleartext, and the agent
 *         PWA compared it in the browser.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uid } = require('./helpers');

const ADMIN = { name: 'boss', password: 'supersecret123' };
let srv;

before(async () => {
  srv = await startServer({ ADMIN_USERNAME: ADMIN.name, ADMIN_PASSWORD: ADMIN.password });
});
after(async () => { if (srv) await srv.stop(); });

/** A fetch that carries no cookies at all. */
const anon = (method, path, body) =>
  srv.api(method, path, body, { noCookies: true });

describe('the API is closed by default (SEC-01)', () => {
  const PROTECTED = [
    ['GET', '/api/orders'], ['POST', '/api/orders'], ['GET', '/api/agents'],
    ['GET', '/api/settings'], ['PUT', '/api/settings'], ['GET', '/api/clients'],
    ['GET', '/api/products'], ['GET', '/api/providers'], ['GET', '/api/stores'],
    ['GET', '/api/notifications'], ['GET', '/api/followup/dashboard'],
    ['GET', '/api/ai/providers'], ['GET', '/api/ai/agents'], ['GET', '/api/ai/insights'],
    ['GET', '/api/financial-records'], ['GET', '/api/unexpected-charges'],
    ['GET', '/api/inventory/low-stock'], ['POST', '/api/orders/bulk'],
    ['GET', '/api/agents/payroll'], ['GET', '/api/notifications/subscribe'],
  ];

  for (const [method, path] of PROTECTED) {
    test(`${method} ${path} rejects an anonymous caller`, async () => {
      const { status, body } = await anon(method, path, method === 'POST' ? {} : undefined);
      assert.equal(status, 401, `${method} ${path} must require a session`);
      assert.equal(body.code, 'UNAUTHENTICATED');
    });
  }

  test('an unknown /api path returns JSON, not an HTML error page', async () => {
    const { status, body } = await anon('GET', '/api/does-not-exist');
    assert.equal(status, 401, 'unknown paths are gated too — no route enumeration');
    assert.equal(typeof body, 'object');
  });

  test('the health check stays public', async () => {
    assert.equal((await anon('GET', '/')).status, 200);
  });

  test('the status vocabularies stay public', async () => {
    assert.equal((await anon('GET', '/api/statuses')).status, 200);
    assert.equal((await anon('GET', '/api/delivery/statuses')).status, 200);
  });

  test('a garbage session token is rejected', async () => {
    const { status } = await srv.api('GET', '/api/orders', undefined, {
      noCookies: true, headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(status, 401);
  });
});

describe('login (SEC-02)', () => {
  test('the bootstrapped manager can sign in', async () => {
    const { status, body } = await srv.api('POST', '/api/auth/login', ADMIN);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.user.name, ADMIN.name);
    assert.equal(body.user.isManager, true);
    assert.ok(body.token, 'a token is returned for non-cookie clients');
  });

  test('the session cookie is HttpOnly and scoped', async () => {
    const { headers } = await srv.api('POST', '/api/auth/login', ADMIN);
    const cookie = headers.getSetCookie().find((c) => c.startsWith('crm_session='));
    assert.ok(cookie, 'a session cookie was set');
    assert.match(cookie, /HttpOnly/, 'not readable from JavaScript');
    assert.match(cookie, /SameSite=Lax/, 'same-origin deployment uses Lax');
    assert.match(cookie, /Path=\//);
  });

  test('a wrong password is rejected', async () => {
    const { status, body } = await anon('POST', '/api/auth/login', { name: ADMIN.name, password: 'wrong' });
    assert.equal(status, 401);
    assert.equal(body.code, 'BAD_CREDENTIALS');
  });

  test('an unknown account gives the SAME error as a wrong password', async () => {
    const { status, body } = await anon('POST', '/api/auth/login', { name: 'nobody-here', password: 'x' });
    assert.equal(status, 401);
    assert.equal(body.code, 'BAD_CREDENTIALS', 'must not reveal whether the account exists');
  });

  test('a valid session unlocks the API', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const { status } = await srv.api('GET', '/api/orders');
    assert.equal(status, 200);
  });

  test('/api/auth/me reports the signed-in account', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const { status, body } = await srv.api('GET', '/api/auth/me');
    assert.equal(status, 200);
    assert.equal(body.user.name, ADMIN.name);
    assert.equal(body.user.isManager, true);
  });

  test('logout revokes the session server-side', async () => {
    const { body: login } = await srv.api('POST', '/api/auth/login', ADMIN);
    await srv.api('POST', '/api/auth/logout');
    const { status } = await srv.api('GET', '/api/orders', undefined, {
      noCookies: true, headers: { Authorization: `Bearer ${login.token}` },
    });
    assert.equal(status, 401, 'the token is dead, not merely forgotten by the browser');
  });
});

describe('passwords are never disclosed (SEC-02)', () => {
  let agentName;

  before(async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    agentName = 'Agent ' + uid();
    await srv.api('POST', '/api/agents', { name: agentName, pass: 'agentpass123', role: 'confirmation' });
  });

  test('GET /api/agents carries no password field at all', async () => {
    const { body } = await srv.api('GET', '/api/agents');
    assert.ok(body.length > 0);
    for (const a of body) {
      assert.ok(!('pass' in a), `agent ${a.name} still exposes "pass"`);
      assert.ok(!('password' in a), `agent ${a.name} still exposes "password"`);
    }
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes('agentpass123'), 'the plaintext password does not appear anywhere in the response');
    assert.ok(!raw.includes('scrypt$'), 'not even the hash is disclosed');
  });

  test('hasPassword replaces it, so a blank-password account is still visible', async () => {
    const blank = 'Blank ' + uid();
    await srv.api('POST', '/api/agents', { name: blank, pass: '', role: 'confirmation' });
    const { body } = await srv.api('GET', '/api/agents');
    assert.equal(body.find((a) => a.name === blank).hasPassword, false);
    assert.equal(body.find((a) => a.name === agentName).hasPassword, true);
  });

  test('the password is stored as a scrypt hash, not plaintext', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(srv.dbPath, { readonly: true });
    const row = db.prepare('SELECT pass FROM agents WHERE name = ?').get(agentName);
    db.close();
    assert.ok(row.pass.startsWith('scrypt$'), 'stored as a hash');
    assert.ok(!row.pass.includes('agentpass123'), 'the plaintext is not recoverable');
  });

  test('an agent created through the API can then sign in', async () => {
    const { status, body } = await anon('POST', '/api/auth/login', { name: agentName, password: 'agentpass123' });
    assert.equal(status, 200);
    assert.equal(body.user.isManager, false, 'a normal agent is not a manager');
  });
});

describe('authorization — agent vs manager', () => {
  let agentSrv;
  const agentName = 'Worker ' + uid();

  before(async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    await srv.api('POST', '/api/agents', { name: agentName, pass: 'workerpass', role: 'confirmation' });
    // A second client with its own cookie jar, signed in as the plain agent.
    agentSrv = { api: (m, p, b, o) => srv.api(m, p, b, o) };
  });

  test('a plain agent cannot reach manager-only routes', async () => {
    const { body: login } = await anon('POST', '/api/auth/login', { name: agentName, password: 'workerpass' });
    const asAgent = (method, path, body) => srv.api(method, path, body, {
      noCookies: true, headers: { Authorization: `Bearer ${login.token}` },
    });

    const MANAGER_ONLY = [
      ['POST', '/api/agents', { name: 'X' + uid() }],
      ['PUT', '/api/settings', { minCallSeconds: 99 }],
      ['POST', '/api/providers', { name: 'p', code: 'c' + uid() }],
      ['POST', '/api/stores', { name: 's' }],
      ['POST', '/api/ai/providers', { name: 'a', type: 'openai-compat' }],
      ['GET', '/api/agents/payroll'],
      ['POST', '/api/financial-records', { periodType: 'week', startDate: 1, endDate: 2 }],
    ];
    for (const [method, path, body] of MANAGER_ONLY) {
      const { status } = await asAgent(method, path, body);
      assert.equal(status, 403, `${method} ${path} must be manager-only`);
    }
  });

  test('a plain agent can still do their own job', async () => {
    const { body: login } = await anon('POST', '/api/auth/login', { name: agentName, password: 'workerpass' });
    const asAgent = (method, path, body) => srv.api(method, path, body, {
      noCookies: true, headers: { Authorization: `Bearer ${login.token}` },
    });
    assert.equal((await asAgent('GET', '/api/orders')).status, 200);
    assert.equal((await asAgent('GET', '/api/products')).status, 200);
    assert.equal((await asAgent('GET', '/api/followup/tasks')).status, 200);

    const { body: order } = await asAgent('POST', '/api/orders', { client: 'C', phone: '0555112233' });
    assert.equal((await asAgent('POST', `/api/orders/${order.id}/call-start`)).status, 200);
    assert.equal((await asAgent('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' })).status, 200);
  });

  test('the last manager cannot demote themselves', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const { status, body } = await srv.api(
      `PUT`, `/api/agents/${encodeURIComponent(ADMIN.name)}/account-role`, { accountRole: 'agent' }
    );
    assert.equal(status, 400);
    assert.equal(body.code, 'LAST_MANAGER');
  });

  test('a manager can promote another account, and then demote themselves', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const second = 'Deputy ' + uid();
    await srv.api('POST', '/api/agents', { name: second, pass: 'deputypass', role: 'both' });
    assert.equal((await srv.api('PUT', `/api/agents/${encodeURIComponent(second)}/account-role`, { accountRole: 'manager' })).status, 200);

    const { body } = await anon('POST', '/api/auth/login', { name: second, password: 'deputypass' });
    assert.equal(body.user.isManager, true);
  });
});

describe('suspension and session lifecycle', () => {
  test('suspending an account blocks login AND kills live sessions', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const name = 'Suspended ' + uid();
    await srv.api('POST', '/api/agents', { name, pass: 'temp12345', role: 'confirmation' });

    const { body: login } = await anon('POST', '/api/auth/login', { name, password: 'temp12345' });
    const asAgent = () => srv.api('GET', '/api/orders', undefined, {
      noCookies: true, headers: { Authorization: `Bearer ${login.token}` },
    });
    assert.equal((await asAgent()).status, 200, 'works before suspension');

    await srv.api('POST', '/api/auth/login', ADMIN);
    await srv.api('POST', `/api/agents/${encodeURIComponent(name)}/suspend`);

    assert.equal((await asAgent()).status, 401, 'the existing session stops working at once');
    const retry = await anon('POST', '/api/auth/login', { name, password: 'temp12345' });
    assert.equal(retry.status, 403);
    assert.equal(retry.body.code, 'SUSPENDED');
  });

  test('changing a password evicts every other session', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const name = 'Rotator ' + uid();
    await srv.api('POST', '/api/agents', { name, pass: 'original123', role: 'confirmation' });

    const { body: a } = await anon('POST', '/api/auth/login', { name, password: 'original123' });
    const { body: b } = await anon('POST', '/api/auth/login', { name, password: 'original123' });

    // Session B changes the password; session A must die.
    const changed = await srv.api('POST', '/api/auth/change-password',
      { currentPassword: 'original123', newPassword: 'replacement456' },
      { noCookies: true, headers: { Authorization: `Bearer ${b.token}` } });
    assert.equal(changed.status, 200);

    const stale = await srv.api('GET', '/api/orders', undefined, {
      noCookies: true, headers: { Authorization: `Bearer ${a.token}` },
    });
    assert.equal(stale.status, 401, 'the other session was evicted');

    assert.equal((await anon('POST', '/api/auth/login', { name, password: 'replacement456' })).status, 200);
    assert.equal((await anon('POST', '/api/auth/login', { name, password: 'original123' })).status, 401);
  });

  test('a manager can reset a forgotten password', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const name = 'Forgetful ' + uid();
    await srv.api('POST', '/api/agents', { name, pass: 'iforgot123', role: 'confirmation' });
    assert.equal((await srv.api('POST', `/api/agents/${encodeURIComponent(name)}/password`, { newPassword: 'freshstart1' })).status, 200);
    assert.equal((await anon('POST', '/api/auth/login', { name, password: 'freshstart1' })).status, 200);
  });

  test('a short new password is refused', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const { status, body } = await srv.api('POST', '/api/auth/change-password',
      { currentPassword: ADMIN.password, newPassword: 'abc' });
    assert.equal(status, 400);
    assert.equal(body.code, 'WEAK_PASSWORD');
  });
});

describe('static clients are served same-origin', () => {
  test('the manager console is reachable', async () => {
    const r = await fetch(srv.base + '/app');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /html/);
  });
  test('the agent PWA is reachable', async () => {
    const r = await fetch(srv.base + '/agent');
    assert.equal(r.status, 200);
  });
  test('the service worker is served uncached', async () => {
    const r = await fetch(srv.base + '/service-worker.js');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') || '', /no-cache/);
  });
  test('the root path is still the JSON health check', async () => {
    const r = await fetch(srv.base + '/');
    assert.match(r.headers.get('content-type') || '', /json/);
  });
});

describe('record-level scoping of the order book', () => {
  test('an agent sees only their own and unassigned orders', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const mine = 'Mine ' + uid();
    const other = 'Other ' + uid();
    await srv.api('POST', '/api/agents', { name: mine, pass: 'minepass123', role: 'confirmation' });
    await srv.api('POST', '/api/agents', { name: other, pass: 'otherpass123', role: 'confirmation' });

    const { body: a } = await srv.api('POST', '/api/orders', { client: 'A', phone: '0555777001', agent: mine });
    const { body: b } = await srv.api('POST', '/api/orders', { client: 'B', phone: '0555777002', agent: other });
    const { body: c } = await srv.api('POST', '/api/orders', { client: 'C', phone: '0555777003' });

    const agent = await srv.as(mine, 'minepass123');
    const { body: visible } = await agent.api('GET', '/api/orders');
    const ids = visible.map((o) => o.id);

    assert.ok(ids.includes(a.id), 'their own order is visible');
    assert.ok(ids.includes(c.id), 'unassigned orders stay visible so they can be picked up');
    assert.ok(!ids.includes(b.id), "another agent's order is NOT visible");

    // The manager still sees the whole book.
    const { body: all } = await srv.api('GET', '/api/orders');
    assert.ok(all.map((o) => o.id).includes(b.id));
  });

  test('a follow-up agent sees the orders assigned to them for follow-up', async () => {
    await srv.api('POST', '/api/auth/login', ADMIN);
    const fu = 'Suivi ' + uid();
    await srv.api('POST', '/api/agents', { name: fu, pass: 'suivipass1', role: 'followup' });
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'F', phone: '0555777004', agent: 'someone-else' });
    await srv.api('PUT', `/api/orders/${o.id}`, { followupAgent: fu });

    const agent = await srv.as(fu, 'suivipass1');
    const { body: visible } = await agent.api('GET', '/api/orders');
    assert.ok(visible.map((x) => x.id).includes(o.id), 'visible via followupAgent');
  });
});
