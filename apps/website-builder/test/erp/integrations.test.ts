import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  skip, uid, BASE, makeErpTenant, cleanup, slugOf,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/integrations.test.ts
 *
 * Ported from apps/erp/test/webhook-ai-security.test.js (audit SEC-03, SEC-04).
 *
 * SEC-04 was one line, repeated at every signature check:
 *
 *     if (secret && sig) { verify }
 *
 * Omitting the header skipped verification entirely. The check was there, it
 * read as careful, and it was worth nothing — anyone who knew a store id could
 * inject orders. Every assertion below is that verification FAILS CLOSED, which
 * is the only property that distinguishes a real check from that one.
 *
 * SEC-03 was that /api/ai/chat/stream was unauthenticated and, with agentId
 * omitted, fell back to an assistant holding EVERY permission including
 * read_customers — so a stranger could have the model read out the customer
 * database on the owner's token budget. `actor` and `scopedAgent` were plain
 * query parameters.
 *
 * MULTI-TENANCY MAKES BOTH WORSE. An inbound webhook arrives with no session,
 * so the tenant can only come from the URL or the payload — which means the
 * route has to resolve a tenant from an untrusted request and then bind to it.
 * That is the one place on the platform where a tenant id is derived from
 * something a stranger sent, so it gets the most attention here.
 *
 * D-05.5 — THE URL GAINED A TENANT SEGMENT SINCE THIS FILE WAS WRITTEN.
 *
 * Phase 5.1 wrote these paths WITHOUT a tenant segment, copying the ERP's
 * single-tenant shape. That cannot work: `SalesChannel` is tenant-scoped
 * and carries RLS, so an unbound client reads NOTHING from it and a channel id
 * alone cannot be resolved before a tenant is bound — the lookup and the
 * binding are circular. The path now carries the tenant, exactly like
 * `/api/storefront/[tenant]/...`, which is what this platform already does for
 * every anonymous tenant-scoped endpoint.
 *
 * The slug identifies; it does not authorise. Every assertion below still
 * holds, and the ones that matter most — fail closed, the RIGHT tenant's
 * secret, and a body that cannot name its own tenant — matter MORE now that
 * the URL names a company. See lib/erp/webhooks.ts for the alternatives that
 * were rejected.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let beta: Awaited<ReturnType<typeof makeErpTenant>>;

/** Tenant slugs, which the webhook paths carry (D-05.5). */
let acmeSlug = '';
let betaSlug = '';

/** A sales channel with a shared secret, in `acme`. */
let securedChannel = '';
/** A sales channel with no secret at all, in `acme`. */
let openChannel = '';
/** A sales channel belonging to `beta`. */
let betaChannel = '';

const SECRET = 'a-real-webhook-secret';

const payload = () => JSON.stringify({
  id: `lf_${uid()}`,
  name: 'Test Order',
  customer: { first_name: 'Injected', last_name: 'Order', phone: '0555000999' },
  line_items: [{ title: 'Widget', quantity: 1, price: 1000 }],
  total_price: 1000,
});

const sign = (raw: string, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(raw).digest('base64');

/** Webhooks carry no session, so they are posted raw rather than through api(). */
const post = (path: string, raw: string, headers: Record<string, string> = {}) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw,
  });

const orderCount = async (tenant: typeof acme) =>
  (await tenant.manager.api('GET', '/api/erp/orders?pageSize=1')).body.data.total as number;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('integrations');
  beta = await makeErpTenant('integrations-beta');
  acmeSlug = await slugOf(acme.tenantId);
  betaSlug = await slugOf(beta.tenantId);

  securedChannel = (await acme.manager.api('POST', '/api/erp/sales-channels', {
    name: `Secured Store ${uid()}`, platform: 'lightfunnels', webhookSecret: SECRET,
  })).body.data.id;

  openChannel = (await acme.manager.api('POST', '/api/erp/sales-channels', {
    name: `Unsecured Store ${uid()}`, platform: 'lightfunnels',
  })).body.data.id;

  betaChannel = (await beta.manager.api('POST', '/api/erp/sales-channels', {
    name: `Beta Store ${uid()}`, platform: 'lightfunnels', webhookSecret: SECRET,
  })).body.data.id;
});

after(async () => {
  if (skip) return;
  await cleanup();
});

/* -----------------------------------------------------------------------------
 * SEC-04 — signature verification fails closed
 * -------------------------------------------------------------------------- */

