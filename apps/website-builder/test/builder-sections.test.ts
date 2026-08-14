import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';
// The Arabic catalogue, because these fixture tenants take the default locale.
// Read rather than copied, so a reworded sentence does not break a test that
// is about behaviour — see the assertion that uses it.
import arMessages from '@landingos/i18n/messages/ar.json' with { type: 'json' };

/* =============================================================================
 * The rest of the ported builder surface: landing editor sections, the order
 * state machine, tenant settings, and platform integrations.
 *
 * These carry the business rules the legacy routes enforced. A port that keeps
 * the data shape but drops the rules is not a port — so each rule is asserted
 * by trying to break it.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();
const userIds: string[] = [];
const tokens: Record<string, string> = {};
let tenant = '';
let otherTenant = '';
/** LB.21 — the tenant that holds both products. */
let bothTenant = '';
let bothPageId = '';
let pageId = '';
let otherPageId = '';
let orderId = '';
let unentitledTenant = '';

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

const patch = (p: string, t: string, data: unknown) =>
  api(p, t, { method: 'PATCH', body: JSON.stringify(data) });
const put = (p: string, t: string, data: unknown) =>
  api(p, t, { method: 'PUT', body: JSON.stringify(data) });

before(async () => {
  if (skip) return;

  for (const [slug, ents, key] of [
    [`sec-a-${stamp}`, ['product.website-builder'], 'owner'],
    [`sec-b-${stamp}`, ['product.website-builder'], 'other'],
    /* LB.21 — a tenant holding BOTH products. Publishing into the catalogue
       needs the Manager, and the two above deliberately do not have it: the
       builder-only case is what standalone mode is, and it has its own test. */
    [`sec-both-${stamp}`, ['product.website-builder', 'product.erp'], 'both'],
  ] as const) {
    const t = await asPlatform().tenant.create({ data: { slug, name: slug } });
    await withTenant(t.id, (tx) =>
      (tx as any).subscription.create({ data: { tenantId: t.id, status: 'ACTIVE', entitlements: [...ents] } }),
    );
    const email = `sec-${key}-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email, name: email, passwordHash: await hashPassword('x') },
    });
    userIds.push(u.id);
    await withTenant(t.id, (tx) =>
      (tx as any).membership.create({ data: { tenantId: t.id, userId: u.id, role: 'OWNER' } }),
    );
    tokens[key] = (await createSession(u.id, t.id)).token;
    if (key === 'owner') tenant = t.id;
    else if (key === 'both') bothTenant = t.id;
    else otherTenant = t.id;
  }

  // A tenant that never bought the builder — the only way to prove the
  // entitlement gate on the SCREENS, since both tenants above are entitled.
  {
    const t = await asPlatform().tenant.create({
      data: { slug: `sec-none-${stamp}`, name: 'No Builder' },
    });
    await withTenant(t.id, (tx) =>
      (tx as any).subscription.create({
        data: { tenantId: t.id, status: 'ACTIVE', entitlements: ['product.erp'] },
      }),
    );
    const email = `sec-none-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email, name: email, passwordHash: await hashPassword('x') },
    });
    userIds.push(u.id);
    await withTenant(t.id, (tx) =>
      (tx as any).membership.create({ data: { tenantId: t.id, userId: u.id, role: 'OWNER' } }),
    );
    tokens.unentitled = (await createSession(u.id, t.id)).token;
    unentitledTenant = t.id;
  }

  // A MANAGER, to prove publish and integrations are gated separately.
  const mEmail = `sec-manager-${stamp}@landingos.test`;
  const m = await asPlatform().user.create({
    data: { email: mEmail, name: mEmail, passwordHash: await hashPassword('x') },
  });
  userIds.push(m.id);
  await withTenant(tenant, (tx) =>
    (tx as any).membership.create({ data: { tenantId: tenant, userId: m.id, role: 'MANAGER' } }),
  );
  tokens.manager = (await createSession(m.id, tenant)).token;

  pageId = (await withTenant(tenant, (tx) =>
    (tx as any).landingPage.create({
      data: { tenantId: tenant, title: 'Editable', slug: `editable-${stamp}`, price: 5000 },
      select: { id: true },
    }),
  )).id;

  otherPageId = (await withTenant(otherTenant, (tx) =>
    (tx as any).landingPage.create({
      data: { tenantId: otherTenant, title: 'Theirs', slug: `theirs-${stamp}`, price: 100 },
      select: { id: true },
    }),
  )).id;

  // LB.21 — a published page in the tenant that owns both products.
  bothPageId = (await withTenant(bothTenant, (tx) =>
    (tx as any).landingPage.create({
      data: {
        tenantId: bothTenant, title: `Publishable ${stamp}`,
        slug: `publishable-${stamp}`, price: 7000, published: true,
      },
      select: { id: true },
    }),
  )).id;

  orderId = (await withTenant(tenant, (tx) =>
    (tx as any).salesOrder.create({
      data: {
        tenantId: tenant, landingPageId: pageId, customerName: 'Test Buyer',
        phone: '0555000111', wilaya: 'Alger', baladia: 'Bab Ezzouar', address: 'x',
        quantity: 1, productPrice: 5000, shippingPrice: 400, totalPrice: 5400,
      },
      select: { id: true },
    }),
  )).id;
});

after(async () => {
  if (skip) return;
  for (const id of userIds) {
    await destroySessionsForUser(id);
    for (const t of [tenant, otherTenant, bothTenant, unentitledTenant].filter(Boolean)) {
      await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId: id } }));
    }
    await asPlatform().user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [tenant, otherTenant, bothTenant, unentitledTenant].filter(Boolean)) {
    await deleteTenant(id).catch(() => {});
  }
  await disconnect();
});

