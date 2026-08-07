import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, uid, phone, BASE, makeErpTenant, makeMember, makeFollowupTask, cleanup, slugOf,
  linkProduct,
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

/* -----------------------------------------------------------------------------
 * Phase 6.4c — resolving a follow-up task
 *
 * The follow-up module watches what carriers report. When a shipment reaches a
 * state that needs a person — customer unavailable, a bad address, a reschedule
 * — a task is raised. The agent rings the customer, sorts it out, and marks it
 * done. That last step is what this covers, and it is the one thing the ERP
 * could do that the platform could not until now.
 *
 * The rule the ERP wrote, and the one property worth attacking: an agent must
 * not close out somebody else's task, "whether by accident or to hide an
 * overdue one" (apps/erp/index.js:3508). Resolving asserts *I contacted this
 * customer*, so it is a claim about work done, and a claim about work done is
 * the same class of thing as logging a confirmed call — which is why the ERP
 * guarded it and why every test below tries to get past that guard.
 * -------------------------------------------------------------------------- */

describe('a follow-up task can be resolved, by the right person', () => {
  const orderFor = async (agentUserId?: string) =>
    (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Followup Customer', phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
      ...(agentUserId ? { agentUserId } : {}),
    })).body.data.id as string;

  test('the agent it belongs to resolves it', async () => {
    const orderId = await orderFor(acme.agent.userId);
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.agent.userId,
    });

    const r = await acme.agent.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, 'done');
    assert.ok(r.body.data.resolvedAt, 'resolvedAt was not stamped');
  });

  test('and it settles once — a second resolve does not move the timestamp', async () => {
    // The same reasoning as `deliveryOutcome`: when something was dealt with is
    // a fact about the past, and a stray second press must not rewrite it.
    const orderId = await orderFor(acme.agent.userId);
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.agent.userId,
    });

    const first = await acme.agent.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});
    assert.equal(first.status, 200);

    const second = await acme.agent.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});
    assert.equal(second.status, 200, 'a repeat must not error — the work really is done');
    assert.equal(second.body.data.resolvedAt, first.body.data.resolvedAt,
      'the second press rewrote when the customer was contacted');
  });

  test('a colleague’s task is a 404, not a 403', async () => {
    // The ERP answered 403 NOT_YOUR_TASK. The platform answers 404 for another
    // person's record, exactly as `loadOwnedOrder` does — confirming the task
    // exists and belongs to someone else is itself information, and one rule
    // that can drift beats two.
    const orderId = await orderFor(acme.other.userId);
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.other.userId,
    });

    const r = await acme.agent.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});
    assert.equal(r.status, 404);

    // And it really is still open — the refusal is not cosmetic.
    const still = await acme.manager.api('GET', '/api/erp/followup/tasks');
    const found = still.body.data.items.find((t: any) => t.id === task.id);
    assert.equal(found?.status, 'open', 'the task was resolved despite the refusal');
  });

  test('an unassigned task may be resolved by whoever picks it up', async () => {
    // The ERP guarded on `task.agent && task.agent !== user` — so a task nobody
    // owns is work anybody may do. Same shape as `mayTouchOrder`, which lets an
    // agent act on an unassigned order so work can be picked up rather than only
    // handed out.
    const orderId = await orderFor();
    const task = await makeFollowupTask(acme.tenantId, { orderId, agentUserId: null });

    const r = await acme.agent.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, 'done');
  });

  test('a manager resolves anybody’s', async () => {
    const orderId = await orderFor(acme.other.userId);
    const task = await makeFollowupTask(acme.tenantId, {
      orderId, agentUserId: acme.other.userId,
    });

    const r = await acme.manager.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {});
    assert.equal(r.status, 200);
  });

  test('another tenant’s task id does not resolve', async () => {
    const beta = await makeErpTenant('followup-beta');
    const betaOrder = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Followup', phone: '0555000111',
    })).body.data.id as string;
    const betaTask = await makeFollowupTask(beta.tenantId, {
      orderId: betaOrder, agentUserId: beta.agent.userId,
    });

    // Not a permission check — the binding and row-level security mean the row
    // is not there to be read at all.
    const r = await acme.manager.api('POST', `/api/erp/followup/tasks/${betaTask.id}/resolve`, {});
    assert.equal(r.status, 404);

    const untouched = await beta.manager.api('GET', '/api/erp/followup/tasks');
    assert.equal(
      untouched.body.data.items.find((t: any) => t.id === betaTask.id)?.status,
      'open',
      "a neighbouring tenant's task was resolved",
    );
  });

  test('resolving is a WRITE — reading the queue is not enough', async () => {
    const orderId = await orderFor();
    const task = await makeFollowupTask(acme.tenantId, { orderId, agentUserId: null });

    const reader = await makeMember(acme.tenantId, { role: 'MEMBER' });
    assert.equal((await reader.api('GET', '/api/erp/followup/tasks')).status, 200,
      'a member reads the queue by role glob');
    assert.equal(
      (await reader.api('POST', `/api/erp/followup/tasks/${task.id}/resolve`, {})).status,
      403,
      'but resolving needs erp:orders:write',
    );
  });
});


/** A rendered console page — LP.15's screen assertions need HTML. */
const screen = async (path: string, token: string) => {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  return { status: res.status, body: await res.text() };
};

/* =============================================================================
 * LP.15 / R8 — the sales-channel screen and the adapter registry
 *
 * The channel API has had full CRUD since Phase 5.3c and there was no screen, no
 * nav item, no adapter list, no connection test, no log, and one generic
 * `parseOrder`. A tenant could not connect a Shopify store through the console
 * at all, and the webhook URL — generated once on create — was never shown again
 * by anything.
 * ========================================================================== */

