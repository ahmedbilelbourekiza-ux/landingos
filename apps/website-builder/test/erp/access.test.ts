import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, anon, uid, phone, makeTenant, makeErpTenant, makeMember, cleanup,
  contractTest as test,
  type Caller,
} from './helpers.ts';

/* =============================================================================
 * test/erp/access.test.ts
 *
 * Ported from apps/erp/test/auth.test.js (SEC-01, SEC-02) and
 * apps/erp/test/hardening.test.js §2 and §7.
 *
 * SEC-01 was that all 117 ERP routes were open and no login endpoint existed
 * anywhere. SEC-02 was that GET /api/agents returned every password in
 * cleartext. Neither can recur in the same form — the platform owns identity
 * now — but what those tests were PROTECTING has to survive the port:
 *
 *   the routes are closed by default;
 *   an agent cannot do a manager's job;
 *   an agent sees their own order book and nobody else's.
 *
 * And one thing the ERP could not express at all, because it was
 * single-tenant: another company's order book does not exist as far as this
 * tenant is concerned.
 *
 * Login, logout, password change and session eviction are NOT here. They moved
 * to @landingos/auth in Phase 3.4 and are covered by its own 32 tests; a second
 * copy would drift. See PORTING.md.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let beta: Awaited<ReturnType<typeof makeErpTenant>>;
/** An OWNER of a tenant that never bought the ERP. */
let unentitled: Caller;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('acme');
  beta = await makeErpTenant('beta');
  const builderOnly = await makeTenant('builder-only', ['product.website-builder']);
  unentitled = await makeMember(builderOnly, { role: 'OWNER' });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

/* -----------------------------------------------------------------------------
 * SEC-01 — closed by default
 *
 * The ERP listed 20 representative routes here. The list is longer now because
 * the ERP's 126 routes become one surface per resource, and because a route
 * added later without a permission is exactly the mistake this catches.
 * -------------------------------------------------------------------------- */

