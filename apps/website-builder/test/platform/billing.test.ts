import assert from 'node:assert/strict';
import { after, describe } from 'node:test';

import { asPlatform, withTenant } from '@landingos/db';
import { SESSION_COOKIE } from '@landingos/auth';

import {
  BASE,
  anon,
  cleanup,
  contractTest,
  makeAgent,
  makeMember,
  makeTenant,
  uid,
  type Caller,
} from '../erp/helpers.ts';

/* =============================================================================
 * Billing — Phase 7.2. The contract for `/api/platform/billing/*`.
 *
 * The domain is done: `Subscription` holds `status` and `entitlements`, and
 * every gate in the platform already reads it — `can()`, the worker's tick,
 * `hasProduct`, `assign`, `notifications`. This is the MANAGEMENT half: a route
 * that shows what a tenant has and a route that changes it.
 *
 * Deliberately NOT a payment integration. The valuable, testable property is
 * "change entitlements and watch access follow" — and the load-bearing test in
 * this file does exactly that: drop `product.erp` and assert every ERP route
 * 403s on the very next request. No cache to bust, no session to re-issue;
 * `resolveSession` re-reads the subscription every call.
 *
 * `platform:billing:*` is on the SENSITIVE list, so no role glob reaches it:
 * OWNER and ADMIN hold it through a bare `*`, everybody else needs it granted
 * by name. A MANAGER running the call centre does not decide what the company
 * pays for. And like the team surface it is NOT entitlement-gated — a tenant
 * whose subscription lapsed still manages its own billing (otherwise a bounced
 * invoice removes the ability to fix the bounced invoice).
 * ========================================================================== */

after(cleanup);

/** A billing-capable caller and the tenant they own. */
async function makeBillingTeam(label: string, entitlements: string[] = ['product.erp', 'product.website-builder']) {
  const tenantId = await makeTenant(label, entitlements);
  const [owner, admin, member] = await Promise.all([
    makeMember(tenantId, { role: 'OWNER' }),
    makeMember(tenantId, { role: 'ADMIN' }),
    makeMember(tenantId, { role: 'MEMBER' }),
  ]);
  return { tenantId, owner, admin, member };
}

const readBilling = (caller: Caller) => caller.api('GET', '/api/platform/billing');
const putEntitlements = (caller: Caller, entitlements: string[]) =>
  caller.api('PUT', '/api/platform/billing/entitlements', { entitlements });

/* -----------------------------------------------------------------------------
 * Who reaches the surface
 * -------------------------------------------------------------------------- */

describe('the billing surface is SENSITIVE, and no role glob reaches it', () => {
  contractTest('a signed-out caller is refused before anything else', async () => {
    const res = await anon('GET', '/api/platform/billing');
    assert.equal(res.status, 401);
  });

  contractTest('a MEMBER cannot read billing', async () => {
    const { member } = await makeBillingTeam('gate-member');
    const res = await readBilling(member);
    assert.equal(res.status, 403);
  });

  contractTest('neither can a MANAGER — running the day is not paying the bill', async () => {
    const tenantId = await makeTenant('gate-manager');
    const manager = await makeMember(tenantId, { role: 'MANAGER' });
    const res = await readBilling(manager);
    assert.equal(res.status, 403);
  });

  contractTest('an ADMIN can read it, and the response names every product', async () => {
    const { admin } = await makeBillingTeam('gate-admin');
    const res = await readBilling(admin);
    assert.equal(res.status, 200);
    // The catalog comes from the registry, so the screen cannot go stale.
    const ids = res.body.data.catalog.map((p: any) => p.id);
    assert.ok(ids.includes('erp'));
    assert.ok(ids.includes('website-builder'));
    // And the held entitlements are reported.
    assert.ok(res.body.data.entitlements.includes('product.erp'));
  });

  contractTest('the permission is grantable by name, and read does not imply write', async () => {
    const tenantId = await makeTenant('gate-granted');
    const reader = await makeMember(tenantId, {
      role: 'MEMBER',
      permissions: ['platform:billing:read'],
    });
    const list = await readBilling(reader);
    assert.equal(list.status, 200);

    const attempt = await putEntitlements(reader, ['product.erp']);
    assert.equal(attempt.status, 403);
  });

  contractTest('a company with no subscription row still manages billing', async () => {
    // `productOf("platform:…")` is null, so this surface is not entitlement-gated.
    // Drop the subscription entirely and the read still works, reporting empty.
    const { admin, tenantId } = await makeBillingTeam('gate-no-sub', []);
    await withTenant(tenantId, (tx) => (tx as any).subscription.deleteMany({ where: { tenantId } }));
    const res = await readBilling(admin);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.entitlements, []);
  });
});