describe('landing editor sections', { skip }, () => {
  test('general edits apply, and a foreign slug clash does not block', async () => {
    const r = await patch(`/api/builder/landings/${pageId}/general`, tokens.owner, {
      title: 'Renamed', description: 'A description',
    });
    assert.equal(r.status, 200);

    // The other tenant's slug must not collide with ours.
    const free = await patch(`/api/builder/landings/${pageId}/general`, tokens.owner, {
      slug: `theirs-${stamp}`,
    });
    assert.equal(free.status, 200, "another tenant's slug is not taken from us");
  });

  test('a category from another tenant is refused, not silently attached', async () => {
    const foreign = await withTenant(otherTenant, (tx) =>
      (tx as any).category.create({
        data: { tenantId: otherTenant, name: 'Foreign', slug: `foreign-${stamp}` },
        select: { id: true },
      }),
    );
    const r = await patch(`/api/builder/landings/${pageId}/general`, tokens.owner, {
      categoryId: foreign.id,
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_REFERENCE');
  });

  test('an old price at or below the current one is refused', async () => {
    // Otherwise the page advertises a discount that does not exist.
    const bad = await patch(`/api/builder/landings/${pageId}/pricing`, tokens.owner, {
      price: 5000, oldPrice: 4000,
    });
    assert.equal(bad.status, 422);

    const good = await patch(`/api/builder/landings/${pageId}/pricing`, tokens.owner, {
      price: 5000, oldPrice: 7000,
    });
    assert.equal(good.status, 200);
  });

  test('media ordering is scoped per placement, so the hero stays the hero', async () => {
    const r = await put(`/api/builder/landings/${pageId}/media`, tokens.owner, {
      items: [
        { type: 'IMAGE', url: 'a.jpg', placement: 'GALLERY' },
        { type: 'IMAGE', url: 'desc1.jpg', placement: 'DESCRIPTION' },
        { type: 'IMAGE', url: 'b.jpg', placement: 'GALLERY' },
      ],
    });
    assert.equal(r.status, 200);

    const rows = await withTenant(tenant, (tx) =>
      (tx as any).landingMedia.findMany({
        where: { landingPageId: pageId },
        orderBy: [{ placement: 'asc' }, { displayOrder: 'asc' }],
        select: { url: true, placement: true, displayOrder: true },
      }),
    );
    const gallery = rows.filter((m: any) => m.placement === 'GALLERY');
    const description = rows.filter((m: any) => m.placement === 'DESCRIPTION');
    assert.deepEqual(gallery.map((m: any) => m.displayOrder), [0, 1]);
    assert.deepEqual(description.map((m: any) => m.displayOrder), [0], 'numbers from zero independently');
    assert.equal(gallery[0].url, 'a.jpg', 'the hero is the first GALLERY image');
  });

  test('a placement-scoped save replaces only its own list (LB.2)', async () => {
    // Seed both placements, then save the gallery ALONE — the description
    // images must survive. The editor's two image sections each save one
    // placement; an unscoped replace would make saving one delete the other.
    await put(`/api/builder/landings/${pageId}/media`, tokens.owner, {
      items: [
        { type: 'IMAGE', url: 'g1.jpg', placement: 'GALLERY' },
        { type: 'IMAGE', url: 'd1.jpg', placement: 'DESCRIPTION' },
      ],
    });
    const r = await put(`/api/builder/landings/${pageId}/media`, tokens.owner, {
      items: [{ type: 'IMAGE', url: 'g2.jpg' }],
      placement: 'GALLERY',
    });
    assert.equal(r.status, 200);

    const rows = await withTenant(tenant, (tx) =>
      (tx as any).landingMedia.findMany({
        where: { landingPageId: pageId },
        select: { url: true, placement: true },
      }),
    );
    assert.deepEqual(
      rows.map((m: any) => m.url).sort(),
      ['d1.jpg', 'g2.jpg'],
      'the gallery was replaced and the description images survived',
    );
  });

  test("the order-form save stores the editor's own shape, readably (LB.2/B-07)", async () => {
    // The editor PATCHes the WHOLE OrderFormConfig — field configs at the top
    // level plus the order array. The first port only accepted a `fields`
    // record no client sent, so every save answered 200 while storing nothing.
    const r = await patch(`/api/builder/landings/${pageId}/order-form`, tokens.owner, {
      customerName: { label: 'الاسم', placeholder: 'اكتب اسمك', visible: true, required: true },
      notes: { visible: false, required: false, label: 'ملاحظات', placeholder: '...' },
      order: ['phone', 'customerName', 'wilaya', 'baladia', 'address', 'notes', 'quantity'],
      buttonText: 'اشترِ الآن',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const setting = await withTenant(tenant, (tx) =>
      (tx as any).landingSetting.findUnique({
        where: { landingPageId: pageId },
        select: { orderFormConfig: true },
      }),
    );
    const stored = setting.orderFormConfig as any;
    assert.equal(stored.customerName.label, 'الاسم', 'the field config was stored');
    assert.equal(stored.notes.visible, false);
    assert.deepEqual(stored.order.slice(0, 2), ['phone', 'customerName'], 'the render order was stored');
    assert.equal(typeof stored, 'object', 'stored as a Json VALUE, not a serialized string');

    const pageRow = await withTenant(tenant, (tx) =>
      (tx as any).landingPage.findUnique({ where: { id: pageId }, select: { buttonText: true } }),
    );
    assert.equal(pageRow.buttonText, 'اشترِ الآن');
  });

  test("hiding a courier field through the editor's shape is refused too", async () => {
    const r = await patch(`/api/builder/landings/${pageId}/order-form`, tokens.owner, {
      phone: { visible: false },
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'FIELD_REQUIRED');
  });

  test('a duplicate variant is refused', async () => {
    const r = await put(`/api/builder/landings/${pageId}/variants`, tokens.owner, {
      items: [
        { name: 'Size', value: 'Large' },
        { name: 'size', value: 'large' },
      ],
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'DUPLICATE_VARIANT');
  });

  test('a review rating outside 1..5 is refused', async () => {
    // Prisma has no portable CHECK constraint, so validation is the only guard.
    for (const rating of [0, 6, -1]) {
      const r = await put(`/api/builder/landings/${pageId}/reviews`, tokens.owner, {
        items: [{ customerName: 'X', rating, reviewText: 'ok' }],
      });
      assert.equal(r.status, 422, `rating ${rating} should be refused`);
    }
    const ok = await put(`/api/builder/landings/${pageId}/reviews`, tokens.owner, {
      items: [{ customerName: 'X', rating: 5, reviewText: 'great' }],
    });
    assert.equal(ok.status, 200);
  });

  test('a product cannot be left with no delivery method', async () => {
    await patch(`/api/builder/landings/${pageId}/shipping`, tokens.owner, {
      homeDeliveryEnabled: true, stopDeskEnabled: false,
    });
    // Turning the only enabled method off, in a PARTIAL update, must resolve
    // against what is stored rather than against the request alone.
    const r = await patch(`/api/builder/landings/${pageId}/shipping`, tokens.owner, {
      homeDeliveryEnabled: false,
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'NO_SHIPPING_METHOD');
  });

  test('a field the courier needs cannot be hidden', async () => {
    const r = await patch(`/api/builder/landings/${pageId}/order-form`, tokens.owner, {
      fields: { phone: { visible: false } },
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'FIELD_REQUIRED');
  });

  test("another tenant's page cannot be edited through any section", async () => {
    for (const section of ['general', 'pricing', 'shipping', 'order-form']) {
      const r = await patch(`/api/builder/landings/${otherPageId}/${section}`, tokens.owner, {});
      assert.equal(r.status, 404, `${section} must not reach another tenant`);
    }
    for (const section of ['media', 'variants', 'reviews']) {
      const r = await put(`/api/builder/landings/${otherPageId}/${section}`, tokens.owner, { items: [] });
      assert.equal(r.status, 404, `${section} must not reach another tenant`);
    }
  });
});

describe('publishing is its own permission', { skip }, () => {
  test('an incomplete page cannot go live', async () => {
    const empty = await withTenant(tenant, (tx) =>
      (tx as any).landingPage.create({
        data: { tenantId: tenant, title: '   ', slug: `blank-${stamp}`, price: 0 },
        select: { id: true },
      }),
    );
    const r = await api(`/api/builder/landings/${empty.id}/publish`, tokens.owner, {
      method: 'POST', body: JSON.stringify({ published: true }),
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'NOT_PUBLISHABLE');
  });

  test('an owner can publish and unpublish', async () => {
    const on = await api(`/api/builder/landings/${pageId}/publish`, tokens.owner, {
      method: 'POST', body: JSON.stringify({ published: true }),
    });
    assert.equal(on.status, 200);
    assert.equal(on.body.data.status, 'PUBLISHED');

    const off = await api(`/api/builder/landings/${pageId}/publish`, tokens.owner, {
      method: 'POST', body: JSON.stringify({ published: false }),
    });
    assert.equal(off.body.data.status, 'DRAFT');
  });
});

describe('the order state machine survived the port', { skip }, () => {
  test('a legal transition records history', async () => {
    const r = await patch(`/api/builder/orders/${orderId}/status`, tokens.owner, { toStatus: 'CONFIRMED' });
    assert.equal(r.status, 200);

    const detail = await api(`/api/builder/orders/${orderId}`, tokens.owner);
    assert.equal(detail.body.data.status, 'CONFIRMED');
    assert.ok(detail.body.data.statusHistory.length >= 1, 'the transition is on the record');
    assert.equal(detail.body.data.statusHistory.at(-1).toStatus, 'CONFIRMED');
  });

  test('an illegal transition is refused', async () => {
    // CONFIRMED cannot jump straight to DELIVERED.
    const r = await patch(`/api/builder/orders/${orderId}/status`, tokens.owner, { toStatus: 'DELIVERED' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_TRANSITION');
  });

  test('a terminal state is terminal', async () => {
    await patch(`/api/builder/orders/${orderId}/status`, tokens.owner, { toStatus: 'CANCELLED' });
    const r = await patch(`/api/builder/orders/${orderId}/status`, tokens.owner, { toStatus: 'CONFIRMED' });
    assert.equal(r.status, 422, 'a cancelled order cannot be re-opened');
  });

  test("another tenant's order is invisible", async () => {
    const r = await api(`/api/builder/orders/${orderId}`, tokens.other);
    assert.equal(r.status, 404);
  });
});

describe('tenant settings replaced the singleton', { skip }, () => {
  test('a tenant with no row gets defaults rather than a 404', async () => {
    const r = await api('/api/builder/settings/store', tokens.other);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.storeName, 'a usable default');
  });

  test('settings are per tenant, not shared', async () => {
    await api('/api/builder/settings/store', tokens.owner, {
      method: 'PUT', body: JSON.stringify({ storeName: 'Mine Only' }),
    });
    const mine = await api('/api/builder/settings/store', tokens.owner);
    const theirs = await api('/api/builder/settings/store', tokens.other);
    assert.equal(mine.body.data.storeName, 'Mine Only');
    assert.notEqual(theirs.body.data.storeName, 'Mine Only');
  });

  test('delivery prices list every wilaya and save per tenant', async () => {
    const list = await api('/api/builder/settings/delivery-prices', tokens.owner);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.items.length >= 48, 'the shared wilaya reference data is present');

    const first = list.body.data.items[0];
    const saved = await api('/api/builder/settings/delivery-prices', tokens.owner, {
      method: 'PUT',
      body: JSON.stringify({ items: [{ wilayaId: first.id, homePrice: 700, deskPrice: 400 }] }),
    });
    assert.equal(saved.status, 200);

    const mine = await api('/api/builder/settings/delivery-prices', tokens.owner);
    const theirs = await api('/api/builder/settings/delivery-prices', tokens.other);
    assert.equal(Number(mine.body.data.items[0].homePrice), 700);
    assert.equal(theirs.body.data.items[0].homePrice, null, 'the other tenant is unpriced');
  });
});

describe('platform integrations hold secrets safely', { skip }, () => {
  test('a webhook secret is never returned', async () => {
    const created = await api('/api/platform/integrations/webhooks', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ label: 'CRM', url: 'https://example.com/hook', secret: 'supersecret123' }),
    });
    assert.equal(created.status, 201);
    assert.notEqual(created.body.data.secret, 'supersecret123');

    const list = await api('/api/platform/integrations/webhooks', tokens.owner);
    assert.ok(!JSON.stringify(list.body).includes('supersecret123'), 'the secret must not appear in a list');
  });

  test('an http endpoint is refused', async () => {
    // It would send signed customer data in clear text.
    const r = await api('/api/platform/integrations/webhooks', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ label: 'Bad', url: 'http://example.com/hook', secret: 'longenough1' }),
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INSECURE_URL');
  });

  test('a manager may read integrations but not change them', async () => {
    const read = await api('/api/platform/integrations/webhooks', tokens.manager);
    assert.equal(read.status, 200);

    const write = await api('/api/platform/integrations/webhooks', tokens.manager, {
      method: 'POST',
      body: JSON.stringify({ label: 'X', url: 'https://x.test/h', secret: 'longenough1' }),
    });
    assert.equal(write.status, 403, 'integration secrets are admin-level');
  });

  test('a meta pixel token is masked and the id validated', async () => {
    const bad = await api('/api/platform/integrations/meta-pixels', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ label: 'P', pixelId: 'not-numeric', accessToken: 'tokentokentoken' }),
    });
    assert.equal(bad.status, 422);

    const good = await api('/api/platform/integrations/meta-pixels', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ label: 'P', pixelId: '1234567890', accessToken: 'tokentokentoken' }),
    });
    assert.equal(good.status, 201);
    assert.notEqual(good.body.data.accessToken, 'tokentokentoken');
  });

  test('integrations are tenant-scoped like everything else', async () => {
    const theirs = await api('/api/platform/integrations/webhooks', tokens.other);
    assert.equal(theirs.body.data.items.length, 0);
  });
});