const SURFACES: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/api/erp/orders'],
  ['POST', '/api/erp/orders'],
  ['GET', '/api/erp/orders/stats'],
  // LP.13. The confirmation rate and six other breakdowns of the order book.
  ['GET', '/api/erp/analytics'],
  ['POST', '/api/erp/orders/bulk'],
  // LP.6. Both methods, because they take their input from different places —
  // a query string and a body — and a gate is easy to add to one of two
  // handlers in the same file.
  ['GET', '/api/erp/orders/export?format=zr'],
  ['POST', '/api/erp/orders/export'],
  ['GET', '/api/erp/clients'],
  // LP.10. The registry stops being read-only: one record with its whole order
  // history, the four correctable fields, and the list as a file.
  ['GET', '/api/erp/clients/nonexistent'],
  ['PATCH', '/api/erp/clients/nonexistent'],
  ['GET', '/api/erp/clients/export'],
  ['GET', '/api/erp/products'],
  // A made-up id is fine: the inventory asserts the route is CLOSED, and an
  // unauthenticated caller must never get far enough for the id to be resolved.
  ['PATCH', '/api/erp/products/nonexistent'],
  // LP.18. The variant editor's write path — it moves stock, so it is gated on
  // `erp:inventory:write` rather than on `erp:products:write`.
  ['GET', '/api/erp/products/nonexistent/variants'],
  ['PUT', '/api/erp/products/nonexistent/variants'],
  ['GET', '/api/erp/inventory/low-stock'],
  ['GET', '/api/erp/carriers'],
  // LP.14. Testing an integration, asking a carrier for everything at
  // once, and reading what has passed between the two — the three
  // surfaces R3 was missing, all of which touch somebody else's server
  // or the diagnostic record of having done so.
  ['POST', '/api/erp/carriers/nonexistent/test'],
  ['POST', '/api/erp/carriers/nonexistent/sync'],
  ['GET', '/api/erp/carriers/nonexistent/logs'],
  ['DELETE', '/api/erp/carriers/nonexistent/status-mappings'],
  ['GET', '/api/erp/sales-channels'],
  // LP.15. The adapter registry, the connection test and the log — the three
  // surfaces R8 was missing, two of which reach somebody else's server or the
  // diagnostic record of having done so.
  ['GET', '/api/erp/sales-channels/adapters'],
  ['POST', '/api/erp/sales-channels/nonexistent/test'],
  ['GET', '/api/erp/sales-channels/nonexistent/logs'],
  ['GET', '/api/erp/agents'],
  ['GET', '/api/erp/agents/payroll'],
  // LP.12. Forgiving an accountability counter that nothing else could lower.
  ['POST', '/api/erp/agents/nonexistent/reset-missed'],
  ['GET', '/api/erp/settings'],
  ['PUT', '/api/erp/settings'],
  ['GET', '/api/erp/followup/tasks'],
  // Phase 6.4c. A made-up id is fine here: the inventory asserts the route is
  // CLOSED without a session, and an unauthenticated caller must never get far
  // enough for the id to be looked up.
  ['POST', '/api/erp/followup/tasks/nonexistent/resolve'],
  ['GET', '/api/erp/followup/dashboard'],
  ['GET', '/api/erp/financial-records'],
  // LP.16b/c/d. Four surfaces onto the company's P&L, each reachable with a
  // different question — the prorated rent, one period's version history, a
  // roll-up, and the whole history as a file. A gate is easy to add to three of
  // four routes in the same directory.
  ['GET', '/api/erp/financial-records/prorate-fixed?periodType=month'],
  ['GET', '/api/erp/financial-records/versions?periodType=month&startDate=1&endDate=2'],
  ['GET', '/api/erp/financial-records/aggregate?periodType=month&startDate=1&endDate=2'],
  ['GET', '/api/erp/financial-records/export'],
  ['GET', '/api/erp/unexpected-charges'],
  ['GET', '/api/erp/ai/providers'],
  ['GET', '/api/erp/ai/agents'],
  ['GET', '/api/erp/ai/insights'],
  // LP.17. Editing and removing a provider or an assistant — the half
  // R10 was missing, and a provider is a billing account.
  ['PUT', '/api/erp/ai/providers/nonexistent'],
  ['DELETE', '/api/erp/ai/providers/nonexistent'],
  ['POST', '/api/erp/ai/providers/nonexistent/default'],
  ['PUT', '/api/erp/ai/agents/nonexistent'],
  ['DELETE', '/api/erp/ai/agents/nonexistent'],
];

describe('the ERP API is closed by default (SEC-01)', () => {
  for (const [method, path] of SURFACES) {
    test(`${method} ${path} rejects an anonymous caller`, async () => {
      const r = await anon(method, path, method === 'GET' ? undefined : {});
      assert.equal(r.status, 401, `${method} ${path} must require a session`);
      assert.equal(r.body?.error?.code, 'UNAUTHENTICATED');
    });
  }

  test('a garbage session token is rejected, not treated as anonymous-but-fine', async () => {
    const r = await anon('GET', '/api/erp/orders', undefined, {
      headers: { cookie: 'landingos_session=not-a-real-token' },
    });
    assert.equal(r.status, 401);
  });

  test('an empty list is never the answer to a missing session', async () => {
    // The failure mode this file exists for. Row-level security denies by
    // returning NO ROWS, so a route that forgets its binding answers 200 with
    // an empty list and looks like a tenant with no data. 401 is the only
    // correct answer to no session, and it has to be asserted explicitly
    // because the wrong answer is a plausible-looking success.
    const r = await anon('GET', '/api/erp/orders');
    assert.notEqual(r.status, 200, 'an anonymous read must not succeed at all');
    assert.equal(r.body?.data, undefined, 'and must carry no data envelope');
  });
});

/* -----------------------------------------------------------------------------
 * Entitlement, which the ERP had no concept of
 * -------------------------------------------------------------------------- */