describe('the platform registry says what this deployment can really do (R8)', () => {
  test('every offered platform is listed, and says whether it is real', async () => {
    const r = await acme.manager.api('GET', '/api/erp/sales-channels/adapters');
    assert.equal(r.status, 200);
    const keys = r.body.data.items.map((p: { key: string }) => p.key);
    // The legacy publishes nine.
    for (const key of ['shopify', 'lightfunnels', 'justsell', 'woocommerce', 'custom']) {
      assert.ok(keys.includes(key), `${key} must be offered`);
    }

    const shopify = r.body.data.items.find((p: { key: string }) => p.key === 'shopify');
    assert.equal(shopify.registered, true, 'shopify has a live adapter');
    const justsell = r.body.data.items.find((p: { key: string }) => p.key === 'justsell');
    assert.equal(
      justsell.registered, false,
      'a platform with no adapter must SAY so rather than imply a live integration',
    );
  });

  test('the list is gated like the rest of the channel surface', async () => {
    assert.equal((await acme.agent.api('GET', '/api/erp/sales-channels/adapters')).status, 403);
  });
});

describe('a storefront connection can be tested (R8)', () => {
  test('a platform with no adapter reports STRUCTURALLY and says so', async () => {
    // Seven of the nine offered platforms have no adapter, and refusing them
    // would mean a tenant on JustSell cannot connect a store at all — the
    // opposite of what D-LP.2 protects. What must not happen is a green tick
    // meaning "we did not look".
    const created = await acme.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Structural Store', platform: 'justsell', webhookSecret: 'shh',
    });
    assert.equal(created.status, 201);

    const r = await acme.manager.api(
      'POST', `/api/erp/sales-channels/${created.body.data.id}/test`, {},
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.structural, true);
    assert.equal(r.body.data.ok, true, 'a webhook secret alone is enough configuration');
    assert.match(r.body.data.message, /nothing was contacted/i);
    assert.equal(r.body.data.registered, false);
  });

  test('a channel with no configuration at all fails the structural check', async () => {
    const created = await acme.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Empty Store', platform: 'custom',
    });
    const r = await acme.manager.api(
      'POST', `/api/erp/sales-channels/${created.body.data.id}/test`, {},
    );
    assert.equal(r.body.data.ok, false);
    assert.equal(r.body.data.structural, true);
  });

  test('a real adapter is asked, and its refusal is reported honestly', async () => {
    // A Shopify channel with a bogus domain. The point is that the platform was
    // CONTACTED (or the attempt was made) rather than assumed working —
    // `structural` must be false whatever the outcome.
    const created = await acme.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Shopify Store', platform: 'shopify',
      apiUrl: 'https://127.0.0.1:9', apiKey: 'shpat_nonsense',
    });
    const r = await acme.manager.api(
      'POST', `/api/erp/sales-channels/${created.body.data.id}/test`, {},
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.structural, false, 'a registered adapter must not answer structurally');
    assert.equal(r.body.data.ok, false);
    assert.equal(r.body.data.registered, true);
  });

  test('a test writes lastTestAt, which had no writer at all', async () => {
    const created = await acme.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Timestamp Store', platform: 'custom', webhookSecret: 'x',
    });
    const before = await acme.manager.api('GET', `/api/erp/sales-channels/${created.body.data.id}`);
    assert.ok(!before.body.data.lastTestAt, 'never tested to begin with');

    await acme.manager.api('POST', `/api/erp/sales-channels/${created.body.data.id}/test`, {});
    const after = await acme.manager.api('GET', `/api/erp/sales-channels/${created.body.data.id}`);
    assert.ok(after.body.data.lastTestAt, 'lastTestAt is rendered by the screen and had no writer');
  });

  test('another tenant’s channel is a 404', async () => {
    const beta = await makeErpTenant(`ch-beta-${uid()}`);
    const theirs = (await beta.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Beta Store', platform: 'custom',
    })).body.data.id;
    assert.equal(
      (await acme.manager.api('POST', `/api/erp/sales-channels/${theirs}/test`, {})).status,
      404,
    );
  });
});