describe('every ported screen renders in the shell', { skip }, () => {
  const screens = ['/console/builder/pages', '/console/builder/orders', '/console/builder/categories', '/console/builder/abandoned'];
  const tables = ['landings-table', 'orders-table', 'categories-table', 'abandoned-table'];

  test('every nav item the MANIFEST declares answers, so the next one cannot 404 (LB.4)', async () => {
    // The general form of LP.17's defect, applied to this product: the
    // manifest shipped `templates` and `delivery-prices` items for YEARS with
    // no screen behind them, and the hand-listed `screens` array above could
    // not see it. Reading the manifest is what makes the next addition fail
    // here instead of in a customer's sidebar. Redirects are followed — a nav
    // item may legitimately land on a platform screen — but the destination
    // must exist.
    const { websiteBuilder } = await import('@landingos/product-registry');
    assert.ok(websiteBuilder.nav.length >= 5, 'the manifest still declares a nav');
    for (const item of websiteBuilder.nav) {
      const path = `/console/builder${item.path ? `/${item.path}` : ''}`;
      const r = await fetch(BASE + path, {
        headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
        redirect: 'follow',
      });
      assert.equal(r.status, 200, `nav item "${item.id}" (${path}) must lead to a real screen`);
    }
  });

  test("a single-product session's console front door lands on its product (S-01)", async () => {
    // /console redirects a one-product tenant straight to that product — and
    // it must redirect INSIDE the console namespace. The bare basePath it
    // used to redirect to is the storefront namespace, where /builder is a
    // tenant slug that does not exist: every builder-only customer's front
    // door answered 404.
    const r = await fetch(BASE + '/console', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
      redirect: 'manual',
    });
    assert.ok(r.status === 307 || r.status === 308 || r.status === 303, `expected redirect, got ${r.status}`);
    assert.equal(
      new URL(r.headers.get('location') ?? '', BASE).pathname,
      '/console/builder',
      'the redirect stays inside the console',
    );
  });

  test('each screen loads for an entitled tenant', async () => {
    for (const path of screens) {
      const r = await fetch(BASE + path, {
        headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
      });
      assert.equal(r.status, 200, `${path} should render`);
      const html = await r.text();
      // The shell is present, so the screen is inside the console rather than
      // standing on its own.
      assert.match(html, /data-testid="product-switcher"/, `${path} is missing the shell`);
    }
  });

  test('each renders its own table through the shared component', async () => {
    for (const [i, path] of screens.entries()) {
      const r = await fetch(BASE + path, {
        headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
      });
      const html = await r.text();
      assert.match(html, new RegExp(`data-testid="${tables[i]}"`), `${path} table missing`);
    }
  });

  test('a tenant without the builder gets 404 on every screen', async () => {
    // Same answer as the API and the switcher: not seeing it and not reaching
    // it are one decision.
    for (const path of screens) {
      const r = await fetch(BASE + path, {
        headers: { cookie: `${SESSION_COOKIE}=${tokens.unentitled}` },
        redirect: 'manual',
      });
      assert.equal(r.status, 404, `${path} must 404 for a tenant without the builder`);
    }
  });

  test('an anonymous visitor is sent to sign in from every screen', async () => {
    for (const path of screens) {
      const r = await fetch(BASE + path, { redirect: 'manual' });
      assert.equal(r.status, 307, path);
      assert.match(r.headers.get('location') ?? '', /\/console\/login/);
    }
  });

  test('orders show through the shared status tones', async () => {
    const r = await fetch(BASE + '/console/builder/orders', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    const html = await r.text();
    // The order was moved to CANCELLED earlier in this file, which maps to the
    // danger tone in @landingos/ui — the same tone the ERP will use.
    assert.match(html, /data-status="CANCELLED"/);
    assert.match(html, /var\(--danger-fg\)/);
  });
});

