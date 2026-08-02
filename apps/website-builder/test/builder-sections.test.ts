import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

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
    if (key === 'owner') tenant = t.id; else otherTenant = t.id;
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
    for (const t of [tenant, otherTenant, unentitledTenant].filter(Boolean)) {
      await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId: id } }));
    }
    await asPlatform().user.delete({ where: { id } }).catch(() => {});
  }
  await asPlatform().tenant.deleteMany({ where: { id: { in: [tenant, otherTenant, unentitledTenant].filter(Boolean) } } });
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
  const screens = ['/builder/pages', '/builder/orders', '/builder/categories', '/builder/abandoned'];
  const tables = ['landings-table', 'orders-table', 'categories-table', 'abandoned-table'];

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
    const r = await fetch(BASE + '/builder/orders', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    });
    const html = await r.text();
    // The order was moved to CANCELLED earlier in this file, which maps to the
    // danger tone in @landingos/ui — the same tone the ERP will use.
    assert.match(html, /data-status="CANCELLED"/);
    assert.match(html, /var\(--danger-fg\)/);
  });
});
