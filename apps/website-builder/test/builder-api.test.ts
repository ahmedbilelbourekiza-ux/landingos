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

describe('a page is ARCHIVED, not deleted, once it has sold anything (LB.34)', { skip }, () => {
  /* The reference graph is why this slice exists. `SalesOrder.landingPage` is
     onDelete: Cascade, and so are the order's status history and DraftOrder;
     FulfillmentOrder.salesOrder is SetNull. So deleting the row a product was
     sold from destroys that product's whole commercial history, silently and
     with no undo — and a DELETE route for it already existed, simply unexposed
     in the console. These tests pin both halves: the destructive path refuses,
     and the archive path keeps the orders. */

  async function pageWithOrder(title: string) {
    const page = await withTenant(tenantA, (tx) =>
      (tx as any).landingPage.create({
        data: {
          tenantId: tenantA, title, slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`,
          price: 2500, published: true, status: 'PUBLISHED',
        },
        select: { id: true, slug: true },
      }),
    );
    const order = await withTenant(tenantA, (tx) =>
      (tx as any).salesOrder.create({
        data: {
          tenantId: tenantA, landingPageId: page.id,
          customerName: 'Archive Test', phone: '0555111222',
          wilaya: 'Alger', baladia: 'Centre', address: '',
          quantity: 1, productPrice: 2500, shippingPrice: 400, totalPrice: 2900,
        },
        select: { id: true },
      }),
    );
    return { page, order };
  }

  test('DELETE refuses a page that has orders, naming archive as the way', async () => {
    const { page, order } = await pageWithOrder('Sold Page');

    const r = await api(`/api/builder/landings/${page.id}`, tokens.ownerA, { method: 'DELETE' });
    assert.equal(r.status, 409, 'a page with orders must not be deletable');
    assert.equal(r.body?.error?.code, 'HAS_ORDERS');

    // The point of the refusal: both rows are still there.
    const stillThere = await withTenant(tenantA, async (tx) => ({
      page: await (tx as any).landingPage.findUnique({ where: { id: page.id }, select: { id: true } }),
      order: await (tx as any).salesOrder.findUnique({ where: { id: order.id }, select: { id: true } }),
    }));
    assert.ok(stillThere.page, 'the page was deleted anyway');
    assert.ok(stillThere.order, 'the order was destroyed with its page');
  });

  test('archiving unpublishes the page and KEEPS its orders', async () => {
    const { page, order } = await pageWithOrder('Archive Me');

    const r = await api(`/api/builder/landings/${page.id}/archive`, tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.body?.data?.status, 'ARCHIVED');

    const after = await withTenant(tenantA, async (tx) => ({
      page: await (tx as any).landingPage.findUnique({
        where: { id: page.id }, select: { status: true, published: true },
      }),
      order: await (tx as any).salesOrder.findUnique({
        where: { id: order.id }, select: { id: true, totalPrice: true },
      }),
    }));
    assert.equal(after.page.status, 'ARCHIVED');
    // Both, not just status: the storefront filters on published AND status,
    // so setting one without the other leaves a page archived in the console
    // and still on sale to customers.
    assert.equal(after.page.published, false, 'an archived page is still published');
    assert.ok(after.order, 'archiving destroyed the order — the whole point was that it must not');
  });

  test('an archived page is gone from the storefront and from the working list', async () => {
    const { page } = await pageWithOrder('Vanishing Page');
    const slug = (await withTenant(tenantA, (tx) =>
      (tx as any).landingPage.findUnique({ where: { id: page.id }, select: { slug: true } }),
    )).slug;
    const tenantSlug = `api-a-${stamp}`;

    const live = await fetch(`${BASE}/${tenantSlug}/${slug}`, { redirect: 'manual' });
    assert.equal(live.status, 200, 'the fixture page should be live before archiving');

    await api(`/api/builder/landings/${page.id}/archive`, tokens.ownerA, {
      method: 'POST', body: JSON.stringify({ archived: true }),
    });

    const gone = await fetch(`${BASE}/${tenantSlug}/${slug}`, { redirect: 'manual' });
    assert.equal(gone.status, 404, 'an archived page is still reachable by URL');

    const list = await fetch(`${BASE}/console/builder/pages`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.ownerA}` },
    });
    const html = await list.text();
    assert.ok(!html.includes('Vanishing Page'), 'an archived page still sits in the working list');
    assert.match(html, /data-testid="archived-link"/, 'no door to the archive');

    // ...and it IS in the archived view, with a way back.
    const archived = await fetch(`${BASE}/console/builder/pages?archived=1`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.ownerA}` },
    });
    const archivedHtml = await archived.text();
    assert.match(archivedHtml, /Vanishing Page/, 'the archived page is not in the archived view');
    assert.match(archivedHtml, /data-testid="page-restore"/, 'no way to restore it');
  });

  test('restoring returns a page to DRAFT, never straight back on sale', async () => {
    const { page } = await pageWithOrder('Restore Me');
    await api(`/api/builder/landings/${page.id}/archive`, tokens.ownerA, {
      method: 'POST', body: JSON.stringify({ archived: true }),
    });

    const r = await api(`/api/builder/landings/${page.id}/archive`, tokens.ownerA, {
      method: 'POST', body: JSON.stringify({ archived: false }),
    });
    assert.equal(r.status, 200);

    const after = await withTenant(tenantA, (tx) =>
      (tx as any).landingPage.findUnique({
        where: { id: page.id }, select: { status: true, published: true },
      }),
    );
    assert.equal(after.status, 'DRAFT');
    // Putting a page back on sale is the PUBLISH decision, with its own
    // permission and its own publishability checks. Restore must not smuggle it.
    assert.equal(after.published, false, 'restore put a page back on sale by itself');
  });

  test('a page that never sold anything is still genuinely deletable', async () => {
    const page = await withTenant(tenantA, (tx) =>
      (tx as any).landingPage.create({
        data: { tenantId: tenantA, title: 'Typo Page', slug: `typo-${Date.now()}`, price: 100 },
        select: { id: true },
      }),
    );

    const r = await api(`/api/builder/landings/${page.id}`, tokens.ownerA, { method: 'DELETE' });
    assert.equal(r.status, 200, 'a page with no orders has no history to protect');

    const gone = await withTenant(tenantA, (tx) =>
      (tx as any).landingPage.findUnique({ where: { id: page.id }, select: { id: true } }),
    );
    assert.equal(gone, null, 'the page survived a delete that should have removed it');
  });

  test('archiving needs the publish permission, not merely write', async () => {
    const { page } = await pageWithOrder('Permission Page');
    const r = await api(`/api/builder/landings/${page.id}/archive`, tokens.viewerA, {
      method: 'POST', body: JSON.stringify({ archived: true }),
    });
    assert.equal(r.status, 403, 'a viewer took a page off the storefront');
  });
});

describe('a landing page links to its own Meta pixels (LB.35)', { skip }, () => {
  /* Measured first: multiple pixels per TENANT already fired — Meta's own
     fbevents.js fetched a signals/config for BOTH configured ids, so "only the
     first one fires" was never true. The real gap was that the selection could
     not be made PER PAGE, because the loader was mounted in a layout and a
     layout cannot see its child segment's params. */
  let pixelOne = '';
  let pixelTwo = '';
  let trackedPage = '';
  let tenantSlug = '';

  before(async () => {
    if (skip) return;
    tenantSlug = `api-a-${stamp}`;
    const made = await withTenant(tenantA, async (tx) => {
      const rows = [];
      for (const [label, pid] of [['One', '311111111111111'], ['Two', '322222222222222']]) {
        rows.push(await (tx as any).trackingIntegration.create({
          data: { tenantId: tenantA, provider: 'meta', label, publicId: pid, isActive: true },
          select: { id: true, publicId: true },
        }));
      }
      const page = await (tx as any).landingPage.create({
        data: {
          tenantId: tenantA, title: 'Pixel Page', slug: `pixel-page-${stamp}`,
          price: 1500, published: true, status: 'PUBLISHED',
        },
        select: { id: true },
      });
      return { rows, page };
    });
    pixelOne = made.rows[0].id;
    pixelTwo = made.rows[1].id;
    trackedPage = made.page.id;
  });

  const pageHtml = async () => {
    const r = await fetch(`${BASE}/${tenantSlug}/pixel-page-${stamp}`);
    return r.text();
  };

  test('with no selection a page inherits every active tenant pixel', async () => {
    const html = await pageHtml();
    // Both ids reach the browser, which is what "fires to all of them" means
    // at the boundary this test can observe.
    assert.match(html, /311111111111111/, 'the first pixel is missing');
    assert.match(html, /322222222222222/, 'the SECOND pixel is missing — only the first fires');
  });

  test('a page linked to one pixel stops firing the other', async () => {
    const r = await api(`/api/builder/landings/${trackedPage}/general`, tokens.ownerA, {
      method: 'PATCH',
      body: JSON.stringify({ trackingIntegrationIds: [pixelTwo] }),
    });
    assert.equal(r.status, 200);

    const html = await pageHtml();
    assert.match(html, /322222222222222/, 'the linked pixel is missing');
    assert.ok(!html.includes('311111111111111'), 'an unlinked pixel still fires on this page');
  });

  test('linking BOTH fires both — the point of the slice', async () => {
    await api(`/api/builder/landings/${trackedPage}/general`, tokens.ownerA, {
      method: 'PATCH',
      body: JSON.stringify({ trackingIntegrationIds: [pixelOne, pixelTwo] }),
    });
    const html = await pageHtml();
    assert.match(html, /311111111111111/);
    assert.match(html, /322222222222222/);
  });

  test('clearing the selection restores "all of them"', async () => {
    await api(`/api/builder/landings/${trackedPage}/general`, tokens.ownerA, {
      method: 'PATCH',
      body: JSON.stringify({ trackingIntegrationIds: null }),
    });
    const html = await pageHtml();
    assert.match(html, /311111111111111/);
    assert.match(html, /322222222222222/);
  });

  test('a pixel belonging to another tenant is refused, not silently ignored', async () => {
    const foreign = await withTenant(tenantB, (tx) =>
      (tx as any).trackingIntegration.create({
        data: { tenantId: tenantB, provider: 'meta', label: 'Theirs', publicId: '399999999999999', isActive: true },
        select: { id: true },
      }),
    );
    const r = await api(`/api/builder/landings/${trackedPage}/general`, tokens.ownerA, {
      method: 'PATCH',
      body: JSON.stringify({ trackingIntegrationIds: [foreign.id] }),
    });
    assert.equal(r.status, 422);
    assert.equal(r.body?.error?.code, 'INVALID_REFERENCE');
  });

  test('ALL FOUR storefront routes still mount the loader (LB.5 as a test)', async () => {
    // LB.5 put the loader in the layout so no page could forget it. The mount
    // moved down to the routes, so the guarantee lives here now instead.
    const cat = await withTenant(tenantA, (tx) =>
      (tx as any).category.create({
        data: { tenantId: tenantA, name: 'Pixel Cat', slug: `pixel-cat-${stamp}` },
        select: { id: true },
      }),
    );
    await withTenant(tenantA, (tx) =>
      (tx as any).landingPage.updateMany({ where: { id: trackedPage }, data: { categoryId: cat.id } }),
    );
    const order = await withTenant(tenantA, (tx) =>
      (tx as any).salesOrder.create({
        data: {
          tenantId: tenantA, landingPageId: trackedPage,
          customerName: 'Pixel Buyer', phone: '0555333444',
          wilaya: 'Alger', baladia: 'Centre', address: '',
          quantity: 1, productPrice: 1500, shippingPrice: 300, totalPrice: 1800,
        },
        select: { id: true },
      }),
    );

    for (const [name, path] of [
      ['home', `/${tenantSlug}`],
      ['category', `/${tenantSlug}/category/pixel-cat-${stamp}`],
      ['product', `/${tenantSlug}/pixel-page-${stamp}`],
      ['thank-you', `/${tenantSlug}/thank-you/${order.id}`],
    ] as const) {
      const r = await fetch(BASE + path);
      assert.equal(r.status, 200, `${name} did not render`);
      const html = await r.text();
      assert.ok(
        html.includes('311111111111111') || html.includes('322222222222222'),
        `${name} mounts no tracking loader — LB.5's guarantee is broken`,
      );
    }
  });
});
