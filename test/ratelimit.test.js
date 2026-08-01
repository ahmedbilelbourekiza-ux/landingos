/* =============================================================================
 * test/ratelimit.test.js — audit §10 (no brute-force protection) and BUG-03.
 *
 * Login was completely unthrottled, and every attempt costs a real scrypt
 * derivation — both a credential-stuffing surface and a cheap way to burn CPU.
 *
 * These servers set deliberately low limits; the shared harness raises them for
 * every other suite, which signs in far more often than a human would.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uid } = require('./helpers');

describe('login throttling', () => {
  let srv;
  before(async () => {
    srv = await startServer({ LOGIN_RATE_LIMIT: '5', LOGIN_ACCOUNT_RATE_LIMIT: '3' }, { autoLogin: false });
  });
  after(async () => { if (srv) await srv.stop(); });

  const tryLogin = (name, password) =>
    srv.api('POST', '/api/auth/login', { name, password }, { noCookies: true });

  test('repeated failures against ONE account are cut off', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await tryLogin('boss', 'wrong-' + i)).status);
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
    // The per-account limit (3) bites before the per-IP one (5).
    assert.equal(statuses.slice(0, 3).every((s) => s === 401), true, 'the first few are normal failures');
  });

  test('the 429 explains itself and says when to retry', async () => {
    const r = await tryLogin('boss', 'still-wrong');
    assert.equal(r.status, 429);
    assert.equal(r.body.code, 'RATE_LIMITED');
    assert.ok(r.body.retryAfterSeconds > 0);
    assert.ok(r.headers.get('retry-after'), 'a Retry-After header is set');
    assert.ok(r.headers.get('ratelimit-remaining') !== null);
  });

  test('a DIFFERENT account is still reachable — the per-IP limit is separate', async () => {
    // A per-account lockout must not become a denial of service for everyone
    // else behind the same address.
    const s = await startServer({ LOGIN_RATE_LIMIT: '50', LOGIN_ACCOUNT_RATE_LIMIT: '2' }, { autoLogin: false });
    try {
      await s.api('POST', '/api/auth/login', { name: 'victim', password: 'x' }, { noCookies: true });
      await s.api('POST', '/api/auth/login', { name: 'victim', password: 'x' }, { noCookies: true });
      const locked = await s.api('POST', '/api/auth/login', { name: 'victim', password: 'x' }, { noCookies: true });
      assert.equal(locked.status, 429, 'the targeted account is throttled');

      const other = await s.api('POST', '/api/auth/login',
        { name: s.admin.name, password: s.admin.password }, { noCookies: true });
      assert.equal(other.status, 200, 'a real user can still sign in');
    } finally {
      await s.stop();
    }
  });

  test('the account key is case-insensitive, so casing cannot reset the counter', async () => {
    const s = await startServer({ LOGIN_RATE_LIMIT: '50', LOGIN_ACCOUNT_RATE_LIMIT: '2' }, { autoLogin: false });
    try {
      await s.api('POST', '/api/auth/login', { name: 'Target', password: 'x' }, { noCookies: true });
      await s.api('POST', '/api/auth/login', { name: 'target', password: 'x' }, { noCookies: true });
      const third = await s.api('POST', '/api/auth/login', { name: 'TARGET', password: 'x' }, { noCookies: true });
      assert.equal(third.status, 429, 'changing case must not buy more attempts');
    } finally {
      await s.stop();
    }
  });

  test('throttling is logged so an attack is visible', async () => {
    assert.ok(srv.logs().includes('rate limit hit'), 'the operator can see it in the log');
  });
});

describe('the general API backstop', () => {
  test('a scripted scrape is cut off, and the limit is per account', async () => {
    const s = await startServer({ API_RATE_LIMIT: '20' });
    try {
      let limited = 0;
      for (let i = 0; i < 30; i++) {
        if ((await s.api('GET', '/api/orders')).status === 429) limited++;
      }
      assert.ok(limited > 0, 'the backstop engaged');
    } finally {
      await s.stop();
    }
  });

  test('the SSE stream is exempt — it is one connection, not a request rate', async () => {
    const s = await startServer({ API_RATE_LIMIT: '5' });
    try {
      for (let i = 0; i < 10; i++) await s.api('GET', '/api/orders');   // burn the budget
      const controller = new AbortController();
      const r = await fetch(s.base + '/api/notifications/subscribe', {
        headers: { Cookie: [...s.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
        signal: controller.signal,
      });
      controller.abort();
      assert.equal(r.status, 200, 'a throttled account can still receive live updates');
    } finally {
      await s.stop();
    }
  });

  test('webhooks are not throttled by the API backstop', async () => {
    // Carriers replay backlogs; /webhook is a separate mount from /api.
    const s = await startServer({ API_RATE_LIMIT: '2' });
    try {
      for (let i = 0; i < 6; i++) await s.api('GET', '/api/orders');
      const r = await fetch(s.base + '/webhook/delivery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: 'NOPE', status: 'Livré' }),
      });
      assert.notEqual(r.status, 429, 'a carrier must never be rate-limited off');
    } finally {
      await s.stop();
    }
  });
});

describe('security headers', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { if (srv) await srv.stop(); });

  test('the expected headers are present', async () => {
    const r = await fetch(srv.base + '/app');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(r.headers.get('referrer-policy') || '', /strict-origin/);
    assert.ok(r.headers.get('permissions-policy'));
  });

  test('the stack is not advertised', async () => {
    const r = await fetch(srv.base + '/');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('API responses are never cached', async () => {
    const { headers } = await srv.api('GET', '/api/orders');
    assert.match(headers.get('cache-control') || '', /no-store/,
      'per-session data must not sit in a shared cache');
  });

  test('SAMEORIGIN still permits the calculator iframe', async () => {
    // index.html embeds calculateur_profit_perte.html; DENY would break it.
    const r = await fetch(srv.base + '/calculateur_profit_perte.html');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  });
});

describe('BUG-03 — the followupAutoAssign setting actually works', () => {
  let srv;
  const fuAgent = 'Suivi ' + uid();

  before(async () => {
    srv = await startServer();
    await srv.api('POST', '/api/agents', { name: fuAgent, pass: 'suivipass1', role: 'followup' });
    // The bootstrapped manager is created with role 'both', so it is itself an
    // eligible follow-up agent and would compete for the assignment. Take it
    // out of that pool so the expected target is unambiguous.
    await srv.api('PUT', `/api/agents/${encodeURIComponent(srv.admin.name)}/role`, { role: 'confirmation' });
  });
  after(async () => { if (srv) await srv.stop(); });

  const confirmAnOrder = async () => {
    const { body: o } = await srv.api('POST', '/api/orders', {
      client: 'FU Test', phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
    });
    await srv.api('PUT', '/api/orders/' + o.id, { status: 'confirmed' });
    return (await srv.api('GET', '/api/orders')).body.find((x) => x.id === o.id);
  };

  test('with the setting OFF, confirming does not assign a follow-up agent', async () => {
    await srv.api('PUT', '/api/settings', { followupAutoAssign: false });
    const order = await confirmAnOrder();
    assert.equal(order.followupAgent, '',
      'the callers passed {auto:true} unconditionally, so this toggle did nothing');
  });

  test('with the setting ON, confirming assigns one', async () => {
    await srv.api('PUT', '/api/settings', { followupAutoAssign: true });
    const order = await confirmAnOrder();
    assert.equal(order.followupAgent, fuAgent, 'the eligible follow-up agent was assigned');
  });

  test('a manager can still assign manually regardless of the setting', async () => {
    await srv.api('PUT', '/api/settings', { followupAutoAssign: false });
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'Manual', phone: '0555626262' });
    const { status, body } = await srv.api('POST', '/api/followup/assign', { orderId: o.id, agent: fuAgent });
    assert.equal(status, 200);
    assert.equal(body.agent, fuAgent, 'an explicit assignment always wins');
  });
});