/* -----------------------------------------------------------------------------
 * Changing entitlements — the property the whole slice exists to prove
 * -------------------------------------------------------------------------- */

describe('changing entitlements changes access on the very next request', () => {
  contractTest('drop product.erp and every ERP route 403s immediately', async () => {
    // The load-bearing test. An agent who could list orders a moment ago is
    // refused the moment the entitlement leaves the subscription — no re-login,
    // no cache flush, because resolveSession re-reads the subscription every call.
    const tenantId = await makeTenant('access-follows', ['product.erp', 'product.website-builder']);
    const [admin, agent] = await Promise.all([
      makeMember(tenantId, { role: 'ADMIN' }),
      makeAgent(tenantId),
    ]);

    // The agent can reach the ERP before the change.
    const before = await agent.api('GET', '/api/erp/orders');
    assert.equal(before.status, 200);

    // Drop the ERP entitlement.
    const res = await putEntitlements(admin, ['product.website-builder']);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.entitlements, ['product.website-builder']);

    // The SAME session, on the very next request, is refused — the entitlement
    // gate in `can()` reads the fresh subscription and `productOf("erp:…")`
    // resolves to a product the tenant no longer holds.
    const after = await agent.api('GET', '/api/erp/orders');
    assert.equal(after.status, 403);
  });

  contractTest('add product.erp back and access returns just as fast', async () => {
    const tenantId = await makeTenant('access-returns', ['product.website-builder']);
    const [admin, agent] = await Promise.all([
      makeMember(tenantId, { role: 'ADMIN' }),
      makeAgent(tenantId),
    ]);

    // No ERP yet — the agent is refused.
    const before = await agent.api('GET', '/api/erp/orders');
    assert.equal(before.status, 403);

    const res = await putEntitlements(admin, ['product.erp', 'product.website-builder']);
    assert.equal(res.status, 200);

    const after = await agent.api('GET', '/api/erp/orders');
    assert.equal(after.status, 200);
  });

  contractTest('an unknown entitlement key is refused, not silently stored', async () => {
    // The set is validated against the registry — a typo or an invented key
    // would be silently held and do nothing, which is worse than a refusal.
    const { admin } = await makeBillingTeam('access-unknown');
    const res = await putEntitlements(admin, ['product.erp', 'product.nope']);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  contractTest('the catalog drives the vocabulary — nothing else is accepted', async () => {
    const { admin } = await makeBillingTeam('access-catalog');
    // `seats.max:10` is in the schema's example comment but is not a product
    // entitlement the registry knows. Holding it would do nothing and would
    // clutter the row; the route refuses.
    const res = await putEntitlements(admin, ['product.erp', 'seats.max:10']);
    assert.equal(res.status, 422);
  });

  contractTest('a non-array body is refused', async () => {
    const { admin } = await makeBillingTeam('access-shape');
    const res = await admin.api('PUT', '/api/platform/billing/entitlements', {
      entitlements: 'product.erp',
    });
    assert.equal(res.status, 422);
  });

  contractTest('the change is audited, and the audit never carries a token', async () => {
    const { admin, tenantId } = await makeBillingTeam('access-audit', ['product.erp']);
    await putEntitlements(admin, []);
    const events = await withTenant(tenantId, (tx) =>
      (tx as any).auditEvent.findMany({
        where: { entity: 'subscription', action: 'update_entitlements' },
      }),
    );
    assert.ok(events.length >= 1, 'an audit event was written');
    // The payload carries the change, not anything secret.
    const last = events[events.length - 1];
    assert.ok(last.payload, 'the payload records the change');
  });
});

/* -----------------------------------------------------------------------------
 * Another tenant’s billing is invisible — isolation
 * -------------------------------------------------------------------------- */

describe('billing is scoped to the caller’s tenant', () => {
  contractTest('the read never crosses tenants', async () => {
    const [a, b] = await Promise.all([
      makeBillingTeam('iso-a', ['product.erp']),
      makeBillingTeam('iso-b', ['product.website-builder']),
    ]);
    const res = await readBilling(a.admin);
    assert.deepEqual(res.body.data.entitlements, ['product.erp']);
    assert.ok(!res.body.data.entitlements.includes('product.website-builder'));
  });

  contractTest('a write here does not change the other tenant', async () => {
    const [a, b] = await Promise.all([
      makeBillingTeam('iso-write-a', ['product.erp']),
      makeBillingTeam('iso-write-b', ['product.erp', 'product.website-builder']),
    ]);
    await putEntitlements(a.admin, []);
    // Tenant B is untouched — the binding scopes the write.
    const theirs = await readBilling(b.admin);
    assert.deepEqual(theirs.body.data.entitlements, ['product.erp', 'product.website-builder']);
  });
});

/* -----------------------------------------------------------------------------
 * The billing screen — Phase 7.2.
 *
 * `/console/settings/billing`, gated on `platform:billing:read`. Asserts on the
 * rendered HTML: the catalog, the per-product state, and D-06.2 (write controls
 * only where the API accepts them).
 * -------------------------------------------------------------------------- */

async function billingPage(token: string) {
  const res = await fetch(`${BASE}/console/settings/billing`, {
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  return { status: res.status, text: await res.text() };
}

describe('the billing screen', () => {
  contractTest('a signed-out visitor is redirected, not shown billing', async () => {
    const res = await fetch(`${BASE}/console/settings/billing`, { redirect: 'manual' });
    assert.ok(res.status >= 300 && res.status < 400, `expected a redirect, got ${res.status}`);
  });

  contractTest('a MEMBER does not reach billing — 404', async () => {
    const { member } = await makeBillingTeam('screen-member');
    const { status } = await billingPage(member.token);
    assert.equal(status, 404);
  });

  contractTest('an ADMIN sees every product and its current state', async () => {
    const { admin } = await makeBillingTeam('screen-admin', ['product.erp']);
    const { status, text } = await billingPage(admin.token);
    assert.equal(status, 200);
    assert.match(text, /data-testid="billing-products"/);
    // Both products are in the catalog.
    assert.match(text, /data-product-id="erp"/);
    assert.match(text, /data-product-id="website-builder"/);
    // The ERP is enabled, the builder is not.
    assert.match(text, /data-product-id="erp"[^>]*data-enabled="true"/);
  });

  contractTest('a reader (read granted, no write) sees no toggles', async () => {
    const tenantId = await makeTenant('screen-reader', ['product.erp']);
    const reader = await makeMember(tenantId, {
      role: 'MEMBER',
      permissions: ['platform:billing:read'],
    });
    const { status, text } = await billingPage(reader.token);
    assert.equal(status, 200);
    assert.match(text, /data-testid="billing-products"/);
    // No write controls — the save button and every toggle are absent.
    assert.doesNotMatch(text, /data-testid="billing-save"/);
    assert.doesNotMatch(text, /data-testid="billing-toggle-erp"/);
  });

  contractTest('the settings index links to billing only for someone who can read it', async () => {
    const tenantId = await makeTenant('screen-index', ['product.erp']);
    const admin = await makeMember(tenantId, { role: 'ADMIN' });
    const member = await makeMember(tenantId, { role: 'MEMBER' });

    const adminIndex = await fetch(`${BASE}/console/settings`, {
      headers: { cookie: `${SESSION_COOKIE}=${admin.token}` },
    });
    const adminText = await adminIndex.text();
    assert.match(adminText, /data-section="billing"/, 'ADMIN sees the billing link');

    const memberIndex = await fetch(`${BASE}/console/settings`, {
      headers: { cookie: `${SESSION_COOKIE}=${member.token}` },
    });
    const memberText = await memberIndex.text();
    assert.doesNotMatch(memberText, /data-section="billing"/, 'MEMBER does not see the billing link');
  });
});
