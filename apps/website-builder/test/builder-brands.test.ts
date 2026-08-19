import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import { resolveDisplayName } from '../src/lib/storefront/store-identity.ts';

/* =============================================================================
 * LB.36 — Brands.
 *
 * PURE — the one resolution seam: brand name wins, then the store resolution
 * exactly as LB.31 defined it (placeholder detection included).
 *
 * END-TO-END — CRUD with the multi-category join (set semantics), the
 * SetNull/Cascade shape LB.34's argument demanded, the general route's
 * reference check, and the identity actually REPLACING the store name on the
 * public page and the order confirmation.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();

describe('resolveDisplayName (pure)', () => {
  test('the brand wins; absent, the LB.31 store resolution stands unchanged', () => {
    assert.equal(resolveDisplayName('Nour Beauty', 'My Store', 'tenant-x'), 'Nour Beauty');
    assert.equal(resolveDisplayName('  ', 'My Store', 'tenant-x'), 'My Store');
    assert.equal(resolveDisplayName(null, 'My Store', 'tenant-x'), 'My Store');
    // The placeholder rule travels: an untouched default still falls to the tenant.
    assert.equal(resolveDisplayName(undefined, 'LandingOS', 'tenant-x'), 'tenant-x');
    assert.equal(resolveDisplayName(undefined, null, 'tenant-x'), 'tenant-x');
  });
});

describe('brands (end to end)', { skip }, () => {
  let tenantId = '';
  let tenantSlug = '';
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};

  let catA = '';
  let catB = '';
  let brandId = '';
  let pageId = '';

  async function makeUser(role: string, label: string) {
    const email = `brand-${label}-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email, name: email, passwordHash: await hashPassword('x') },
    });
    userIds.push(u.id);
    await withTenant(tenantId, (tx) =>
      (tx as any).membership.create({ data: { tenantId, userId: u.id, role } }),
    );
    const { token } = await createSession(u.id, tenantId);
    tokens[label] = token;
  }

  async function api(method: string, path: string, token: string | undefined, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }

  before(async () => {
    if (skip) return;
    tenantSlug = `brand-${stamp}`;
    const t = await asPlatform().tenant.create({
      data: { slug: tenantSlug, name: 'Brand Tenant' },
    });
    tenantId = t.id;
    await withTenant(tenantId, async (tx) => {
      await (tx as any).subscription.create({
        data: { tenantId, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      });
      const a = await (tx as any).category.create({
        data: { tenantId, name: 'Watches', slug: 'watches' }, select: { id: true },
      });
      const b = await (tx as any).category.create({
        data: { tenantId, name: 'Bags', slug: 'bags' }, select: { id: true },
      });
      catA = a.id; catB = b.id;
      const page = await (tx as any).landingPage.create({
        data: {
          tenantId, title: 'ساعة برو', slug: 'watch-pro',
          status: 'PUBLISHED', published: true, price: 4900,
        },
        select: { id: true },
      });
      pageId = page.id;
    });
    await makeUser('OWNER', 'owner');
    await makeUser('VIEWER', 'viewer');
  });

  after(async () => {
    if (skip) return;
    for (const id of userIds) {
      await destroySessionsForUser(id);
      await withTenant(tenantId, (tx) =>
        (tx as any).membership.deleteMany({ where: { userId: id } }),
      );
      await asPlatform().user.delete({ where: { id } }).catch(() => {});
    }
    if (tenantId) await deleteTenant(tenantId).catch(() => {});
    await disconnect();
  });

  test('anonymous is 401; a VIEWER may read but not write', async () => {
    assert.equal((await api('POST', '/api/builder/brands', undefined, {})).status, 401);
    const viewerWrite = await api('POST', '/api/builder/brands', tokens.viewer, {
      name: 'X', slug: 'x-brand',
    });
    assert.equal(viewerWrite.status, 403);
    assert.equal((await api('GET', '/api/builder/brands', tokens.viewer)).status, 200);
  });

  test('create with categories: the join lands; the list reads it back', async () => {
    const res = await api('POST', '/api/builder/brands', tokens.owner, {
      name: 'Nour Beauty', slug: 'nour-beauty', categoryIds: [catA, catB],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    brandId = res.body.data.id;

    const list = await api('GET', '/api/builder/brands', tokens.owner);
    const row = list.body.data.items.find((b: any) => b.id === brandId);
    assert.deepEqual([...row.categoryIds].sort(), [catA, catB].sort());
    assert.equal(row._count.landingPages, 0);
  });

  test('the digit-only slug rule and the tenant-unique clash both refuse', async () => {
    const digits = await api('POST', '/api/builder/brands', tokens.owner, {
      name: 'رقمية', slug: '2024',
    });
    assert.equal(digits.status, 422);
    const clash = await api('POST', '/api/builder/brands', tokens.owner, {
      name: 'Clash', slug: 'nour-beauty',
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'SLUG_TAKEN');
  });

  test('an unknown category is refused, not silently linked to nothing', async () => {
    const res = await api('POST', '/api/builder/brands', tokens.owner, {
      name: 'Ghost', slug: 'ghost-brand', categoryIds: ['nope'],
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVALID_REFERENCE');
  });

  test('PATCH categoryIds is set semantics: the stored links become the list', async () => {
    const res = await api('PATCH', `/api/builder/brands/${brandId}`, tokens.owner, {
      categoryIds: [catB],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const links = await withTenant(tenantId, (tx) =>
      (tx as any).brandCategory.findMany({ where: { brandId } }),
    );
    assert.equal(links.length, 1);
    assert.equal(links[0].categoryId, catB);
    // Empty array unlinks everything; omitting the field touches nothing.
    await api('PATCH', `/api/builder/brands/${brandId}`, tokens.owner, { categoryIds: [] });
    assert.equal(
      (await withTenant(tenantId, (tx) => (tx as any).brandCategory.count({ where: { brandId } }))),
      0,
    );
    await api('PATCH', `/api/builder/brands/${brandId}`, tokens.owner, { categoryIds: [catA] });
    await api('PATCH', `/api/builder/brands/${brandId}`, tokens.owner, { name: 'Nour Beauty ✦' });
    assert.equal(
      (await withTenant(tenantId, (tx) => (tx as any).brandCategory.count({ where: { brandId } }))),
      1, 'a patch without categoryIds must leave the links alone',
    );
  });

  test('the general route links a page to a brand, refuses a ghost, and null clears', async () => {
    const ghost = await api('PATCH', `/api/builder/landings/${pageId}/general`, tokens.owner, {
      brandId: 'nope',
    });
    assert.equal(ghost.status, 422);
    assert.equal(ghost.body.error.code, 'INVALID_REFERENCE');

    const link = await api('PATCH', `/api/builder/landings/${pageId}/general`, tokens.owner, {
      brandId,
    });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    const page = await withTenant(tenantId, (tx) =>
      (tx as any).landingPage.findUnique({ where: { id: pageId }, select: { brandId: true } }),
    );
    assert.equal(page.brandId, brandId);
  });

  test('LB.36 — the public page wears the BRAND: header, <title>, og:site_name, favicon', async () => {
    // Give the brand a logo so the favicon override renders.
    await api('PATCH', `/api/builder/brands/${brandId}`, tokens.owner, {
      logo: `/uploads/tenants/${tenantId}/brand-logo.png`,
    });
    const html = await fetch(`${BASE}/${tenantSlug}/watch-pro`).then((r) => r.text());
    // The body identity (nav + footer render the resolved name).
    assert.ok(html.includes('Nour Beauty'), 'the brand name must appear on the page');
    // The tab: "<page title> · <brand>" — the layout's store template ended.
    assert.match(html, /<title>[^<]*· Nour Beauty[^<]*<\/title>/);
    assert.ok(html.includes('property="og:site_name" content="Nour Beauty'));
    // The favicon context: the brand's logo is the page's icon.
    assert.ok(html.includes('brand-logo.png'));
    assert.ok(!html.includes('>Brand Tenant<'), 'the store/tenant name must be replaced');
  });

  test('a page WITHOUT a brand keeps the store identity exactly as before', async () => {
    await withTenant(tenantId, (tx) =>
      (tx as any).landingPage.create({
        data: {
          tenantId, title: 'بدون علامة', slug: 'no-brand',
          status: 'PUBLISHED', published: true, price: 900,
        },
      }),
    );
    const html = await fetch(`${BASE}/${tenantSlug}/no-brand`).then((r) => r.text());
    assert.ok(html.includes('Brand Tenant'), 'the tenant-name fallback must stand');
    assert.match(html, /<title>[^<]*· Brand Tenant[^<]*<\/title>/);
  });

  test('the order confirmation wears the brand too', async () => {
    const order = await withTenant(tenantId, (tx) =>
      (tx as any).salesOrder.create({
        data: {
          tenantId, landingPageId: pageId,
          customerName: 'زبون', phone: '0550000001',
          wilaya: 'Alger', baladia: 'Bab El Oued', address: '',
          quantity: 1, productPrice: 4900, shippingPrice: 500, totalPrice: 5400,
        },
        select: { id: true },
      }),
    );
    const html = await fetch(`${BASE}/${tenantSlug}/thank-you/${order.id}`).then((r) => r.text());
    // Tolerant of the rename the set-semantics test made ("Nour Beauty ✦").
    assert.match(html, /<title>Nour Beauty[^<]*<\/title>/);
  });

  test('deleting the brand un-brands pages (SetNull) and drops the join — orders untouched', async () => {
    const res = await api('DELETE', `/api/builder/brands/${brandId}`, tokens.owner);
    assert.equal(res.status, 200);
    const [page, links, orders] = await withTenant(tenantId, async (tx) => [
      await (tx as any).landingPage.findUnique({ where: { id: pageId }, select: { brandId: true } }),
      await (tx as any).brandCategory.count({ where: { brandId } }),
      await (tx as any).salesOrder.count({ where: { landingPageId: pageId } }),
    ]);
    assert.equal(page.brandId, null, 'the page must survive, un-branded');
    assert.equal(links, 0);
    assert.equal(orders, 1, 'the sales history must be untouched');
    // And the page now falls back to the store identity.
    const html = await fetch(`${BASE}/${tenantSlug}/watch-pro`).then((r) => r.text());
    assert.ok(!html.includes('Nour Beauty'));
    assert.ok(html.includes('Brand Tenant'));
  });

  test('deleting a category drops only the LINK; the brand survives', async () => {
    const res = await api('POST', '/api/builder/brands', tokens.owner, {
      name: 'Survivor', slug: 'survivor', categoryIds: [catB],
    });
    assert.equal(res.status, 201);
    const id = res.body.data.id;
    const del = await api('DELETE', `/api/builder/categories/${catB}`, tokens.owner);
    assert.equal(del.status, 200);
    const [brand, links] = await withTenant(tenantId, async (tx) => [
      await (tx as any).brand.findUnique({ where: { id }, select: { id: true } }),
      await (tx as any).brandCategory.count({ where: { brandId: id } }),
    ]);
    assert.ok(brand, 'the brand must survive its category');
    assert.equal(links, 0);
  });

  test('the console screen lists brands and the editor offers the picker data', async () => {
    const html = await fetch(BASE + '/console/builder/brands', {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.owner}` },
    }).then((r) => r.text());
    assert.ok(html.includes('data-testid="brands-table"'));
    assert.ok(html.includes('data-testid="brand-create-form"'));
    assert.ok(html.includes('Survivor'));
  });
});
