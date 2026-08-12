import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

/* =============================================================================
 * The ported builder API, end to end.
 *
 * These routes no longer filter by tenant themselves — the binding is applied
 * by the route wrapper and enforced by row-level security. That is a stronger
 * guarantee than a WHERE clause, and it is worth proving rather than assuming,
 * because the failure mode of a missing binding is an EMPTY response rather
 * than an error.
 *
 * Every assertion below is about a boundary: another tenant's data, a role
 * without the permission, or a tenant without the subscription.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);

const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);

const stamp = Date.now();
const userIds: string[] = [];
const tokens: Record<string, string> = {};
let tenantA = '';
let tenantB = '';
let tenantErpOnly = '';
let pageA = '';
let pageB = '';

async function api(path: string, token?: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function makeTenant(slug: string, entitlements: string[]) {
  const t = await asPlatform().tenant.create({ data: { slug, name: slug } });
  await withTenant(t.id, (tx) =>
    (tx as any).subscription.create({ data: { tenantId: t.id, status: 'ACTIVE', entitlements } }),
  );
  return t.id;
}

async function makeUser(tenantId: string, role: string, label: string) {
  const email = `api-${label}-${stamp}@landingos.test`;
  const u = await asPlatform().user.create({
    data: { email, name: email, passwordHash: await hashPassword('x') },
  });
  userIds.push(u.id);
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({ data: { tenantId, userId: u.id, role } }),
  );
  const { token } = await createSession(u.id, tenantId);
  tokens[label] = token;
  return u.id;
}

before(async () => {
  if (!HAS_DB || !serverUp) return;

  tenantA = await makeTenant(`api-a-${stamp}`, ['product.website-builder']);
  tenantB = await makeTenant(`api-b-${stamp}`, ['product.website-builder']);
  tenantErpOnly = await makeTenant(`api-erp-${stamp}`, ['product.erp']);

  await makeUser(tenantA, 'OWNER', 'ownerA');
  await makeUser(tenantA, 'VIEWER', 'viewerA');
  await makeUser(tenantA, 'MEMBER', 'memberA');
  await makeUser(tenantA, 'MANAGER', 'managerA');
  await makeUser(tenantB, 'OWNER', 'ownerB');
  await makeUser(tenantErpOnly, 'OWNER', 'erpOwner');

  // Deliberately the SAME slug in both tenants — per-tenant uniqueness (M-04)
  // is what makes that legal, and it is the case a global constraint broke.
  for (const [tenant, ref] of [[tenantA, 'A'], [tenantB, 'B']] as const) {
    const created = await withTenant(tenant, (tx) =>
      (tx as any).landingPage.create({
        data: { tenantId: tenant, title: `Page ${ref}`, slug: 'shared-product', price: 4900 },
        select: { id: true },
      }),
    );
    if (ref === 'A') pageA = created.id; else pageB = created.id;
  }
});

after(async () => {
  if (!HAS_DB || !serverUp) return;
  for (const id of userIds) {
    await destroySessionsForUser(id);
    for (const t of [tenantA, tenantB, tenantErpOnly]) {
      await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId: id } }));
    }
    await asPlatform().user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [tenantA, tenantB, tenantErpOnly].filter(Boolean)) {
    await deleteTenant(id).catch(() => {});
  }
  await disconnect();
});

const skip = !HAS_DB || !serverUp;

describe('the ported routes refuse anonymous callers', { skip }, () => {
  test('no session is 401, not 500 and not an empty list', async () => {
    for (const path of ['/api/builder/landings', '/api/builder/categories', '/api/builder/orders']) {
      const r = await api(path);
      assert.equal(r.status, 401, path);
      assert.equal(r.body?.error?.code, 'UNAUTHENTICATED');
    }
  });
});

describe('tenant isolation holds without a single WHERE clause', { skip }, () => {
  test('each tenant lists only its own pages', async () => {
    const a = await api('/api/builder/landings', tokens.ownerA);
    const b = await api('/api/builder/landings', tokens.ownerB);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.data.total, 1);
    assert.equal(b.body.data.total, 1);
    assert.equal(a.body.data.items[0].title, 'Page A');
    assert.equal(b.body.data.items[0].title, 'Page B');
  });

  test("another tenant's page id is a 404, not a leak", async () => {
    // 404 rather than 403 on purpose: confirming the row exists elsewhere is
    // itself information.
    const r = await api(`/api/builder/landings/${pageB}`, tokens.ownerA);
    assert.equal(r.status, 404);
  });

  test("another tenant's page cannot be deleted", async () => {
    const r = await api(`/api/builder/landings/${pageB}`, tokens.ownerA, { method: 'DELETE' });
    assert.equal(r.status, 404);

    // And it is still there afterwards.
    const still = await api(`/api/builder/landings/${pageB}`, tokens.ownerB);
    assert.equal(still.status, 200);
  });

  test('two tenants may hold the same slug', async () => {
    // The constraint was global before M-04, which meant the first customer to
    // claim a good slug claimed it for everyone.
    const a = await api('/api/builder/landings', tokens.ownerA);
    const b = await api('/api/builder/landings', tokens.ownerB);
    assert.equal(a.body.data.items[0].slug, 'shared-product');
    assert.equal(b.body.data.items[0].slug, 'shared-product');
  });

  test('a slug already used INSIDE the tenant is still refused', async () => {
    const r = await api('/api/builder/landings', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({ title: 'Duplicate', slug: 'shared-product', price: 100 }),
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'SLUG_TAKEN');
  });
});

describe('permissions gate writes, not just reads', { skip }, () => {
  test('a viewer can read', async () => {
    const r = await api('/api/builder/landings', tokens.viewerA);
    assert.equal(r.status, 200);
  });

  test('a viewer cannot create', async () => {
    const r = await api('/api/builder/landings', tokens.viewerA, {
      method: 'POST',
      body: JSON.stringify({ title: 'Nope', slug: 'nope', price: 1 }),
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'FORBIDDEN');
  });

  test('a viewer cannot delete', async () => {
    const r = await api(`/api/builder/landings/${pageA}`, tokens.viewerA, { method: 'DELETE' });
    assert.equal(r.status, 403);
  });

  test('an owner can create, and it lands in their tenant', async () => {
    const created = await api('/api/builder/landings', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({ title: 'Made by owner', slug: `made-${stamp}`, price: 1500 }),
    });
    assert.equal(created.status, 201);

    const mine = await api('/api/builder/landings', tokens.ownerA);
    assert.equal(mine.body.data.total, 2);

    const theirs = await api('/api/builder/landings', tokens.ownerB);
    assert.equal(theirs.body.data.total, 1, "the other tenant must not see it");
  });
});

describe('the order lifecycle write is gated on orders:write (LB.10)', { skip }, () => {
  test('reading orders does not buy the right to advance one', async () => {
    // Audit B-08: the status route was gated on orders:read, so anybody who
    // could SEE the order list could confirm an order. The write now requires
    // website-builder:orders:write — MANAGER's *:*:write glob grants it;
    // MEMBER and VIEWER read only.
    const orderId = (await withTenant(tenantA, (tx) =>
      (tx as any).salesOrder.create({
        data: {
          tenantId: tenantA, landingPageId: pageA, customerName: 'Gate Buyer',
          phone: '0555010101', wilaya: 'Alger', baladia: 'Centre', address: '',
          quantity: 1, productPrice: 4900, shippingPrice: 400, totalPrice: 5300,
        },
        select: { id: true },
      }),
    )).id;

    const read = await api('/api/builder/orders', tokens.memberA);
    assert.equal(read.status, 200, 'a member still reads the order list');

    const asMember = await api(`/api/builder/orders/${orderId}/status`, tokens.memberA, {
      method: 'PATCH', body: JSON.stringify({ toStatus: 'CONFIRMED' }),
    });
    assert.equal(asMember.status, 403, 'a member cannot advance an order');

    const asViewer = await api(`/api/builder/orders/${orderId}/status`, tokens.viewerA, {
      method: 'PATCH', body: JSON.stringify({ toStatus: 'CONFIRMED' }),
    });
    assert.equal(asViewer.status, 403, 'a viewer cannot advance an order');

    const asManager = await api(`/api/builder/orders/${orderId}/status`, tokens.managerA, {
      method: 'PATCH', body: JSON.stringify({ toStatus: 'CONFIRMED' }),
    });
    assert.equal(asManager.status, 200, JSON.stringify(asManager.body));
    assert.equal(asManager.body.data.status, 'CONFIRMED');
  });
});

describe('entitlement gates the whole product', { skip }, () => {
  test('a tenant without the builder subscription is refused every route', async () => {
    // The role is OWNER. Entitlement is checked first and independently, which
    // is what makes a downgrade take effect without editing anybody's role.
    for (const path of ['/api/builder/landings', '/api/builder/categories', '/api/builder/orders']) {
      const r = await api(path, tokens.erpOwner);
      assert.equal(r.status, 403, path);
      assert.equal(r.body.error.code, 'FORBIDDEN');
    }
  });
});

describe('input is validated and pagination is bounded', { skip }, () => {
  test('a malformed slug is rejected with a usable message', async () => {
    const r = await api('/api/builder/landings', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({ title: 'Bad', slug: 'Not A Slug!', price: 10 }),
    });
    assert.equal(r.status, 422);
    assert.match(r.body.error.message, /hyphen|lowercase/i);
  });

  test('a missing body does not crash the route', async () => {
    const r = await api('/api/builder/landings', tokens.ownerA, { method: 'POST', body: '' });
    assert.equal(r.status, 422);
  });

  test('an absurd page size is clamped rather than honoured', async () => {
    const r = await api('/api/builder/landings?pageSize=100000', tokens.ownerA);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.pageSize <= 100, `pageSize was ${r.body.data.pageSize}`);
  });

  test('search is case-insensitive, as it was on SQLite', async () => {
    // Postgres LIKE is case-sensitive where SQLite's was not; without an
    // explicit mode this silently stops matching after the port.
    const r = await api('/api/builder/landings?search=PAGE', tokens.ownerA);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.total >= 1, 'uppercase search should still match "Page A"');
  });
});

describe('categories behave the same way', { skip }, () => {
  test('created in one tenant, invisible in the other', async () => {
    const created = await api('/api/builder/categories', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({ name: 'Winter', slug: `winter-${stamp}` }),
    });
    assert.equal(created.status, 201);

    const a = await api('/api/builder/categories', tokens.ownerA);
    const b = await api('/api/builder/categories', tokens.ownerB);
    assert.equal(a.body.data.items.length, 1);
    assert.equal(b.body.data.items.length, 0);
  });

  test("patching another tenant's category is a 404", async () => {
    const a = await api('/api/builder/categories', tokens.ownerA);
    const id = a.body.data.items[0].id;

    const r = await api(`/api/builder/categories/${id}`, tokens.ownerB, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    assert.equal(r.status, 404);

    const after = await api('/api/builder/categories', tokens.ownerA);
    assert.equal(after.body.data.items[0].name, 'Winter', 'unchanged');
  });
});

describe('the landings screen renders in the shell', { skip }, () => {
  test('it shows this tenant\'s pages, and only this tenant\'s', async () => {
    const a = await fetch(BASE + '/console/builder/pages', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.ownerA}` },
    });
    assert.equal(a.status, 200);
    const html = await a.text();

    assert.match(html, /data-testid="landings-table"/);
    assert.match(html, /Page A/);
    assert.ok(!/Page B/.test(html), "another tenant's page must not appear");

    // The shell is present, so the screen is inside the console rather than
    // standing on its own.
    assert.match(html, /data-testid="product-switcher"/);
    // Under the console prefix now: the root namespace belongs to tenant
    // storefronts, so product consoles moved beneath /console.
    assert.match(html, /href="\/console\/builder\/pages"/, 'the product nav is rendered');
  });

  test('only the current screen is marked as the current page', async () => {
    // The product index matches exactly; a prefix match would light up
    // "Overview" on every child route and stop meaning anything.
    const r = await fetch(BASE + '/console/builder/pages', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.ownerA}` },
    });
    const html = await r.text();
    const current = (html.match(/aria-current="page"/g) ?? []).length;
    assert.equal(current, 1, `expected exactly one current nav item, found ${current}`);
  });

  test('status renders through the shared token system', async () => {
    const r = await fetch(BASE + '/console/builder/pages', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.ownerA}` },
    });
    const html = await r.text();
    // The tone comes from @landingos/ui, so a DRAFT page here looks like the
    // equivalent state anywhere else in the platform.
    assert.match(html, /data-status="DRAFT"/);
    assert.match(html, /var\(--neutral-fg\)/);
  });

  test('a tenant without the builder cannot reach the screen', async () => {
    const r = await fetch(BASE + '/console/builder/pages', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.erpOwner}` },
      redirect: 'manual',
    });
    assert.equal(r.status, 404);
  });

  test('an anonymous visitor is sent to sign in', async () => {
    const r = await fetch(BASE + '/console/builder/pages', { redirect: 'manual' });
    assert.equal(r.status, 307);
    assert.match(r.headers.get('location') ?? '', /\/console\/login/);
  });
});