describe('what has passed between the company and the storefront (R8)', () => {
  test('a test writes a log row, and the log is readable', async () => {
    const created = await acme.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Logged Store', platform: 'custom', webhookSecret: 'secret-value',
    });
    const id = created.body.data.id;

    const empty = await acme.manager.api('GET', `/api/erp/sales-channels/${id}/logs`);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.data.items.length, 0);

    await acme.manager.api('POST', `/api/erp/sales-channels/${id}/test`, {});

    const after = await acme.manager.api('GET', `/api/erp/sales-channels/${id}/logs`);
    assert.ok(after.body.data.items.length > 0, 'the test wrote no log row');
    assert.equal(after.body.data.items[0].event, 'test_connection');
    // The whole reason `redact` exists.
    assert.ok(
      !JSON.stringify(after.body.data).includes('secret-value'),
      'a credential reached the integration log',
    );
  });

  test('an inbound webhook is recorded whether it lands or not', async () => {
    const staged = await makeErpTenant(`chlog-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Inbound Store', platform: 'shopify', webhookSecret: 'wh-secret',
    });
    const id = created.body.data.id;

    // A payload with a signature that cannot verify. It must be acknowledged
    // (200, so the platform does not disable the endpoint) AND recorded.
    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': 'wrong' },
      body: JSON.stringify({ id: 1, total_price: '100' }),
    });

    const logs = await staged.manager.api('GET', `/api/erp/sales-channels/${id}/logs`);
    const events = logs.body.data.items.map((l: { event: string }) => l.event);
    assert.ok(
      events.includes('webhook_rejected'),
      `a rejected webhook must be visible: ${JSON.stringify(events)}`,
    );
  });

  test('the log is gated like the rest of the channel surface', async () => {
    const created = await acme.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Gated Store', platform: 'custom',
    });
    assert.equal(
      (await acme.agent.api('GET', `/api/erp/sales-channels/${created.body.data.id}/logs`)).status,
      403,
    );
  });
});

describe('each platform’s own payload shape is read (R8)', () => {
  test('a Shopify order lands with its product, wilaya and total', async () => {
    const staged = await makeErpTenant(`shop-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Shopify Inbound', platform: 'shopify',
    });
    const id = created.body.data.id;

    // No webhook secret configured, so an unsigned payload is accepted —
    // existing integrations predate the secret and breaking them silently loses
    // real orders. See `verifySignature`.
    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'orders/create' },
      body: JSON.stringify({
        id: 9001, name: '#1042', phone: '0555112233', total_price: '4900.00',
        shipping_address: { name: 'Amina B', address1: 'Rue 5', province: 'Alger', city: 'Bab Ezzouar' },
        line_items: [{ name: 'Shopify Widget', quantity: 2, price: '2450.00' }],
      }),
    });
    assert.equal(res.status, 200);

    const orders = await staged.manager.api('GET', '/api/erp/orders?search=Shopify%20Widget');
    const order = orders.body.data.items[0];
    assert.ok(order, 'the Shopify payload produced no order');
    assert.equal(order.client, 'Amina B');
    assert.equal(order.wilaya, 'Alger', 'Shopify calls a wilaya `province`');
    assert.equal(order.product, 'Shopify Widget');
    assert.equal(order.quantity, 2);
  });

  test('a LightFunnels order is read from its own `node`/`items` envelope', async () => {
    // The generic parser reads Shopify tolerably and LightFunnels not at all:
    // the order is wrapped in `{ node: … }` and the line items are `items`.
    const staged = await makeErpTenant(`lf-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'LF Inbound', platform: 'lightfunnels',
    });
    const id = created.body.data.id;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        node: {
          id: 'order_77', phone: '0555998877', total: 3500, email: 'x@y.z',
          items: [{ title: 'LF Widget', price: 3500, quantity: 1 }],
          shipping_address: { name: 'Karim L', province: 'Oran', city: 'Bir El Djir' },
        },
      }),
    });
    assert.equal(res.status, 200);

    const orders = await staged.manager.api('GET', '/api/erp/orders?search=LF%20Widget');
    const order = orders.body.data.items[0];
    assert.ok(order, 'the LightFunnels envelope produced no order');
    assert.equal(order.product, 'LF Widget');
    assert.equal(order.wilaya, 'Oran');
  });

  test('the LightFunnels checkout stub with no phone creates NOTHING', async () => {
    // Ported verbatim from a live integration: this event fires with only an id
    // (prefixed `ch_`) the instant a customer lands on the checkout page, and
    // its id never matches the real order's later. Creating from it produced an
    // empty "Client / 0 DA" row every time.
    const staged = await makeErpTenant(`lfstub-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'LF Stub', platform: 'lightfunnels',
    });

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${created.body.data.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: { id: 'ch_abc123' } }),
    });

    const orders = await staged.manager.api('GET', '/api/erp/orders');
    assert.equal(orders.body.data.total, 0, 'a checkout stub must not become an order');

    const logs = await staged.manager.api(
      'GET', `/api/erp/sales-channels/${created.body.data.id}/logs`,
    );
    const events = logs.body.data.items.map((l: { event: string }) => l.event);
    assert.ok(events.includes('webhook_unparsed'), 'and it must be visible in the log');
  });

  test('a Shopify topic that is not an order is ignored, not turned into one', async () => {
    const staged = await makeErpTenant(`topic-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Topic Store', platform: 'shopify',
    });

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${created.body.data.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'products/update' },
      body: JSON.stringify({ id: 555, title: 'Some Product' }),
    });

    const orders = await staged.manager.api('GET', '/api/erp/orders');
    assert.equal(orders.body.data.total, 0, 'a product update is not an order');
  });
});

describe('the sales-channel screen exists (R8)', () => {
  test('it renders inside the shell, with the webhook URL in full', async () => {
    const staged = await makeErpTenant(`chui-${uid()}`);
    await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Visible Store', platform: 'shopify',
    });

    const r = await screen('/console/erp/sales-channels', staged.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-channels-table"/);
    assert.match(r.body, /data-testid="product-switcher"/, 'it is inside the console shell');
    assert.match(r.body, /data-testid="channel-webhook-url"/);
    // The whole product of the screen: the URL somebody pastes into Shopify.
    assert.match(r.body, /\/api\/erp\/webhooks\/[^"<]+\/channel\//);
    assert.match(r.body, /data-testid="channel-create"/);
  });

  test('a platform with no live adapter is marked on the row', async () => {
    const staged = await makeErpTenant(`chna-${uid()}`);
    await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'JustSell Store', platform: 'justsell',
    });
    const r = await screen('/console/erp/sales-channels', staged.manager.token);
    assert.match(r.body, /data-badge="no-adapter"/);
  });

  test('no credential reaches the page, and the screen says one exists', async () => {
    const staged = await makeErpTenant(`chsec-${uid()}`);
    await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Secret Store', platform: 'shopify',
      apiKey: 'shpat_supersecret', webhookSecret: 'whsec_supersecret',
    });
    const r = await screen('/console/erp/sales-channels', staged.manager.token);
    assert.doesNotMatch(r.body, /shpat_supersecret/);
    assert.doesNotMatch(r.body, /whsec_supersecret/);
    assert.match(r.body, /data-configured="true"/);
  });

  test('an agent typing the URL gets 404, and the nav does not offer it', async () => {
    const r = await screen('/console/erp/sales-channels', acme.agent.token);
    assert.equal(r.status, 404, 'a nav item is a hint; the URL is typeable');

    const orders = await screen('/console/erp/orders', acme.agent.token);
    assert.ok(!/\/console\/erp\/sales-channels/.test(orders.body), 'the nav must hide it too');
  });
});

/* =============================================================================
 * LP.20 / R19 — lead capture, product sync, and Shopify topic routing
 *
 * Three inbound paths the port dropped. The first is a real revenue path: a
 * phone number typed into a checkout form and never submitted is a callable
 * lead, and no platform event exposes one — the legacy confirmed that against
 * six real-webhook tests before building a route that bypasses the event system
 * entirely.
 * ========================================================================== */

describe('a phone typed into a checkout and abandoned is captured (R19)', () => {
  test('it creates an abandoned lead, and nothing that looks like money', async () => {
    const staged = await makeErpTenant(`lead-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Lead Store', platform: 'lightfunnels',
    })).body.data.id;
    const p = phone();

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/lead-capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: p, name: 'Walk Away', wilaya: 'Alger', pageUrl: 'https://shop/checkout' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created, true);

    const orders = await staged.manager.api('GET', '/api/erp/orders');
    const order = orders.body.data.items[0];
    assert.equal(order.client, 'Walk Away');
    assert.equal(order.orderType, 'abandoned');
    assert.equal(order.status, 'abandoned', 'a lead must never look like a placed order');
    // D-LP.20.1: nothing this endpoint creates may look like a sale.
    assert.equal(Number(order.price), 0);
  });

  test('a second keystroke MERGES rather than creating a second lead', async () => {
    // The checkout script fires on every debounce: name, then phone, then
    // wilaya. Without the merge that is four leads for one person.
    const staged = await makeErpTenant(`merge-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Merge Store', platform: 'lightfunnels',
    })).body.data.id;
    const p = phone();
    const post = (body: object) =>
      fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/lead-capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    await post({ phone: p });
    await post({ phone: p, name: 'Typed Later' });
    await post({ phone: p, wilaya: 'Oran' });

    const orders = await staged.manager.api('GET', '/api/erp/orders');
    assert.equal(orders.body.data.total, 1, 'three keystrokes became three leads');
    const order = orders.body.data.items[0];
    assert.equal(order.client, 'Typed Later', 'a later keystroke must fill a blank field');
    assert.equal(order.wilaya, 'Oran');
  });

  test('a merge never blanks a field an earlier call set', async () => {
    const staged = await makeErpTenant(`noblank-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'NoBlank Store', platform: 'lightfunnels',
    })).body.data.id;
    const p = phone();
    const post = (body: object) =>
      fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/lead-capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    await post({ phone: p, name: 'First Name', wilaya: 'Alger' });
    await post({ phone: p, name: '', wilaya: 'Oran' });

    const order = (await staged.manager.api('GET', '/api/erp/orders')).body.data.items[0];
    assert.equal(order.client, 'First Name');
    assert.equal(order.wilaya, 'Alger', 'a real value was replaced');
  });

  test('nothing phone-shaped yet is a 200 that writes nothing', async () => {
    // The script fires on every debounce; a 4xx in a browser console teaches
    // somebody to remove the snippet.
    const staged = await makeErpTenant(`nolead-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Empty Store', platform: 'lightfunnels',
    })).body.data.id;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/lead-capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '05', name: 'Too Early' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).lead, false);
    assert.equal((await staged.manager.api('GET', '/api/erp/orders')).body.data.total, 0);
  });

  test('a disabled channel accepts nothing — the tenant can turn it off', async () => {
    // D-LP.20.1's fourth bound: this endpoint has no signature by design, so a
    // tenant being abused needs a switch, and it is the one LP.15 renders.
    const staged = await makeErpTenant(`off-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Off Store', platform: 'lightfunnels',
    })).body.data.id;
    await staged.manager.api('DELETE', `/api/erp/sales-channels/${channel}`);

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/lead-capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: phone(), name: 'Blocked' }),
    });
    assert.equal((await staged.manager.api('GET', '/api/erp/orders')).body.data.total, 0);
  });

  test('an unknown tenant answers exactly like a known one', async () => {
    // A webhook endpoint must not be usable to enumerate customers.
    const res = await fetch(`${BASE}/api/erp/webhooks/no-such-tenant/channel/x/lead-capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: phone() }),
    });
    assert.equal(res.status, 200);
  });

  test('the preflight is answered, because the caller is a public page', async () => {
    const res = await fetch(`${BASE}/api/erp/webhooks/x/channel/y/lead-capture`, {
      method: 'OPTIONS',
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  test('every call is recorded, so abuse is visible rather than inferred', async () => {
    const staged = await makeErpTenant(`leadlog-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Logged Lead', platform: 'lightfunnels',
    })).body.data.id;

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/lead-capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: phone(), name: 'Recorded' }),
    });

    const logs = await staged.manager.api('GET', `/api/erp/sales-channels/${channel}/logs`);
    const events = logs.body.data.items.map((l: { event: string }) => l.event);
    assert.ok(events.includes('lead_capture'), JSON.stringify(events));
  });
});