describe('platform settings screens', { skip }, () => {
  test('the settings index lists only sections the caller may open', async () => {
    const owner = await fetch(BASE + '/console/settings', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(owner.status, 200);
    const ownerHtml = await owner.text();
    for (const s of ['profile', 'store', 'delivery-prices', 'integrations']) {
      assert.match(ownerHtml, new RegExp(`data-section="${s}"`), `owner should see ${s}`);
    }

    // A tenant without the builder has no store profile or delivery prices to
    // configure — offering the link would lead straight to a 404.
    const none = await fetch(BASE + '/console/settings', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.unentitled}` },
    });
    const noneHtml = await none.text();
    assert.match(noneHtml, /data-section="profile"/, 'everyone has a profile');
    assert.ok(!/data-section="store"/.test(noneHtml), 'no store profile without the builder');
  });

  test('the store screen 404s for a tenant that cannot configure one', async () => {
    const r = await fetch(BASE + '/console/settings/store', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.unentitled}` },
      redirect: 'manual',
    });
    assert.equal(r.status, 404);
  });

  test('the store screen renders with the tenant name as its default', async () => {
    const r = await fetch(BASE + '/console/settings/store', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="store-form"/);
    // An earlier test in this file already saved a store name, so assert the
    // form is populated rather than pinning a specific value — the default
    // only applies to a tenant that has never opened the screen.
    assert.match(html, /name="storeName"[^>]*value="[^"]+"/);
  });

  test('the profile screen shows the email as read-only', async () => {
    const r = await fetch(BASE + '/console/settings/profile', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="profile-form"/);
    assert.match(html, /data-testid="password-form"/);
    // The address IS the identity across tenants, so it is not editable here.
    assert.match(html, /readOnly=""|readonly=""/);
  });

  test('integrations render without ever printing a secret', async () => {
    const r = await fetch(BASE + '/console/settings/integrations', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="webhooks-table"/);
    assert.match(html, /data-testid="pixels-table"/);
    // The webhook created earlier in this file used this secret.
    assert.ok(!html.includes('supersecret123'), 'a signing secret must never reach the page');
    assert.ok(!html.includes('tokentokentoken'), 'a pixel token must never reach the page');
  });

  test('a manager sees integrations read-only', async () => {
    const r = await fetch(BASE + '/console/settings/integrations', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.manager}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    /* LB.41 — this asserted the English sentence "administrator access", which
     * stopped appearing the moment the screen was translated: these fixture
     * tenants take the default locale, `ar`, so the page now says it in Arabic.
     *
     * Asserting the CATALOGUE rather than a copy of the prose is what keeps
     * the test about the behaviour ("the limitation is stated") instead of
     * about one language's wording — rewording the sentence in en.json should
     * not break a test, and translating it should not either. */
    const readOnly = arMessages.settings.integrationsReadOnly as string;
    assert.ok(
      html.includes(readOnly),
      'the limitation is stated, not just enforced',
    );
    // And the structural half, which survives any rewording: a manager is not
    // handed the create panels at all.
    assert.ok(!html.includes('data-testid="tracking-create"'), 'a manager got the tracking create panel');
    assert.ok(!html.includes('data-testid="webhook-create"'), 'a manager got the webhook create panel');
  });

  test('the builder overview reports this tenant only', async () => {
    const r = await fetch(BASE + '/console/builder', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="builder-overview"/);
    assert.match(html, new RegExp(`sec-a-${stamp}`), "the tenant's own name");
  });
});

