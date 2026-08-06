import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, uid, BASE, makeErpTenant, makeMember, makeFollowupTask, cleanup, slugOf,
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