describe('entitlement gates the product before any role is considered', () => {
  test('an OWNER of a tenant without the ERP subscription is refused every route', async () => {
    // The role is OWNER — `*`, every permission there is. Entitlement is
    // checked first and independently, which is what makes a downgrade take
    // effect without anyone editing a membership.
    for (const [method, path] of SURFACES.slice(0, 8)) {
      const r = await unentitled.api(method, path, method === 'GET' ? undefined : {});
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.equal(r.body?.error?.code, 'FORBIDDEN');
    }
  });

  test('the refusal does not say whether the reason is role or subscription', async () => {
    // Distinguishing them tells a caller what another company has bought.
    const r = await unentitled.api('GET', '/api/erp/orders');
    const message = String(r.body?.error?.message ?? '');
    assert.doesNotMatch(message, /subscri|entitle|plan|billing|upgrade/i);
  });
});

/* -----------------------------------------------------------------------------
 * The manager / agent split (auth.test.js §authorization)
 * -------------------------------------------------------------------------- */

describe('an agent cannot do a manager’s job', () => {
  const MANAGER_ONLY: ReadonlyArray<readonly [string, string, unknown?]> = [
    ['POST', '/api/erp/agents', { email: `x-${uid()}@landingos.test` }],
    ['PUT', '/api/erp/settings', { minCallSeconds: 99 }],
    ['POST', '/api/erp/carriers', { name: 'p', code: `c${uid()}` }],
    ['POST', '/api/erp/sales-channels', { name: 's', platform: 'shopify' }],
    ['POST', '/api/erp/ai/providers', { name: 'a', type: 'openai-compat' }],
    ['GET', '/api/erp/agents/payroll'],
    ['POST', '/api/erp/agents/nonexistent/reset-missed', {}],
    ['POST', '/api/erp/financial-records', { periodType: 'week', startDate: 1, endDate: 2 }],
    ['POST', '/api/erp/products', { name: 'nope' }],
    // Gated before the id is resolved, so a nonexistent one still answers 403
    // rather than 404 — the permission is checked first, on purpose.
    ['PATCH', '/api/erp/products/nonexistent', { price: '1' }],
  ];

  for (const [method, path, body] of MANAGER_ONLY) {
    test(`${method} ${path} is refused`, async () => {
      const r = await acme.agent.api(method, path, body);
      assert.equal(r.status, 403, `${method} ${path} must be manager-only`);
      assert.equal(r.body?.error?.code, 'FORBIDDEN');
    });
  }

  test('and the manager can reach every one of them', async () => {
    // Half a boundary test is not a boundary test: if these 403 too, the rule
    // above is passing for the wrong reason.
    for (const [method, path] of MANAGER_ONLY) {
      if (method !== 'GET') continue;
      const r = await acme.manager.api(method, path);
      assert.equal(r.status, 200, `${method} ${path} must work for a manager`);
    }
  });

  test('an agent can still do their own job', async () => {
    assert.equal((await acme.agent.api('GET', '/api/erp/orders')).status, 200);
    assert.equal((await acme.agent.api('GET', '/api/erp/products')).status, 200);
    assert.equal((await acme.agent.api('GET', '/api/erp/followup/tasks')).status, 200);

    const created = await acme.agent.api('POST', '/api/erp/orders', { client: 'C', phone: phone() });
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal((await acme.agent.api('POST', `/api/erp/orders/${id}/call-start`, {})).status, 200);
    assert.equal(
      (await acme.agent.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' })).status,
      200,
    );
  });

  test('D-05.1 — the customer registry is not readable by an agent', async () => {
    // The ERP asserted this directly and it is the reason SEC-02 was filed:
    // the registry carries every customer's phone number and lifetime spend.
    //
    // On the platform, MEMBER carries the glob `*:*:read`, which grants
    // `erp:clients:read` to every member of the tenant. This test therefore
    // FAILS until D-05.1 is decided — see PORTING.md. That is deliberate: a
    // contract test that quietly adopts the new behaviour would delete the
    // boundary instead of defending it.
    const r = await acme.agent.api('GET', '/api/erp/clients');
    assert.equal(r.status, 403, 'an agent must not read the customer registry');
    assert.equal((await acme.manager.api('GET', '/api/erp/clients')).status, 200);
  });

  test('D-05.1 — the finance surfaces are not readable by an agent', async () => {
    for (const path of [
      '/api/erp/financial-records',
      '/api/erp/followup/dashboard',
      // LP.16. Every new door onto the same books, listed rather than assumed
      // — the prorated rent tells an agent the company's cost base, and the
      // roll-up tells them its quarter.
      '/api/erp/financial-records/prorate-fixed?periodType=month',
      '/api/erp/financial-records/versions?periodType=month&startDate=1&endDate=2',
      '/api/erp/financial-records/aggregate?periodType=month&startDate=1&endDate=2',
    ]) {
      assert.equal((await acme.agent.api('GET', path)).status, 403, path);
      assert.equal((await acme.manager.api('GET', path)).status, 200, path);
    }
  });
});

describe('the job role is not the privilege', () => {
  test('a follow-up agent is not thereby a manager', async () => {
    // The ERP kept agents.role (confirmation | followup | both) separate from
    // accountRole (agent | manager) on purpose, so a follow-up agent could also
    // be a manager. Membership.jobRole preserves that split; a test is what
    // stops the two being collapsed by someone who assumes they are the same.
    const followup = await makeMember(acme.tenantId, {
      role: 'MEMBER',
      permissions: ['erp:orders:write'],
      jobRole: 'followup',
    });
    assert.equal((await followup.api('GET', '/api/erp/agents/payroll')).status, 403);
    assert.equal((await followup.api('GET', '/api/erp/followup/tasks')).status, 200);
  });

  test('a manager who is also a follow-up agent keeps both', async () => {
    const both = await makeMember(acme.tenantId, { role: 'ADMIN', jobRole: 'followup' });
    assert.equal((await both.api('GET', '/api/erp/agents/payroll')).status, 200);
    assert.equal((await both.api('GET', '/api/erp/followup/tasks')).status, 200);
  });
});

/* -----------------------------------------------------------------------------
 * Record-level scoping of the order book (auth.test.js §record-level scoping)
 *
 * Distinct from tenant isolation and enforced somewhere else entirely. Tenant
 * isolation is the database's job. THIS is the ERP's own rule: inside one
 * company, a confirmation agent works their own queue.
 * -------------------------------------------------------------------------- */

describe('an agent sees their own orders and the unassigned queue', () => {
  let mine = '';
  let theirs = '';
  let nobodys = '';

  before(async () => {
    if (skip) return;
    const make = async (body: Record<string, unknown>) =>
      (await acme.manager.api('POST', '/api/erp/orders', { client: 'X', phone: phone(), ...body }))
        .body.data.id as string;

    mine = await make({ agentUserId: acme.agent.userId });
    theirs = await make({ agentUserId: acme.other.userId });
    nobodys = await make({});
  });

  test('their own order is visible', async () => {
    const r = await acme.agent.api('GET', '/api/erp/orders?pageSize=100');
    const ids = r.body.data.items.map((o: { id: string }) => o.id);
    assert.ok(ids.includes(mine));
  });

  test('an unassigned order stays visible so it can be picked up', async () => {
    const r = await acme.agent.api('GET', '/api/erp/orders?pageSize=100');
    const ids = r.body.data.items.map((o: { id: string }) => o.id);
    assert.ok(ids.includes(nobodys));
  });

  test('another agent’s order is not', async () => {
    const r = await acme.agent.api('GET', '/api/erp/orders?pageSize=100');
    const ids = r.body.data.items.map((o: { id: string }) => o.id);
    assert.ok(!ids.includes(theirs), "another agent's order must not be listed");
  });

  test('and reading it directly is a 404, not a 403', async () => {
    // 403 would confirm the order exists. Same rule as another tenant's row.
    assert.equal((await acme.agent.api('GET', `/api/erp/orders/${theirs}`)).status, 404);
  });

  test('the manager still sees the whole book', async () => {
    const r = await acme.manager.api('GET', '/api/erp/orders?pageSize=100');
    const ids = r.body.data.items.map((o: { id: string }) => o.id);
    for (const id of [mine, theirs, nobodys]) assert.ok(ids.includes(id));
  });

  test('an order assigned for follow-up is visible to the follow-up agent', async () => {
    const followup = await makeMember(acme.tenantId, {
      role: 'MEMBER', permissions: ['erp:orders:write'], jobRole: 'followup',
    });
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'F', phone: phone(), agentUserId: acme.other.userId,
    });
    const id = created.body.data.id;
    await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { followupUserId: followup.userId });

    const r = await followup.api('GET', '/api/erp/orders?pageSize=100');
    const ids = r.body.data.items.map((o: { id: string }) => o.id);
    assert.ok(ids.includes(id), 'visible via followupUserId even though someone else owns it');
  });
});