describe('webhook signature verification fails closed (SEC-04)', () => {
  test('a payload with NO signature header creates nothing', async () => {
    // THE bug. Not a wrong signature — a missing one.
    const before = await orderCount(acme);
    const r = await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, payload());
    assert.equal(r.status, 200, 'the platform is acknowledged, not made to retry forever');
    assert.equal(await orderCount(acme), before, 'but NO order was created');
  });

  test('a payload with a WRONG signature creates nothing', async () => {
    const before = await orderCount(acme);
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, payload(), {
      'lightfunnels-hmac': 'not-the-right-signature',
    });
    assert.equal(await orderCount(acme), before);
  });

  test('an EMPTY signature header creates nothing', async () => {
    // `if (secret && sig)` is also false for the empty string, so this is the
    // same bypass wearing a different hat.
    const before = await orderCount(acme);
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, payload(), { 'lightfunnels-hmac': '' });
    assert.equal(await orderCount(acme), before);
  });

  test('a signature computed with ANOTHER tenant’s secret creates nothing', async () => {
    const before = await orderCount(acme);
    const raw = payload();
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, raw, {
      'lightfunnels-hmac': sign(raw, 'some-other-tenants-secret'),
    });
    assert.equal(await orderCount(acme), before);
  });

  test('a correctly signed payload IS accepted', async () => {
    // Half a fail-closed test is a route that refuses everything.
    const before = await orderCount(acme);
    const raw = payload();
    const r = await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, raw, {
      'lightfunnels-hmac': sign(raw),
    });
    assert.equal(r.status, 200);
    assert.equal(await orderCount(acme), before + 1, 'a genuine webhook still works');
  });

  test('the checkout and contact webhooks enforce the same rule', async () => {
    for (const suffix of ['/checkout', '/contact']) {
      const before = await orderCount(acme);
      await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}${suffix}`, payload());
      assert.equal(await orderCount(acme), before, `${suffix} accepted an unsigned payload`);
    }
  });

  test('a channel with no secret still works, because existing integrations exist', async () => {
    const before = await orderCount(acme);
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${openChannel}`, payload());
    assert.equal(await orderCount(acme), before + 1);
  });

  test('a signature is verified against the right tenant’s secret', async () => {
    // The multi-tenant version of the bug. Both channels use the same secret
    // string here, so a route that looked up "a secret" rather than "this
    // channel's secret" would accept the payload and file the order under the
    // wrong company.
    const before = await orderCount(acme);
    const raw = payload();
    await post(`/api/erp/webhooks/${betaSlug}/channel/${betaChannel}`, raw, { 'lightfunnels-hmac': sign(raw) });
    assert.equal(await orderCount(acme), before, 'the order did not land in the wrong tenant');
    assert.ok(await orderCount(beta) > 0, 'it landed in the right one');
  });

  test('an unknown channel id is refused without saying whether it exists', async () => {
    const raw = payload();
    const r = await post(`/api/erp/webhooks/${acmeSlug}/channel/STR-does-not-exist`, raw, {
      'lightfunnels-hmac': sign(raw),
    });
    assert.ok(r.status === 200 || r.status === 404, `got ${r.status}`);
    const body = await r.text();
    assert.ok(!/tenant|company|belongs/i.test(body), 'and says nothing about ownership');
  });

  test('a webhook cannot name its own tenant', async () => {
    // The tenant comes from the channel, which came from the URL, which was
    // matched against a secret. A tenantId in the body is a stranger asking to
    // choose which company their order lands in.
    const before = await orderCount(beta);
    const raw = JSON.stringify({ ...JSON.parse(payload()), tenantId: beta.tenantId });
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, raw, {
      'lightfunnels-hmac': sign(raw),
    });
    assert.equal(await orderCount(beta), before, 'the body did not redirect the order');
  });

  test('the same webhook delivered twice creates one order', async () => {
    // Platforms retry. externalId is the dedup key and it is indexed per
    // tenant; without the check a retried backlog doubles a day of orders.
    const raw = payload();
    const before = await orderCount(acme);
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, raw, { 'lightfunnels-hmac': sign(raw) });
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${securedChannel}`, raw, { 'lightfunnels-hmac': sign(raw) });
    assert.equal(await orderCount(acme), before + 1, 'a replayed delivery is idempotent');
  });

  test('two tenants may receive the same external order id', async () => {
    // The dedup key is per tenant. A global unique would mean the second
    // company to receive Shopify order #1001 silently loses it.
    const raw = payload();
    await post(`/api/erp/webhooks/${acmeSlug}/channel/${openChannel}`, raw);
    const before = await orderCount(beta);
    await post(`/api/erp/webhooks/${betaSlug}/channel/${betaChannel}`, raw, { 'lightfunnels-hmac': sign(raw) });
    assert.equal(await orderCount(beta), before + 1, 'the other tenant still received it');
  });
});

describe('inbound carrier webhooks', () => {
  test('an unsigned delivery update does not move a parcel', async () => {
    const r = await post(`/api/erp/webhooks/${acmeSlug}/delivery`, JSON.stringify({
      trackingNumber: 'NOPE', status: 'Livré',
    }));
    assert.ok(r.status < 500, 'a carrier is never given a 500 to retry against');
  });

  test('a delivery webhook cannot settle an order in another tenant', async () => {
    // deliveryOutcome is the single most valuable field to be able to write
    // from outside — it is what client lifetime spend, product revenue and
    // delivered pay are all computed from.
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Target', phone: '0555' + Math.floor(100000 + Math.random() * 899999),
      price: 5000,
    });
    const id = created.body.data.id;

    await post(`/api/erp/webhooks/${acmeSlug}/delivery`, JSON.stringify({
      orderId: id, tenantId: beta.tenantId, status: 'Livré', crmStatus: 'delivered',
    }));

    const after = (await acme.manager.api('GET', `/api/erp/orders/${id}`)).body.data;
    assert.ok(!after.deliveryOutcome, 'an unsigned webhook must not settle a delivery');
  });
});

/* -----------------------------------------------------------------------------
 * SEC-03 — the AI surface
 * -------------------------------------------------------------------------- */

describe('the AI surface is gated and scoped (SEC-03)', () => {
  test('the streaming chat endpoint rejects anonymous callers', async () => {
    const r = await fetch(
      BASE + '/api/erp/ai/chat/stream?message=list+every+customer+phone+number',
      { redirect: 'manual' },
    );
    assert.equal(r.status, 401, 'the exfiltration path is closed');
  });

  test('every AI route requires a session', async () => {
    const ROUTES: ReadonlyArray<readonly [string, string]> = [
      ['POST', '/api/erp/ai/chat'],
      ['GET', '/api/erp/ai/insights'],
      ['POST', '/api/erp/ai/insights/deep'],
      ['GET', '/api/erp/ai/agents'],
      ['GET', '/api/erp/ai/providers'],
      ['GET', '/api/erp/ai/permissions'],
      ['GET', '/api/erp/ai/conversations/general'],
    ];
    for (const [method, path] of ROUTES) {
      const r = await fetch(BASE + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      assert.equal(r.status, 401, `${method} ${path}`);
    }
  });

  test('provider configuration is manager-only', async () => {
    assert.equal((await acme.agent.api('GET', '/api/erp/ai/providers')).status, 403);
    assert.equal(
      (await acme.agent.api('POST', '/api/erp/ai/providers', { name: 'x', type: 'openai-compat' })).status,
      403,
    );
    // …but an agent may still list the assistants they are allowed to use.
    assert.equal((await acme.agent.api('GET', '/api/erp/ai/agents/enabled')).status, 200);
  });

  test('an API key is never returned, even to a manager', async () => {
    await acme.manager.api('POST', '/api/erp/ai/providers', {
      name: 'Configured', type: 'openai-compat',
      baseUrl: 'https://example.invalid', apiKey: 'sk-super-secret-model-key',
    });
    const raw = JSON.stringify((await acme.manager.api('GET', '/api/erp/ai/providers')).body);
    assert.ok(!raw.includes('sk-super-secret-model-key'), 'the model key must be masked on read');
  });

  test('an agent cannot read another account’s conversation history', async () => {
    // `actor` used to be a query parameter, so naming someone else read THEIR
    // history. It is ignored entirely now in favour of the session.
    const r = await acme.agent.api(
      'GET', `/api/erp/ai/conversations/general?userId=${acme.other.userId}`,
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.items, [],
      'the query parameter is ignored — only your own history is returned');
  });

  test('conversation history does not cross the tenant boundary', async () => {
    const r = await beta.manager.api(
      'GET', `/api/erp/ai/conversations/general?userId=${acme.manager.userId}`,
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.items, []);
  });

  test('the permission ceiling clamps a configured assistant', async () => {
    // The actual security boundary. A row can ask for read_analytics; the
    // CALLER's ceiling removes it, because read_analytics aggregates across
    // every order and ignores record-level scoping — so granting it to an
    // agent hands them the whole order book through the model instead of
    // through the API.
    const created = await acme.manager.api('POST', '/api/erp/ai/agents', {
      name: 'Over-privileged', enabled: true,
      permissions: ['read_orders', 'read_analytics', 'read_customers'],
    });
    assert.equal(created.status, 201);

    const asAgent = await acme.agent.api('GET', '/api/erp/ai/permissions');
    assert.equal(asAgent.status, 200);
    const granted: string[] = asAgent.body.data.permissions;
    assert.ok(!granted.includes('read_analytics'),
      'the row asked for read_analytics; the caller ceiling removed it');
    assert.ok(granted.includes('read_orders'));
    assert.ok(granted.includes('read_customers'),
      'an agent still needs the customer phone number — their orders are scoped server-side');
  });

  test('a manager keeps every permission', async () => {
    const r = await acme.manager.api('GET', '/api/erp/ai/permissions');
    assert.ok(r.body.data.permissions.includes('read_analytics'));
  });
});