describe('a product created on the storefront becomes a catalogue row (R19)', () => {
  const shopifyProduct = {
    id: 8899, title: 'Synced Serum',
    variants: [
      { title: '30ml', sku: 'SER-30', price: '2500.00' },
      { title: '50ml', sku: 'SER-50', price: '3900.00' },
    ],
    images: [{ src: 'https://cdn/serum.png' }],
  };

  test('it creates the product AND the link revenue attribution reads first', async () => {
    const staged = await makeErpTenant(`prod-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Product Store', platform: 'shopify',
    })).body.data.id;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/product`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'products/create' },
      body: JSON.stringify(shopifyProduct),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.created, true);

    const products = await staged.manager.api('GET', '/api/erp/products?search=Synced');
    const product = products.body.data.items[0];
    assert.equal(product.name, 'Synced Serum');
    assert.equal(String(product.price), '2500');
    assert.equal(product.variants.length, 2);
    // D-LP.18.1 — a variant from a webhook starts at zero; a level here would
    // be a level with no movement row behind it.
    assert.equal(product.variants[0].stock, 0);
    assert.ok(product.reference, 'a catalogue row must carry its own number');
  });

  test('a second delivery of the same product creates NOTHING', async () => {
    const staged = await makeErpTenant(`dupe-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Dupe Store', platform: 'shopify',
    })).body.data.id;
    const post = () =>
      fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/product`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(shopifyProduct),
      });

    await post();
    const second = await (await post()).json();
    assert.equal(second.created, false);
    assert.equal(second.duplicate, true);
    assert.equal((await staged.manager.api('GET', '/api/erp/products')).body.data.total, 1);
  });

  test('an existing product is never UPDATED by a webhook', async () => {
    // The catalogue carries `costPrice`, `packagingCost` and a stock ledger the
    // storefront knows nothing about. A `products/update` echoing a retail
    // price back over a cost basis would corrupt every margin.
    const staged = await makeErpTenant(`noupd-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'NoUpdate Store', platform: 'shopify',
    })).body.data.id;
    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/product`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(shopifyProduct),
    });

    const id = (await staged.manager.api('GET', '/api/erp/products')).body.data.items[0].id;
    await staged.manager.api('PATCH', `/api/erp/products/${id}`, { costPrice: 900 });

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/product`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...shopifyProduct, title: 'Renamed', variants: [{ title: 'x', price: '1' }] }),
    });

    const after = (await staged.manager.api('GET', `/api/erp/products/${id}`)).body.data;
    assert.equal(after.name, 'Synced Serum', 'a webhook renamed a catalogue product');
    assert.equal(String(after.costPrice), '900', 'a webhook overwrote a cost basis');
  });

  test('a platform with no product integration refuses to guess', async () => {
    // D-LP.2's rule: a catalogue row invented from a misread payload is worse
    // than no row, because somebody prices from it.
    const staged = await makeErpTenant(`noadapter-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Unknown Store', platform: 'justsell',
    })).body.data.id;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/product`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(shopifyProduct),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created, false);
    assert.equal((await staged.manager.api('GET', '/api/erp/products')).body.data.total, 0);

    const logs = await staged.manager.api('GET', `/api/erp/sales-channels/${channel}/logs`);
    const events = logs.body.data.items.map((l: { event: string }) => l.event);
    assert.ok(events.includes('webhook_unparsed'), 'and it must be visible');
  });

  test('the signature IS checked here — the caller is the platform', async () => {
    const staged = await makeErpTenant(`prodsig-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Signed Store', platform: 'shopify', webhookSecret: 'shh',
    })).body.data.id;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}/product`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': 'wrong' },
      body: JSON.stringify(shopifyProduct),
    });
    assert.equal(res.status, 200, 'a rejected payload is acknowledged, not refused');
    assert.equal((await staged.manager.api('GET', '/api/erp/products')).body.data.total, 0);
  });
});

describe('Shopify sends every topic down one URL (R19)', () => {
  test('a checkouts/create topic on the ORDER endpoint lands as abandoned', async () => {
    // The legacy's own reason: an abandoned checkout carries a DIFFERENT
    // payload shape, so force-fitting it into the order pipeline produces a
    // "sale" nobody made.
    const staged = await makeErpTenant(`topic-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Topic Store', platform: 'shopify',
    })).body.data.id;

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'checkouts/create' },
      body: JSON.stringify({
        id: 7001, phone: '0555667788', total_price: '1500',
        shipping_address: { name: 'Half Way', province: 'Alger', city: 'Kouba' },
        line_items: [{ name: 'Cart Item', quantity: 1, price: '1500' }],
      }),
    });

    const order = (await staged.manager.api('GET', '/api/erp/orders')).body.data.items[0];
    assert.ok(order, 'the checkout topic produced no row at all');
    assert.equal(order.orderType, 'abandoned', 'a checkout became a placed order');
  });

  test('a draft_orders topic is marked as a draft, not dropped and not a sale', async () => {
    const staged = await makeErpTenant(`draft-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Draft Store', platform: 'shopify',
    })).body.data.id;

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'draft_orders/create' },
      body: JSON.stringify({
        id: 7002, phone: '0555112244', total_price: '2000', name: '#D1',
        shipping_address: { name: 'Assistant Typed', province: 'Oran', city: 'Es Senia' },
        line_items: [{ name: 'Draft Item', quantity: 1, price: '2000' }],
      }),
    });

    const order = (await staged.manager.api('GET', '/api/erp/orders')).body.data.items[0];
    assert.ok(order, 'the draft topic produced no row');
    assert.equal(order.orderType, 'draft');
  });

  test('an orders/create topic is still an ordinary order', async () => {
    const staged = await makeErpTenant(`plain-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = (await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Plain Store', platform: 'shopify',
    })).body.data.id;

    await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'orders/create' },
      body: JSON.stringify({
        id: 7003, phone: '0555998811', total_price: '3000',
        shipping_address: { name: 'Real Buyer', province: 'Alger', city: 'Hydra' },
        line_items: [{ name: 'Real Item', quantity: 1, price: '3000' }],
      }),
    });

    const order = (await staged.manager.api('GET', '/api/erp/orders')).body.data.items[0];
    assert.equal(order.orderType, 'normal');
    assert.equal(order.status, 'pending', 'a real order belongs in the confirmation queue');
  });
});