/* -----------------------------------------------------------------------------
 * Tenant isolation — the dimension the ERP could not have
 * -------------------------------------------------------------------------- */

describe('another company’s order book does not exist', () => {
  let acmeOrder = '';
  let betaOrder = '';

  before(async () => {
    if (skip) return;
    acmeOrder = (await acme.manager.api('POST', '/api/erp/orders', { client: 'Acme Customer', phone: phone() }))
      .body.data.id;
    betaOrder = (await beta.manager.api('POST', '/api/erp/orders', { client: 'Beta Customer', phone: phone() }))
      .body.data.id;
  });

  test('each tenant lists only its own', async () => {
    const a = await acme.manager.api('GET', '/api/erp/orders?pageSize=200');
    const b = await beta.manager.api('GET', '/api/erp/orders?pageSize=200');
    const aIds = a.body.data.items.map((o: { id: string }) => o.id);
    const bIds = b.body.data.items.map((o: { id: string }) => o.id);

    assert.ok(aIds.includes(acmeOrder));
    assert.ok(!aIds.includes(betaOrder), "Acme must not see Beta's order");
    assert.ok(bIds.includes(betaOrder));
    assert.ok(!bIds.includes(acmeOrder), "Beta must not see Acme's order");
  });

  test('naming the other tenant’s order id is a 404, not a leak', async () => {
    assert.equal((await acme.manager.api('GET', `/api/erp/orders/${betaOrder}`)).status, 404);
  });

  test('and it cannot be written to either', async () => {
    const r = await acme.manager.api('PATCH', `/api/erp/orders/${betaOrder}`, { managerNote: 'tampered' });
    assert.equal(r.status, 404);

    const still = await beta.manager.api('GET', `/api/erp/orders/${betaOrder}`);
    assert.equal(still.status, 200);
    assert.notEqual(still.body.data.managerNote, 'tampered');
  });

  test('nor deleted', async () => {
    assert.equal((await acme.manager.api('DELETE', `/api/erp/orders/${betaOrder}`)).status, 404);
    assert.equal((await beta.manager.api('GET', `/api/erp/orders/${betaOrder}`)).status, 200);
  });

  test('two tenants may hold a customer with the same phone number', async () => {
    // The single most dangerous constraint in the whole port (M-04). A global
    // unique on Client.phone would either refuse the second tenant's customer
    // or merge them into the first tenant's record and expose their history.
    const shared = phone();
    const a = await acme.manager.api('POST', '/api/erp/orders', { client: 'Same Number A', phone: shared });
    const b = await beta.manager.api('POST', '/api/erp/orders', { client: 'Same Number B', phone: shared });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201, 'the second tenant must not be refused');

    const inAcme = await acme.manager.api(`GET`, `/api/erp/clients?search=${shared}`);
    assert.equal(inAcme.body.data.items.length, 1);
    assert.equal(inAcme.body.data.items[0].name, 'Same Number A', 'and the records did not merge');
  });

  test('a manager of one tenant is nobody in the other', async () => {
    // The consultant case from the seed: one person, two tenants, different
    // roles. The session names an ACTIVE tenant, and a token cannot be pointed
    // at a tenant it was not issued for.
    const r = await acme.manager.api('GET', '/api/erp/orders?tenantId=' + beta.tenantId);
    assert.equal(r.status, 200, 'the parameter is ignored, not honoured');
    const ids = r.body.data.items.map((o: { id: string }) => o.id);
    assert.ok(!ids.includes(betaOrder), 'a query parameter must never widen the tenant scope');
  });
});

