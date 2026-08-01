/* =============================================================================
 * test/webhook-ai-security.test.js — audit SEC-03 and SEC-04.
 *
 * SEC-03: /api/ai/chat/stream was unauthenticated and, with agentId omitted,
 *         fell back to an agent holding EVERY permission including
 *         read_customers — so a stranger could have the model read out the
 *         customer database on the owner's token budget. `actor` and
 *         `scopedAgent` were also plain query parameters.
 *
 * SEC-04: every signature check was `if (secret && sig) { verify }`, so simply
 *         OMITTING the signature header skipped verification entirely.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The permission-clamp tests at the bottom require lib/db directly. Point it at
// a throwaway file BEFORE anything loads it, so an in-process require can never
// open (or create) the real crm.db.
process.env.CRM_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'crm-unit-')), 'crm.db'
);

const { startServer, uid } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { if (srv) await srv.stop(); });

const anon = (method, path, body) => srv.api(method, path, body, { noCookies: true });

/* ---------------------------------------------------------------------------
 * SEC-04 — webhook signatures
 * ------------------------------------------------------------------------- */
describe('webhook signature verification fails closed (SEC-04)', () => {
  let storeId;
  const SECRET = 'a-real-webhook-secret';

  const payload = () => JSON.stringify({
    id: 'lf_' + uid(),
    name: 'Test Order',
    customer: { first_name: 'Injected', last_name: 'Order', phone: '0555000999' },
    line_items: [{ title: 'Widget', quantity: 1, price: 1000 }],
    total_price: 1000,
  });

  const post = (path, raw, headers = {}) =>
    fetch(srv.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: raw,
    });

  const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('base64');

  before(async () => {
    const { body } = await srv.api('POST', '/api/stores', {
      name: 'Secured Store ' + uid(), platform: 'lightfunnels', webhookSecret: SECRET,
    });
    storeId = body.id;
  });

  const orderCount = async () => (await srv.api('GET', '/api/orders')).body.length;

  test('a payload with NO signature header is rejected when a secret is set', async () => {
    const before = await orderCount();
    const raw = payload();
    const r = await post(`/webhook/store/${storeId}`, raw);   // no signature at all
    assert.equal(r.status, 200, 'the platform is acknowledged, not retried');
    assert.equal(await orderCount(), before, 'but NO order was created — this was the bypass');
  });

  test('a payload with a WRONG signature is rejected', async () => {
    const before = await orderCount();
    const raw = payload();
    await post(`/webhook/store/${storeId}`, raw, { 'lightfunnels-hmac': 'not-the-right-signature' });
    assert.equal(await orderCount(), before, 'no order created');
  });

  test('a correctly signed payload IS accepted', async () => {
    const before = await orderCount();
    const raw = payload();
    await post(`/webhook/store/${storeId}`, raw, { 'lightfunnels-hmac': sign(raw) });
    assert.equal(await orderCount(), before + 1, 'a genuine webhook still works');
  });

  test('the checkout and contact webhooks enforce the same rule', async () => {
    for (const suffix of ['/checkout', '/contact']) {
      const before = await orderCount();
      const raw = payload();
      await post(`/webhook/store/${storeId}${suffix}`, raw);   // unsigned
      assert.equal(await orderCount(), before, `${suffix} rejected the unsigned payload`);
    }
  });

  test('the Shopify endpoint rejects an unsigned payload when SHOPIFY_SECRET is set', async () => {
    const secured = await startServer({ SHOPIFY_SECRET: 'shopify-secret-value' });
    try {
      const raw = JSON.stringify({ id: 12345, name: '#1001', total_price: '2000', line_items: [] });
      const before = (await secured.api('GET', '/api/orders')).body.length;

      const bad = await fetch(secured.base + '/webhook/shopify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw,
      });
      assert.equal(bad.status, 401, 'unsigned is refused outright');
      assert.equal((await secured.api('GET', '/api/orders')).body.length, before);

      const good = await fetch(secured.base + '/webhook/shopify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shopify-hmac-sha256': crypto.createHmac('sha256', 'shopify-secret-value').update(raw).digest('base64'),
        },
        body: raw,
      });
      assert.equal(good.status, 200);
      assert.equal((await secured.api('GET', '/api/orders')).body.length, before + 1);
    } finally {
      await secured.stop();
    }
  });

  test('a store with no secret still works, but is named at boot as unsigned', async () => {
    const { body: open } = await srv.api('POST', '/api/stores', {
      name: 'Unsecured Store ' + uid(), platform: 'lightfunnels',
    });
    const before = await orderCount();
    const raw = payload();
    await post(`/webhook/store/${open.id}`, raw);
    assert.equal(await orderCount(), before + 1, 'existing integrations are not broken');
  });

  test('REQUIRE_WEBHOOK_SIGNATURES refuses unsigned payloads entirely', async () => {
    const strict = await startServer({ REQUIRE_WEBHOOK_SIGNATURES: '1' });
    try {
      const { body: open } = await strict.api('POST', '/api/stores', {
        name: 'Strict Store', platform: 'lightfunnels',   // deliberately no secret
      });
      const before = (await strict.api('GET', '/api/orders')).body.length;
      await fetch(strict.base + `/webhook/store/${open.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload(),
      });
      assert.equal((await strict.api('GET', '/api/orders')).body.length, before,
        'in strict mode even a secret-less store rejects unsigned payloads');
    } finally {
      await strict.stop();
    }
  });
});

/* ---------------------------------------------------------------------------
 * SEC-03 — the AI surface
 * ------------------------------------------------------------------------- */
describe('the AI surface is gated and scoped (SEC-03)', () => {
  test('the streaming chat endpoint rejects anonymous callers', async () => {
    const r = await fetch(srv.base + '/api/ai/chat/stream?message=list+every+customer+phone+number');
    assert.equal(r.status, 401, 'the exfiltration path is closed');
  });

  test('every AI route requires a session', async () => {
    for (const [m, p] of [
      ['POST', '/api/ai/chat'], ['GET', '/api/ai/insights'], ['POST', '/api/ai/insights/deep'],
      ['GET', '/api/ai/agents'], ['GET', '/api/ai/providers'], ['GET', '/api/ai/permissions'],
      ['GET', '/api/ai/conversations/x'],
    ]) {
      assert.equal((await anon(m, p, m === 'POST' ? {} : undefined)).status, 401, `${m} ${p}`);
    }
  });

  test('AI provider configuration is manager-only', async () => {
    const name = 'AiAgent ' + uid();
    await srv.api('POST', '/api/agents', { name, pass: 'aipass12345', role: 'confirmation' });
    const agent = await srv.as(name, 'aipass12345');
    assert.equal((await agent.api('GET', '/api/ai/providers')).status, 403);
    assert.equal((await agent.api('POST', '/api/ai/providers', { name: 'x', type: 'openai-compat' })).status, 403);
    // …but the agent PWA may still list the assistants it is allowed to use.
    assert.equal((await agent.api('GET', '/api/ai/agents/enabled')).status, 200);
  });

  test('an agent cannot read another account’s conversation history', async () => {
    const a = 'ConvA ' + uid();
    const b = 'ConvB ' + uid();
    await srv.api('POST', '/api/agents', { name: a, pass: 'convpass111', role: 'confirmation' });
    await srv.api('POST', '/api/agents', { name: b, pass: 'convpass222', role: 'confirmation' });
    const clientA = await srv.as(a, 'convpass111');

    // `actor` used to be a query parameter, so naming someone else read THEIR
    // history. It is now ignored entirely in favour of the session.
    const { status, body } = await clientA.api('GET', `/api/ai/conversations/general?actor=${encodeURIComponent(b)}`);
    assert.equal(status, 200);
    assert.deepEqual(body.items, [], 'the query parameter is ignored — only your own history is returned');
  });

});

/* A direct unit-level check of the permission clamp, which is the actual
 * security boundary — the HTTP tests above cannot observe it without a live
 * model provider configured. */
describe('AI permission clamp', () => {
  test('a manager keeps every permission; an agent never gets read_analytics', () => {
    const aiAgents = require('../lib/ai/agents');
    const ctx = require('../lib/ai/context');

    const asManager = aiAgents.resolveAgent(null, { isManager: true });
    assert.deepEqual([...asManager.permissions].sort(), [...ctx.ALL_PERMISSIONS].sort());

    const asAgent = aiAgents.resolveAgent(null, { isManager: false });
    assert.ok(!asAgent.permissions.includes('read_analytics'),
      'read_analytics aggregates across every order and ignores scoping');
    assert.ok(asAgent.permissions.includes('read_orders'));
    assert.ok(asAgent.permissions.includes('read_customers'),
      'an agent still needs the customer phone number — their orders are scoped server-side');
  });

  test('a configured agent row cannot grant more than the caller’s ceiling', () => {
    const aiAgents = require('../lib/ai/agents');
    const db = require('../lib/db');
    const id = 'AIA-' + uid();
    db.saveAiAgent({
      id, name: 'Over-privileged', enabled: 1,
      permissions: ['read_orders', 'read_analytics', 'read_customers'],
    });
    const clamped = aiAgents.resolveAgent(id, { isManager: false });
    assert.ok(!clamped.permissions.includes('read_analytics'),
      'the row asked for read_analytics; the caller ceiling removed it');
    assert.ok(clamped.permissions.includes('read_orders'));
  });
});