/* =============================================================================
 * LP.21 / R13, N14 — assigning follow-up by hand, and the live countdown
 *
 * LP.9 built the RULE and reached it only in bulk. This is the single-order
 * door — the one a supervisor uses when a customer has become difficult and
 * needs a senior agent — plus the countdown on a screen whose entire subject is
 * a deadline.
 * ========================================================================== */

describe('a follow-up agent can be assigned by hand (R13)', () => {
  test('a named person is honoured', async () => {
    const staged = await makeErpTenant(`fa-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Difficult', phone: phone(), price: 3000,
    })).body.data.id;

    const r = await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.agent.userId,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.followupUserId, staged.agent.userId);
    assert.equal(r.body.data.auto, false);

    const after = (await staged.manager.api('GET', `/api/erp/orders/${order}`)).body.data;
    assert.equal(after.followupUserId, staged.agent.userId);
  });

  test('auto: true picks somebody, and an EMPTY body does not', async () => {
    // The distinction that matters: a supervisor who meant to name somebody and
    // sent an empty select must not discover the system picked for them.
    const staged = await makeErpTenant(`fauto-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Auto', phone: phone(), price: 100,
    })).body.data.id;

    const empty = await staged.manager.api('POST', '/api/erp/followup/assign', { orderId: order });
    assert.equal(empty.status, 422);
    assert.equal(empty.body.error.code, 'NO_ASSIGNEE');

    const auto = await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, auto: true,
    });
    assert.equal(auto.status, 200);
    assert.ok(auto.body.data.followupUserId);
    assert.equal(auto.body.data.auto, true);
  });

  test('it OVERWRITES an existing assignee — that is the business case', async () => {
    const staged = await makeErpTenant(`fmove-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Moved', phone: phone(), price: 100,
    })).body.data.id;

    await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.agent.userId,
    });
    await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.other.userId,
    });

    const after = (await staged.manager.api('GET', `/api/erp/orders/${order}`)).body.data;
    assert.equal(after.followupUserId, staged.other.userId);
  });

  test('an ineligible person is refused with a code that says WHICH problem', async () => {
    // Two different problems and two different screens to go to: nobody carries
    // the job role at all, or this person cannot take work right now.
    const staged = await makeErpTenant(`fine-${uid()}`);
    const bystander = await makeMember(staged.tenantId, { role: 'MEMBER' });
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Refused', phone: phone(), price: 100,
    })).body.data.id;

    const r = await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: bystander.userId,
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'NOT_ELIGIBLE');
    assert.ok(Array.isArray(r.body.error.eligible), 'it must say who CAN take it');
  });

  test('an agent cannot assign — followupUserId is a reassignment field', async () => {
    const staged = await makeErpTenant(`fperm-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Gated', phone: phone(), price: 100, agentUserId: staged.agent.userId,
    })).body.data.id;

    const r = await staged.agent.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.agent.userId,
    });
    assert.equal(r.status, 403);
  });

  test('another tenant’s order is a 404', async () => {
    const a = await makeErpTenant(`fa1-${uid()}`);
    const b = await makeErpTenant(`fb1-${uid()}`);
    const theirs = (await b.manager.api('POST', '/api/erp/orders', {
      client: 'Theirs', phone: phone(), price: 100,
    })).body.data.id;

    const r = await a.manager.api('POST', '/api/erp/followup/assign', {
      orderId: theirs, userId: a.agent.userId,
    });
    assert.equal(r.status, 404);
  });

  test('whoever receives the work is TOLD, and the supervisor is not', async () => {
    // Work that lands in a queue silently is work nobody knows they have — and
    // follow-up work is a customer waiting for a call.
    const staged = await makeErpTenant(`fnotify-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Notified', phone: phone(), price: 100,
    })).body.data.id;

    const before = (await staged.agent.api('GET', '/api/platform/notifications?limit=50'))
      .body.data.items.length;

    await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.agent.userId,
    });

    const after = (await staged.agent.api('GET', '/api/platform/notifications?limit=50'))
      .body.data.items;
    assert.equal(after.length, before + 1, 'the assignee was not told');
    assert.equal(after[0].type, 'followup_assigned');
  });

  test('re-assigning the SAME person tells them nothing new', async () => {
    const staged = await makeErpTenant(`fsame-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Same', phone: phone(), price: 100,
    })).body.data.id;

    await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.agent.userId,
    });
    const after1 = (await staged.agent.api('GET', '/api/platform/notifications?limit=50'))
      .body.data.items.length;

    await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.agent.userId,
    });
    const after2 = (await staged.agent.api('GET', '/api/platform/notifications?limit=50'))
      .body.data.items.length;
    assert.equal(after2, after1, 'a no-op assignment notified somebody');
  });

  test('it writes the same audit row the bulk action does', async () => {
    const staged = await makeErpTenant(`faudit-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Audited', phone: phone(), price: 100,
    })).body.data.id;
    await staged.manager.api('POST', '/api/erp/followup/assign', {
      orderId: order, userId: staged.agent.userId,
    });

    const audit = await staged.manager.api(
      'GET', `/api/erp/audit?entity=order&entityId=${order}`,
    );
    const actions = audit.body.data.items.map((e: { action: string }) => e.action);
    assert.ok(actions.includes('followup_assign'), JSON.stringify(actions));
  });
});

describe('the follow-up screen offers the control and a live countdown (R13, N14)', () => {
  test('a manager gets the assignment control on every task row', async () => {
    const staged = await makeErpTenant(`fui-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Task Owner', phone: phone(), price: 100,
    })).body.data.id;
    await makeFollowupTask(staged.tenantId, { orderId: order, agentUserId: staged.agent.userId });

    const r = await screen('/console/erp/follow-up', staged.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="followup-assign"/);
    assert.match(r.body, new RegExp(`data-testid="followup-auto-${order}"`));
  });

  test('the due date renders as an absolute time the server produced', async () => {
    // The countdown is a client component; the first paint (and the whole page
    // without JavaScript) must still carry a real answer rather than an empty
    // cell — which is also what keeps hydration from mismatching on a clock.
    const staged = await makeErpTenant(`ftick-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Due Soon', phone: phone(), price: 100,
    })).body.data.id;
    await makeFollowupTask(staged.tenantId, { orderId: order, agentUserId: staged.agent.userId });

    const r = await screen('/console/erp/follow-up', staged.manager.token);
    assert.match(r.body, /data-testid="countdown-absolute"/);
  });

  test('an agent gets their own tasks and NO assignment control', async () => {
    const staged = await makeErpTenant(`fagent-${uid()}`);
    const order = (await staged.manager.api('POST', '/api/erp/orders', {
      client: 'Agent Task', phone: phone(), price: 100,
    })).body.data.id;
    await makeFollowupTask(staged.tenantId, { orderId: order, agentUserId: staged.agent.userId });

    const r = await screen('/console/erp/follow-up', staged.agent.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-followup-table"/);
    assert.ok(!/data-testid="followup-assign"/.test(r.body), 'the route would answer 403');
  });
});


/* =============================================================================
 * AUDIT.7 — the three fields the parser threw away.
 *
 * `FulfillmentOrder.externalProductId`, `externalVariantId` and
 * `externalOrderAt` exist in the schema and **nothing wrote any of them.**
 *
 * The first is the expensive one. `resolveProduct` reads `externalProductId`
 * FIRST — "a link that resolves DECIDES, including deciding 'this one and not
 * the name match'" — and that branch was dead for every order ever written.
 * Every channel order matched by NAME instead, and AUDIT.3 has just made name
 * matching REFUSE when two catalogue rows share one.
 *
 * WHY NO TEST CAUGHT IT, which is the part worth keeping: `delivery.test.ts`
 * covers the link branch thoroughly and reaches it through a HELPER —
 * `setOrderExternalProduct` writes the column directly. The branch was proven
 * correct and unreachable at the same time. **A test that stages the state a
 * production path is supposed to produce cannot tell you the path produces it.**
 * These assert the WEBHOOK writes it.
 * ========================================================================== */

describe('an inbound order keeps the identity the platform sent (AUDIT.7)', () => {
  test('a Shopify order carries its product id, variant id and store date', async () => {
    const staged = await makeErpTenant(`ext7-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Shopify Ext', platform: 'shopify',
    });
    const id = created.body.data.id;

    // Three days ago: what a replayed backlog looks like the day a store is
    // first connected, and the case where `createdAt` is the wrong date.
    const storeDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const marker = `Ext Widget ${uid()}`;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'orders/create' },
      body: JSON.stringify({
        id: 77001, name: '#2042', phone: '0555443322', total_price: '5900.00',
        created_at: storeDate,
        shipping_address: { name: 'Yasmine K', address1: 'Rue 9', province: 'Alger', city: 'Kouba' },
        line_items: [{ name: marker, quantity: 1, price: '5900.00', product_id: 55501, variant_id: 99001 }],
      }),
    });
    assert.equal(res.status, 200);

    const orders = await staged.manager.api(
      'GET', `/api/erp/orders?search=${encodeURIComponent(marker)}`,
    );
    const order = orders.body.data.items[0];
    assert.ok(order, 'the payload produced no order');

    const detail = await staged.manager.api('GET', `/api/erp/orders/${order.id}`);
    const d = detail.body.data;
    assert.equal(String(d.externalProductId), '55501', 'the catalogue identity was dropped');
    assert.equal(String(d.externalVariantId), '99001', 'the variant identity was dropped');
    assert.ok(d.externalOrderAt, 'the store date was dropped');
    assert.equal(
      new Date(d.externalOrderAt).toISOString().slice(0, 10),
      storeDate.slice(0, 10),
      'the store date is not the date the customer ordered',
    );
  });

  test('a LightFunnels order keeps the same three, from its own envelope', async () => {
    const staged = await makeErpTenant(`ext7lf-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'LF Ext', platform: 'lightfunnels',
    });
    const id = created.body.data.id;
    const marker = `LF Ext ${uid()}`;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        node: {
          id: `lf_${uid()}`, phone: '0555887766', total: 3000, email: 'a@b.c',
          created_at: '2026-07-01T09:15:00.000Z',
          items: [{ title: marker, price: 3000, quantity: 1, product_id: 'lfp_1', variant_id: 'lfv_1' }],
          shipping_address: { name: 'Sofiane M', province: 'Oran', city: 'Es Senia' },
        },
      }),
    });
    assert.equal(res.status, 200);

    const orders = await staged.manager.api(
      'GET', `/api/erp/orders?search=${encodeURIComponent(marker)}`,
    );
    const detail = await staged.manager.api('GET', `/api/erp/orders/${orders.body.data.items[0].id}`);
    assert.equal(detail.body.data.externalProductId, 'lfp_1');
    assert.equal(detail.body.data.externalVariantId, 'lfv_1');
    assert.ok(detail.body.data.externalOrderAt);
  });

  test('a payload with none of them still produces an order', async () => {
    // The forgiving rule this parser is built on: a missing field must never
    // lose the sale. Most of the nine platforms send none of these.
    const staged = await makeErpTenant(`ext7bare-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Bare', platform: 'custom',
    });
    const marker = `Bare Widget ${uid()}`;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${created.body.data.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `bare_${uid()}`, phone: '0555110099', total: 1200,
        line_items: [{ title: marker, quantity: 1 }],
      }),
    });
    assert.equal(res.status, 200);

    const orders = await staged.manager.api(
      'GET', `/api/erp/orders?search=${encodeURIComponent(marker)}`,
    );
    const order = orders.body.data.items[0];
    assert.ok(order, 'a payload without the optional fields lost the order');
    const detail = await staged.manager.api('GET', `/api/erp/orders/${order.id}`);
    assert.equal(detail.body.data.externalProductId, null);
    assert.equal(detail.body.data.externalOrderAt, null, 'an absent date must be null, not now');
  });

  test('a malformed store date leaves the column null rather than poisoning it', async () => {
    // An Invalid Date on a DateTime column is either a throw or a row no date
    // range can ever match. Neither is acceptable for a field a platform
    // controls and this system does not.
    const staged = await makeErpTenant(`ext7bad-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const created = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Bad date', platform: 'custom',
    });
    const marker = `Bad Date ${uid()}`;

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${created.body.data.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `bad_${uid()}`, phone: '0555110098', total: 1200,
        created_at: 'not a date at all',
        line_items: [{ title: marker, quantity: 1 }],
      }),
    });
    assert.equal(res.status, 200, 'a malformed date lost the order');

    const orders = await staged.manager.api(
      'GET', `/api/erp/orders?search=${encodeURIComponent(marker)}`,
    );
    const detail = await staged.manager.api('GET', `/api/erp/orders/${orders.body.data.items[0].id}`);
    assert.equal(detail.body.data.externalOrderAt, null);
  });

  test('the identity the webhook wrote is what attributes the sale', async () => {
    /* The whole point, end to end. Two catalogue rows with one name — which
       AUDIT.3 made attribute to NEITHER — plus a link on one of them, and an
       order arriving by webhook naming that listing. Before this slice the
       webhook dropped the id, the name was ambiguous, and both read zero. */
    const staged = await makeErpTenant(`ext7attr-${uid()}`);
    const slug = await slugOf(staged.tenantId);
    const channel = await staged.manager.api('POST', '/api/erp/sales-channels', {
      name: 'Attrib', platform: 'shopify',
    });
    const channelId = channel.body.data.id;

    const shared = `Twin Ext ${uid()}`;
    const mine = (await staged.manager.api('POST', '/api/erp/products', {
      name: shared, price: 4000, costPrice: 1000, variants: [{ name: 'Solo', stock: 20 }],
    })).body.data;
    const theirs = (await staged.manager.api('POST', '/api/erp/products', {
      name: shared, price: 4000, costPrice: 1000, variants: [{ name: 'Solo', stock: 20 }],
    })).body.data;

    const externalProductId = `ext-${uid()}`;
    await linkProduct(staged.tenantId, theirs.id, { externalProductId, salesChannelId: channelId });

    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/channel/${channelId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'orders/create' },
      body: JSON.stringify({
        id: `attr_${uid()}`, phone: '0555220011', total_price: '4000.00',
        shipping_address: { name: 'Nadia R', province: 'Alger', city: 'Hydra' },
        line_items: [{ name: shared, quantity: 1, price: '4000.00', product_id: externalProductId }],
      }),
    });
    assert.equal(res.status, 200);

    const orders = await staged.manager.api(
      'GET', `/api/erp/orders?search=${encodeURIComponent(shared)}`,
    );
    const orderId = orders.body.data.items[0].id;
    // Confirming is what moves the lifetime counters.
    await staged.manager.api('PATCH', `/api/erp/orders/${orderId}`, { status: 'confirmed' });

    const forMine = (await staged.manager.api('GET', `/api/erp/products/${mine.id}`)).body.data;
    const forTheirs = (await staged.manager.api('GET', `/api/erp/products/${theirs.id}`)).body.data;
    assert.equal(forMine.confirmedOrders, 0, 'the unlinked twin took the sale');
    assert.equal(
      forTheirs.confirmedOrders, 1,
      'the linked product did not get the sale — the webhook dropped the id again',
    );
  });
});