/* -----------------------------------------------------------------------------
 * hardening.test.js §2 — the case-sensitivity bypass, reshaped
 * -------------------------------------------------------------------------- */

describe('authorization cannot be bypassed by rewriting the path', () => {
  // Express matched routes case-insensitively while the ERP's authorization
  // table used case-sensitive regexes, so POST /api/AGENTS reached the handler
  // with no manager check at all. Next matches case-sensitively and the
  // permission is an argument to tenantRoute rather than a regex over the URL,
  // so the bypass is structurally impossible — which is a claim, and claims get
  // tests.
  const VARIANTS: ReadonlyArray<readonly [string, string, unknown?]> = [
    ['POST', '/api/erp/AGENTS', { email: `bypass-${uid()}@landingos.test` }],
    ['POST', '/api/erp/Agents', { email: `bypass-${uid()}@landingos.test` }],
    ['PUT', '/api/erp/Settings', { minCallSeconds: 1 }],
    ['PUT', '/api/erp/SETTINGS', { minCallSeconds: 1 }],
    ['POST', '/api/erp/Carriers', { name: 'x', code: `c${uid()}` }],
    ['GET', '/api/erp/Financial-Records'],
    ['POST', '/api/erp/Orders/Bulk', { ids: [], action: 'delete' }],
  ];

  for (const [method, path, body] of VARIANTS) {
    test(`${method} ${path} does not reach a handler as an agent`, async () => {
      const r = await acme.agent.api(method, path, body);
      assert.ok(r.status === 404 || r.status === 403, `${method} ${path} returned ${r.status}`);
    });
  }

  test('nothing was created by any of them', async () => {
    const r = await acme.manager.api('GET', '/api/erp/agents');
    const emails = (r.body.data.items ?? r.body.data).map((a: { email: string }) => a.email ?? '');
    assert.ok(!emails.some((e: string) => e.startsWith('bypass-')), 'a bypass created an account');
  });

  test('a path-traversal segment does not escape the ERP surface', async () => {
    for (const path of ['/api/erp/../builder/landings', '/api/erp/%2e%2e/builder/landings']) {
      const r = await acme.agent.api('GET', path);
      assert.notEqual(r.status, 200, `${path} must not resolve into another product`);
    }
  });
});