describe('the landing editor moved, not rewritten', { skip }, () => {
  test('it opens in the console for a permitted user', async () => {
    const r = await fetch(`${BASE}/console/builder/pages/${pageId}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    // The same components as the legacy mount, pointed at the platform API.
    assert.match(html, /Editable|Renamed/, 'the page being edited is loaded');
  });

  test('it sends its requests to the platform API, not the legacy one', async () => {
    const r = await fetch(`${BASE}/console/builder/pages/${pageId}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    const html = await r.text();
    // The provider's base reaches the client bundle as a prop. If this ever
    // reverts to "/api" the editor silently writes through the legacy JWT
    // routes, which no platform session can satisfy.
    assert.match(html, /\/api\/builder/, 'the editor is bound to the platform API base');
  });

  test("the preview renders inside the page's theme scope, not the console's (theme-bleed)", async () => {
    // The miniature preview used to be plain console Tailwind — `bg-background`
    // and friends — so its canvas flipped with the console's dark/light toggle
    // instead of showing the theme chosen for the page. It now renders inside
    // the same ThemeProvider the published page uses; the scope element paints
    // the theme's own background and redefines the console token names.
    const r = await fetch(`${BASE}/console/builder/pages/${pageId}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    const tag = html.match(/<div[^>]*data-landing-theme="[^"]*"[^>]*>/)?.[0] ?? '';
    assert.notEqual(tag, '', 'the preview has no theme scope — it will follow the console theme');
    const style = tag.match(/style="([^"]*)"/)?.[1] ?? '';
    assert.match(style, /background-color:/, 'the scope paints no canvas of its own');
    assert.ok(style.includes('--background:'), 'the console tokens are not redefined in scope');
  });

  test('no money box in the editor is a number input (LB.15 / M-05)', async () => {
    // A number input hands back a JS float into a `Decimal` column, and this
    // one did worse than that: with `step="1"`, two arrow presses on 2990.50
    // stored 2992 — the centimes rounded away by the control itself. The rule
    // is the ERP's (`erp/screens.test.ts`, "money is never a number input"),
    // asserted here on the screen a merchant actually prices a product on.
    //
    // A variant is created first so the option row — the third money box, and
    // the only one that is not in the page's first render — is present.
    await withTenant(tenant, (tx) =>
      (tx as any).landingVariant.create({
        data: {
          tenantId: tenant, landingPageId: pageId,
          name: 'Lot', value: 'x3', extraPrice: 500.75, displayOrder: 0,
        },
      }),
    );

    const r = await fetch(`${BASE}/console/builder/pages/${pageId}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();

    for (const id of ['price', 'oldPrice']) {
      const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
      assert.notEqual(tag, '', `no ${id} control found`);
      assert.ok(!/type="number"/.test(tag), `${id} rendered as ${tag}`);
      assert.match(tag, /inputmode="decimal"/i, `${id} offers no decimal keypad`);
      // A price reads left-to-right in Arabic too; every other money box on
      // this platform is the same island (LB.28's rule lives inside it).
      assert.match(tag, /dir="ltr"/i, `${id} is not an LTR money island`);
    }

    const optionTag = html.match(/<input[^>]*aria-label="[^"]*"[^>]*value="500.75"[^>]*>/)?.[0]
      ?? html.match(/<input[^>]*value="500.75"[^>]*>/)?.[0] ?? '';
    assert.notEqual(optionTag, '', "the variant option's extra-price box did not render");
    assert.ok(!/type="number"/.test(optionTag), `the option supplement rendered as ${optionTag}`);
    assert.match(optionTag, /inputmode="decimal"/i);

    // And nothing else on the screen quietly reintroduces one.
    assert.equal(
      (html.match(/<input[^>]*type="number"/g) ?? []).length,
      0,
      'a number input is still rendered somewhere in the editor',
    );
  });

  test("another tenant's page cannot be opened for editing", async () => {
    const r = await fetch(`${BASE}/console/builder/pages/${otherPageId}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
      redirect: 'manual',
    });
    assert.equal(r.status, 404);
  });

  test('a viewer cannot open the editor at all', async () => {
    // Reading is not enough: every control in the editor writes.
    const viewerEmail = `sec-viewer-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email: viewerEmail, name: viewerEmail, passwordHash: await hashPassword('x') },
    });
    userIds.push(u.id);
    await withTenant(tenant, (tx) =>
      (tx as any).membership.create({ data: { tenantId: tenant, userId: u.id, role: 'VIEWER' } }),
    );
    const { token } = await createSession(u.id, tenant);

    const r = await fetch(`${BASE}/console/builder/pages/${pageId}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      redirect: 'manual',
    });
    assert.equal(r.status, 404);
  });

  test('an unentitled tenant cannot open it either', async () => {
    const r = await fetch(`${BASE}/console/builder/pages/${pageId}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.unentitled}` },
      redirect: 'manual',
    });
    assert.equal(r.status, 404);
  });
});

describe('the last screens: delivery prices, order detail, creation', { skip }, () => {
  test('delivery prices list every wilaya and distinguish blank from zero', async () => {
    const r = await fetch(BASE + '/console/settings/delivery-prices', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="delivery-prices-form"/);
    // All 58, from the shared reference data.
    const rows = (html.match(/data-wilaya="/g) ?? []).length;
    assert.equal(rows, 58, `expected 58 wilayas, rendered ${rows}`);
    // The distinction that matters: unpriced is not free.
    assert.match(html, /cannot be delivered to/i);
  });

  test('order detail shows history and only legal transitions', async () => {
    const r = await fetch(`${BASE}/console/builder/orders/${orderId}`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="order-details"/);
    assert.match(html, /data-testid="order-history"/);
    // This order was driven to CANCELLED earlier, which is terminal — so no
    // transition control may be offered at all.
    assert.match(html, /data-status="CANCELLED"/);
    assert.ok(!/data-transition=/.test(html), 'a terminal order offers no transitions');
    // The sentence is an i18n key now (UXP), so the assertion reads the
    // structural hook rather than the English wording: the limitation must be
    // STATED on the page, in whatever language the page is in.
    assert.match(html, /data-final-state=/);
  });

  test('a live order offers exactly the transitions the API would accept', async () => {
    const fresh = await withTenant(tenant, (tx) =>
      (tx as any).salesOrder.create({
        data: {
          tenantId: tenant, landingPageId: pageId, customerName: 'Fresh Buyer',
          phone: '0555222333', wilaya: 'Oran', baladia: 'Es Senia', address: 'y',
          quantity: 1, productPrice: 1000, shippingPrice: 300, totalPrice: 1300,
        },
        select: { id: true },
      }),
    );

    const r = await fetch(`${BASE}/console/builder/orders/${fresh.id}`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    const html = await r.text();
    // NEW allows exactly CONFIRMED and CANCELLED.
    assert.match(html, /data-transition="CONFIRMED"/);
    assert.match(html, /data-transition="CANCELLED"/);
    assert.ok(!/data-transition="DELIVERED"/.test(html), 'no illegal jump is offered');
  });

  test("another tenant's order detail is a 404", async () => {
    const r = await fetch(`${BASE}/console/builder/orders/${orderId}`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.other}` },
      redirect: 'manual',
    });
    assert.equal(r.status, 404);
  });

  test('the creation form renders for a writer and 404s for a viewer', async () => {
    const owner = await fetch(BASE + '/console/builder/pages/new', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(owner.status, 200);
    assert.match(await owner.text(), /data-testid="new-landing-form"/);

    const unentitled = await fetch(BASE + '/console/builder/pages/new', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.unentitled}` },
      redirect: 'manual',
    });
    assert.equal(unentitled.status, 404);
  });
});

describe('benefits and FAQ reach the customer (LB.12)', { skip }, () => {
  test('a replace-all PUT stores each list in array order', async () => {
    const ben = await put(`/api/builder/landings/${pageId}/features`, tokens.owner, {
      items: [
        { icon: 'truck', title: 'توصيل خلال 48 ساعة', description: 'لكل الولايات' },
        { icon: 'shield-check', title: 'ضمان استرجاع' },
      ],
    });
    assert.equal(ben.status, 200);
    assert.equal(ben.body.data.count, 2);

    const faq = await put(`/api/builder/landings/${pageId}/faqs`, tokens.owner, {
      items: [
        { question: 'كم تستغرق مدة التوصيل؟', answer: 'من 24 إلى 72 ساعة حسب الولاية.' },
        { question: 'هل الدفع عند الاستلام؟', answer: 'نعم، الدفع عند الاستلام متاح.' },
      ],
    });
    assert.equal(faq.status, 200);

    const rows = await withTenant(tenant, async (tx) => ({
      features: await (tx as any).landingFeature.findMany({
        where: { landingPageId: pageId }, orderBy: { displayOrder: 'asc' },
      }),
      faqs: await (tx as any).landingFAQ.findMany({
        where: { landingPageId: pageId }, orderBy: { displayOrder: 'asc' },
      }),
    }));
    assert.equal((rows as any).features.length, 2);
    assert.equal((rows as any).features[0].icon, 'truck');
    assert.equal((rows as any).features[1].displayOrder, 1);
    assert.equal((rows as any).faqs.length, 2);

    // Replace, not append: a second PUT with one item leaves one row.
    const again = await put(`/api/builder/landings/${pageId}/faqs`, tokens.owner, {
      items: [{ question: 'سؤال واحد', answer: 'جواب واحد' }],
    });
    assert.equal(again.status, 200);
    const left = await withTenant(tenant, (tx) =>
      (tx as any).landingFAQ.count({ where: { landingPageId: pageId } }),
    );
    assert.equal(left, 1);
  });

  test('an icon that is not a key, and an empty answer, are refused', async () => {
    // The icon column feeds a component lookup, never markup — a URL or
    // arbitrary text must die at the validation layer.
    const badIcon = await put(`/api/builder/landings/${pageId}/features`, tokens.owner, {
      items: [{ icon: 'https://evil.example/x.svg', title: 'X' }],
    });
    assert.equal(badIcon.status, 422);

    const noAnswer = await put(`/api/builder/landings/${pageId}/faqs`, tokens.owner, {
      items: [{ question: 'سؤال', answer: '' }],
    });
    assert.equal(noAnswer.status, 422);
  });

  test("another tenant's page is a 404 through both new sections", async () => {
    for (const section of ['features', 'faqs']) {
      const r = await put(`/api/builder/landings/${otherPageId}/${section}`, tokens.owner, { items: [] });
      assert.equal(r.status, 404, `${section} must not reach another tenant`);
    }
  });

  test('the published page renders them, and the show* switches hide them', async () => {
    // Restore both lists (earlier tests replaced the FAQ down to one row).
    await put(`/api/builder/landings/${pageId}/features`, tokens.owner, {
      items: [{ icon: 'truck', title: 'توصيل خلال 48 ساعة' }],
    });
    await put(`/api/builder/landings/${pageId}/faqs`, tokens.owner, {
      items: [{ question: 'كم تستغرق مدة التوصيل؟', answer: 'من 24 إلى 72 ساعة.' }],
    });
    const on = await api(`/api/builder/landings/${pageId}/publish`, tokens.owner, {
      method: 'POST', body: JSON.stringify({ published: true }),
    });
    assert.equal(on.status, 200);

    // The CURRENT slug, read from the row — an earlier general-section test
    // renames this page's slug, and a path built from the fixture's original
    // one 404s for a reason that has nothing to do with what this asserts.
    const { slug: liveSlug } = await withTenant(tenant, (tx) =>
      (tx as any).landingPage.findUnique({ where: { id: pageId }, select: { slug: true } }),
    );
    const path = `/sec-a-${stamp}/${liveSlug}`;
    const live = await fetch(BASE + path);
    assert.equal(live.status, 200);
    const html = await live.text();
    // RENDERED markup, not the serialized data payload — the defect this
    // slice fixed was precisely "in the payload, in no markup". `>text<` only
    // matches an element's text; the flight payload holds JSON-escaped
    // strings and cannot satisfy it. `id="faq"` is the section's own wrapper.
    assert.match(html, /id="faq"/);
    assert.match(html, />كم تستغرق مدة التوصيل؟</);
    assert.match(html, />توصيل خلال 48 ساعة</);

    // The off switches. No API writes these yet (that is the next slice), so
    // set them the way a future write path would land them.
    await withTenant(tenant, (tx) =>
      (tx as any).landingSetting.upsert({
        where: { landingPageId: pageId },
        create: {
          tenantId: tenant, landingPageId: pageId,
          showFAQ: false, showFeatures: false, showReviews: false,
        },
        update: { showFAQ: false, showFeatures: false, showReviews: false },
      }),
    );
    const hidden = await fetch(BASE + path);
    const hiddenHtml = await hidden.text();
    // The same patterns that PROVED presence above now prove absence — an
    // absence assertion whose pattern never matched anything would be
    // vacuous, which is why both sides use identical shapes.
    assert.ok(!/id="faq"/.test(hiddenHtml), 'FAQ section must not render when showFAQ is off');
    assert.ok(!/>كم تستغرق مدة التوصيل؟</.test(hiddenHtml), 'FAQ markup must not render when showFAQ is off');
    assert.ok(!/>توصيل خلال 48 ساعة</.test(hiddenHtml), 'benefits markup must not render when showFeatures is off');

    // Leave the switches on for any test that follows.
    await withTenant(tenant, (tx) =>
      (tx as any).landingSetting.update({
        where: { landingPageId: pageId },
        data: { showFAQ: true, showFeatures: true, showReviews: true },
      }),
    );
  });
});

describe('the display and shipping toggles have real write paths (B2)', { skip }, () => {
  test('the order-form route persists the display toggles alone', async () => {
    const r = await patch(`/api/builder/landings/${pageId}/order-form`, tokens.owner, {
      showFAQ: false, stickyBuyButton: false, floatingWhatsapp: true,
    });
    assert.equal(r.status, 200);
    const s = await withTenant(tenant, (tx) =>
      (tx as any).landingSetting.findUnique({ where: { landingPageId: pageId } }),
    );
    assert.equal(s.showFAQ, false);
    assert.equal(s.stickyBuyButton, false);
    assert.equal(s.floatingWhatsapp, true);
    // Restore for anything that runs after.
    await patch(`/api/builder/landings/${pageId}/order-form`, tokens.owner, {
      showFAQ: true, stickyBuyButton: true, floatingWhatsapp: false,
    });
  });

  test('the shipping route persists freeShipping beside the methods', async () => {
    const r = await patch(`/api/builder/landings/${pageId}/shipping`, tokens.owner, {
      homeDeliveryEnabled: true, stopDeskEnabled: false, freeShipping: true,
    });
    assert.equal(r.status, 200);
    const s = await withTenant(tenant, (tx) =>
      (tx as any).landingSetting.findUnique({
        where: { landingPageId: pageId }, select: { freeShipping: true },
      }),
    );
    assert.equal(s.freeShipping, true);
    await patch(`/api/builder/landings/${pageId}/shipping`, tokens.owner, { freeShipping: false });
  });
});

describe('categories are manageable from the screen (B3)', { skip }, () => {
  test('the screen offers the write controls to a writer', async () => {
    const r = await fetch(`${BASE}/console/builder/categories`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="category-create-form"/);
  });

  test('deleting a category releases its pages instead of taking them along', async () => {
    const created = await api('/api/builder/categories', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ name: 'Doomed', slug: `doomed-${stamp}` }),
    });
    assert.equal(created.status, 201);
    const catId = created.body.data.id;

    const attach = await patch(`/api/builder/landings/${pageId}/general`, tokens.owner, {
      categoryId: catId,
    });
    assert.equal(attach.status, 200);

    const del = await api(`/api/builder/categories/${catId}`, tokens.owner, { method: 'DELETE' });
    assert.equal(del.status, 200);

    // The FK is SetNull by design: the page survives, uncategorised — which
    // is what the screen's delete hint promises.
    const row = await withTenant(tenant, (tx) =>
      (tx as any).landingPage.findUnique({ where: { id: pageId }, select: { categoryId: true } }),
    );
    assert.equal(row.categoryId, null);
  });
});

/* =============================================================================
 * LB.22 — a storefront theme taken from the product's own photograph.
 *
 * THE FEATURE IS NOT "FIND THE COLOURS". Averaging pixels is four lines. What
 * decides whether this is worth shipping is that the result must be READABLE:
 * an automatically generated theme that puts white text on a pale yellow buy
 * button ships a broken storefront to a real customer, and the merchant finds
 * out from their conversion rate rather than from the editor.
 *
 * So the assertions here are about CONTRAST, not about which blue came back.
 * The exact hue is allowed to change if the quantiser is ever tuned; the
 * promise that the buy button can be read is not.
 *
 * The refusals matter as much. An image with no subject colour — a white
 * cutout — must produce a refusal, because inventing a plausible theme from no
 * evidence is the worst outcome: it looks like it worked.
 * ========================================================================== */
describe('a theme can be built from a product image (LB.22)', () => {
  /** 32×32 solid deep blue. Generated with sharp, embedded so the test needs
   *  no image pipeline of its own. */
  const BLUE_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVR4nGMQsVlAU8QwaoHNaBAtGE1FIqMZbcFoUSEyWprajFY4IqNVps1oq2LBaMPLZrTpuGBQt64BMRXALgQ15h8AAAAASUVORK5CYII=',
    'base64',
  );
  /** 32×32 pure white — a product cutout, the case that must refuse. */
  const WHITE_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAOBhQAAAHqp8dLAAAAAElFTkSuQmCC',
    'base64',
  );

  const upload = async (png: Buffer, name: string) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
    const res = await fetch(BASE + '/api/builder/upload', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
      body: form,
    });
    return { status: res.status, body: await res.json() };
  };

  /** WCAG relative luminance and contrast, computed independently of the
   *  implementation so this asserts the RESULT rather than restating the code. */
  const contrast = (a: string, b: string) => {
    const lum = (hex: string) => {
      const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const [r, g, bl] = ch.map(f);
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  test('a coloured photograph becomes a theme whose text can be read', async () => {
    const up = await upload(BLUE_PNG, 'hero.png');
    assert.equal(up.status, 200);

    const res = await api('/api/builder/themes/from-image', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ imageUrl: up.body.data.url, name: `Extracted ${stamp}` }),
    });
    assert.equal(res.status, 201);
    const theme = res.body.data;

    // Every colour is a hex triple — a malformed one would reach the storefront
    // as an invalid CSS value and simply not apply.
    for (const key of ['primary', 'primaryForeground', 'accent', 'background', 'card', 'text', 'muted', 'border']) {
      assert.match(theme[key], /^#[0-9a-f]{6}$/, `${key} is not a hex colour: ${theme[key]}`);
    }

    // THE TWO THAT CARRY TEXT. 4.5 is WCAG AA for body text; the buy button's
    // label is large and bold, so 3.0 would pass — this holds it to the
    // stricter bar because the label is the one thing on the page that must
    // never be hard to read.
    assert.ok(
      contrast(theme.primary, theme.primaryForeground) >= 4.5,
      `buy button contrast ${contrast(theme.primary, theme.primaryForeground).toFixed(2)} is too low`,
    );
    assert.ok(
      contrast(theme.background, theme.text) >= 4.5,
      `page text contrast ${contrast(theme.background, theme.text).toFixed(2)} is too low`,
    );

    // It is the tenant's own theme, so it can be renamed or deleted like the
    // copies they already have — not a built-in masquerading as one.
    assert.equal(theme.isBuiltIn, false);

    // And it is a real row, so the General section's picker can offer it.
    const list = await api('/api/builder/themes', tokens.owner);
    assert.ok(list.body.data.items.some((x: { id: string }) => x.id === theme.id));
  });

  test('an image with no colour is refused, not guessed at', async () => {
    const up = await upload(WHITE_PNG, 'cutout.png');
    assert.equal(up.status, 200);

    const res = await api('/api/builder/themes/from-image', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ imageUrl: up.body.data.url, name: 'Should not exist' }),
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NO_COLOURS');
  });

  test('another tenant’s image cannot be read through this route', async () => {
    const up = await upload(BLUE_PNG, 'mine.png');
    assert.equal(up.status, 200);

    // The URL carries a tenant id, and the storage layer has no idea who is
    // asking — so the route checks the owner segment against the caller. Without
    // that check this would hand back a competitor's product photograph.
    const res = await api('/api/builder/themes/from-image', tokens.other, {
      method: 'POST',
      body: JSON.stringify({ imageUrl: up.body.data.url, name: 'Stolen' }),
    });
    assert.equal(res.status, 404);
  });

  test('an absolute URL is refused, so this is not a fetcher', async () => {
    // Without the `/uploads/` prefix check the route would fetch anything the
    // server can reach, which is an SSRF primitive with a colour picker on it.
    const res = await api('/api/builder/themes/from-image', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'http://169.254.169.254/latest/meta-data/', name: 'x' }),
    });
    assert.equal(res.status, 404);
  });
});

/* =============================================================================
 * LB.20 — a delivery price that belongs to ONE product.
 *
 * THE ASSERTION THAT MATTERS IS THE THIRD ONE. A per-product price is only safe
 * if the number the customer is SHOWN and the number they are CHARGED come from
 * the same place. Two endpoints read delivery prices — `/wilayas` fills the
 * destination dropdown, `/orders` prices the sale — and before this slice each
 * built its own query. A feature that let them diverge would bill people
 * something other than what they agreed to, and no suite over either route
 * alone would notice.
 *
 * Absence is the other half of the contract: a wilaya with no override must
 * fall back to the company's price — not become free, and not become
 * undeliverable.
 * ========================================================================== */
describe('a product can carry its own delivery prices (LB.20)', () => {
  const COMPANY_HOME = '400';
  const COMPANY_DESK = '250';
  const OVERRIDE_HOME = '1500';
  let slug = '';

  before(async () => {
    if (skip) return;
    slug = (await asPlatform().tenant.findUnique({
      where: { id: tenant }, select: { slug: true },
    }))!.slug;

    /* The company's own rates, which the override must beat on wilaya 1 and
       wilaya 16 must keep. Written directly: this suite's tenant is created
       bare, and the point of the test is the override, not the settings screen. */
    await withTenant(tenant, async (tx) => {
      for (const wilayaId of [1, 16]) {
        await (tx as any).tenantDeliveryPrice.upsert({
          where: { tenantId_wilayaId: { tenantId: tenant, wilayaId } },
          update: { homePrice: COMPANY_HOME, deskPrice: COMPANY_DESK },
          create: { tenantId: tenant, wilayaId, homePrice: COMPANY_HOME, deskPrice: COMPANY_DESK },
        });
      }
    });

    // The page has to be published for the storefront routes to price it.
    await api(`/api/builder/landings/${pageId}/publish`, tokens.owner, { method: 'POST' });
  });

  after(async () => {
    if (skip) return;
    await api(`/api/builder/landings/${pageId}/delivery-prices`, tokens.owner, {
      method: 'PUT',
      body: JSON.stringify({ items: [] }),
    });
  });

  test('with no override, the page carries none and the company’s price applies', async () => {
    const r = await api(`/api/builder/landings/${pageId}/delivery-prices`, tokens.owner);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.items, []);

    const quoted = await (await fetch(
      `${BASE}/api/storefront/${slug}/wilayas?landingPageId=${pageId}`,
    )).json();
    const w1 = quoted.data.items.find((w: { id: number }) => w.id === 1);
    assert.equal(w1.homePrice, COMPANY_HOME);
  });

  test('an override changes what the customer is QUOTED, for that page only', async () => {
    const put = await api(`/api/builder/landings/${pageId}/delivery-prices`, tokens.owner, {
      method: 'PUT',
      body: JSON.stringify({ items: [{ wilayaId: 1, homePrice: OVERRIDE_HOME, deskPrice: '900' }] }),
    });
    assert.equal(put.status, 200);

    const quoted = await (await fetch(
      `${BASE}/api/storefront/${slug}/wilayas?landingPageId=${pageId}`,
    )).json();
    assert.equal(quoted.data.items.find((w: { id: number }) => w.id === 1).homePrice, OVERRIDE_HOME);

    // Wilaya 16 has no override and must keep the company's rate — the
    // override is a layer, not a replacement.
    assert.equal(quoted.data.items.find((w: { id: number }) => w.id === 16).homePrice, COMPANY_HOME);

    // Without the page id the route still answers the COMPANY's rates, so an
    // older client is unaffected and the price is genuinely per-product.
    const plain = await (await fetch(`${BASE}/api/storefront/${slug}/wilayas`)).json();
    assert.equal(plain.data.items.find((w: { id: number }) => w.id === 1).homePrice, COMPANY_HOME);
  });

  test('and the customer is CHARGED exactly what they were quoted', async () => {
    const quoted = await (await fetch(
      `${BASE}/api/storefront/${slug}/wilayas?landingPageId=${pageId}`,
    )).json();
    const w1 = quoted.data.items.find((w: { id: number }) => w.id === 1);

    const res = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        landingPageId: pageId,
        customerName: `LB20 ${stamp}`,
        phone: '0555010203',
        wilayaId: 1,
        baladiaName: w1.baladias[0].name,
        quantity: 1,
        variantIds: [],
        shippingMethod: 'HOME',
      }),
    });
    assert.equal(res.status, 201);
    const created = await res.json();

    // The stored commercial snapshot, not the response summary: the frozen row
    // is what the merchant ships against and what the ERP bills.
    const order = await api(`/api/builder/orders/${created.data.id}`, tokens.owner);
    assert.equal(
      order.body.data.shippingPrice,
      w1.homePrice,
      'the charged shipping differs from the quoted shipping',
    );
    assert.notEqual(
      order.body.data.shippingPrice,
      COMPANY_HOME,
      'the override was ignored and the company rate was charged',
    );
  });

  test('one wilaya cannot be priced twice, and an unknown one is refused', async () => {
    const dup = await api(`/api/builder/landings/${pageId}/delivery-prices`, tokens.owner, {
      method: 'PUT',
      body: JSON.stringify({
        items: [{ wilayaId: 1, homePrice: '100' }, { wilayaId: 1, homePrice: '200' }],
      }),
    });
    assert.equal(dup.status, 422);
    assert.equal(dup.body.error.code, 'DUPLICATE_WILAYA');

    const unknown = await api(`/api/builder/landings/${pageId}/delivery-prices`, tokens.owner, {
      method: 'PUT',
      body: JSON.stringify({ items: [{ wilayaId: 9999, homePrice: '100' }] }),
    });
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.error.code, 'UNKNOWN_DESTINATION');
  });

  test('another tenant cannot price this page', async () => {
    const r = await api(`/api/builder/landings/${pageId}/delivery-prices`, tokens.other, {
      method: 'PUT',
      body: JSON.stringify({ items: [{ wilayaId: 1, homePrice: '1' }] }),
    });
    assert.equal(r.status, 404);
  });
});

/* =============================================================================
 * LB.21 — a landing page becomes a catalogue product.
 *
 * THE TWO ASSERTIONS THAT MATTER ARE IDEMPOTENCY AND ADOPTION, because both are
 * ways this could quietly corrupt a catalogue rather than fail loudly:
 *
 *   - "Send all" is a button somebody presses twice. A second run must UPDATE,
 *     not insert twins.
 *   - A merchant who already typed their products in by hand must not end up
 *     with two rows per product. Two catalogue rows answering to one normalised
 *     name make every order naming it attributable to NEITHER — the counters
 *     stop moving and revenue would be counted twice, once per row. That is
 *     what `duplicateProductNames` exists to detect, and a naive importer
 *     produces exactly it on the first run for every product they already had.
 *
 * These run against the tenant that owns BOTH products, because the two the
 * suite uses elsewhere are deliberately builder-only.
 * ========================================================================== */
describe('landing pages can be published into the catalogue (LB.21)', { skip }, () => {
  test('a published page becomes a catalogue product, once', async () => {
    const first = await api('/api/builder/publish-to-erp', tokens.both, {
      method: 'POST',
      body: JSON.stringify({ scope: 'one', landingPageId: bothPageId }),
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.items.length, 1);
    assert.equal(first.body.data.created, 1);
    const productId = first.body.data.items[0].productId;

    // Second run: the SAME row, updated. Not a twin.
    const second = await api('/api/builder/publish-to-erp', tokens.both, {
      method: 'POST',
      body: JSON.stringify({ scope: 'one', landingPageId: bothPageId }),
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.created, 0, 'a second run created a duplicate');
    assert.equal(second.body.data.updated, 1);
    assert.equal(second.body.data.items[0].productId, productId);
  });

  test('an existing catalogue product with the same name is adopted, not duplicated', async () => {
    const name = `Adoptable ${stamp}`;
    const typed = await api('/api/erp/products', tokens.both, {
      method: 'POST',
      body: JSON.stringify({ name, costPrice: '1234' }),
    });
    assert.equal(typed.status, 201);
    const typedId = typed.body.data.id;

    const page = await withTenant(bothTenant, (tx) =>
      (tx as any).landingPage.create({
        data: {
          tenantId: bothTenant, title: name, slug: `adoptable-${stamp}`,
          price: 9000, published: true,
        },
        select: { id: true },
      }),
    );

    const res = await api('/api/builder/publish-to-erp', tokens.both, {
      method: 'POST',
      body: JSON.stringify({ scope: 'one', landingPageId: page.id }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.adopted, 1, 'the existing product was not adopted');
    assert.equal(res.body.data.created, 0, 'a duplicate was created alongside it');
    assert.equal(res.body.data.items[0].productId, typedId);

    /* AND THE MANAGER'S OWN COLUMNS SURVIVE. The landing page is the authority
       for name, description, price and image — not for the cost basis, which a
       manager maintains and every profit figure derives from. An import that
       reset it to zero would corrupt the books silently, which is the failure
       the create route once had. */
    const after = await api(`/api/erp/products/${typedId}`, tokens.both);
    assert.equal(String(after.body.data.costPrice), '1234');
    // The page IS the authority for price, so that one moved.
    assert.equal(String(after.body.data.price), '9000');
  });

  test('“all” takes the published pages and leaves drafts alone', async () => {
    const draft = await withTenant(bothTenant, (tx) =>
      (tx as any).landingPage.create({
        data: {
          tenantId: bothTenant, title: `Draft ${stamp}`,
          slug: `draft-${stamp}`, price: 100, published: false,
        },
        select: { id: true },
      }),
    );

    const r = await api('/api/builder/publish-to-erp', tokens.both, {
      method: 'POST',
      body: JSON.stringify({ scope: 'all' }),
    });
    assert.equal(r.status, 200);
    const touched = r.body.data.items.map((i: { landingPageId: string }) => i.landingPageId);
    assert.ok(touched.includes(bothPageId), 'a published page was skipped');
    assert.ok(
      !touched.includes(draft.id),
      'a draft was published into the catalogue — half-written experiments do not belong there',
    );
  });

  test('a builder-only tenant is refused rather than given a catalogue', async () => {
    const r = await api('/api/builder/publish-to-erp', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ scope: 'all' }),
    });
    // 403 from the permission gate or 409 NO_ERP from the entitlement gate —
    // which fires depends on the role. What must never happen is a 200 that
    // writes into a catalogue the company does not have.
    assert.ok(r.status === 403 || r.status === 409, `unexpected ${r.status}`);
  });

  test('naming another tenant’s page is a 404, not a cross-tenant write', async () => {
    const r = await api('/api/builder/publish-to-erp', tokens.both, {
      method: 'POST',
      body: JSON.stringify({ scope: 'one', landingPageId: otherPageId }),
    });
    assert.equal(r.status, 404);
  });
});