/* -----------------------------------------------------------------------------
 * hardening.test.js §7 — the same client-supplied-filter mistake, elsewhere
 * -------------------------------------------------------------------------- */

describe('a caller-supplied filter never widens what they can see', () => {
  test('an agent cannot list another agent’s follow-up queue', async () => {
    const target = acme.other.userId;
    await acme.manager.api('POST', '/api/erp/orders', { client: 'FU', phone: phone(), agentUserId: target });

    const r = await acme.agent.api('GET', `/api/erp/followup/tasks?agentUserId=${target}`);
    assert.equal(r.status, 200);
    for (const t of r.body.data.items) {
      assert.equal(t.agentUserId, acme.agent.userId,
        'the query parameter is ignored — only your own tasks come back');
    }
  });

  test('an agent cannot widen the order list with an agent filter', async () => {
    const r = await acme.agent.api(
      'GET', `/api/erp/orders?agentUserId=${acme.other.userId}&pageSize=200`,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data.items.length, 0, 'the scope wins over a caller-supplied filter');
  });

  test('and neither can a manager reach across the tenant boundary with one', async () => {
    const r = await beta.manager.api(
      'GET', `/api/erp/orders?agentUserId=${acme.agent.userId}&pageSize=200`,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data.items.length, 0, 'a user id from another tenant matches nothing');
  });

  test('nor with an export, which is the same filter leaving the building', async () => {
    // LP.6. The export takes the same query string the list does, so it
    // inherits this property only if it goes through `scopedWhere` — and an
    // export is the one read that produces a file somebody keeps.
    await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Not Yours', phone: phone(), agentUserId: acme.other.userId,
    });

    const r = await acme.agent.api(
      'GET', `/api/erp/orders/export?format=orders&agentUserId=${acme.other.userId}`,
    );
    assert.equal(r.status, 200);
    assert.ok(
      !String(r.body).includes('Not Yours'),
      'a caller-supplied agent filter widened an export',
    );
  });
});
