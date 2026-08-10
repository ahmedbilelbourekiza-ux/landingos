import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect } from '@landingos/db';

/* =============================================================================
 * The public storefront (M-17, R-08).
 *
 * Anonymous by design — a customer has no account — which makes these the most
 * carefully bounded routes in the platform. The tenant comes from the URL, and
 * every assertion below is about what that binding must NOT allow: another
 * tenant's product, an unpublished draft, a forged price, an undeliverable
 * destination, or a reserved slug shadowing the platform.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();
const slugA = `shop-a-${stamp}`;
const slugB = `shop-b-${stamp}`;
let tenantA = '';
let tenantB = '';
let publishedA = '';
let draftA = '';
let publishedB = '';
let wilayaId = 0;

async function get(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...init });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, text };
}

const post = (path: string, data: unknown) =>
  get(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

before(async () => {
  if (skip) return;

  for (const [slug, ref] of [[slugA, 'A'], [slugB, 'B']] as const) {
    const t = await asPlatform().tenant.create({ data: { slug, name: `Shop ${ref}` } });
    if (ref === 'A') tenantA = t.id; else tenantB = t.id;

    await withTenant(t.id, async (db) => {
      await (db as any).subscription.create({
        data: { tenantId: t.id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      });

      const pub = await (db as any).landingPage.create({
        data: {
          tenantId: t.id, title: `Product ${ref}`, slug: 'shared-item',
          price: 3000, published: true, status: 'PUBLISHED',
        },
        select: { id: true },
      });
      if (ref === 'A') publishedA = pub.id; else publishedB = pub.id;

      if (ref === 'A') {
        const d = await (db as any).landingPage.create({
          data: { tenantId: t.id, title: 'Secret Draft', slug: 'secret-draft', price: 999 },
          select: { id: true },
        });
        draftA = d.id;

        // Only tenant A prices a destination. B prices nothing, which is what
        // makes "undeliverable" testable.
        const w = await (db as any).wilaya.findFirst({ orderBy: { code: 'asc' }, select: { id: true } });
        wilayaId = w.id;
        await (db as any).tenantDeliveryPrice.create({
          data: { tenantId: t.id, wilayaId: w.id, homePrice: 500, deskPrice: 300 },
        });
      }
    });
  }
});

after(async () => {
  if (skip) return;
  await asPlatform().tenant.deleteMany({ where: { id: { in: [tenantA, tenantB].filter(Boolean) } } });
  await disconnect();
});

describe('a storefront is reachable at its own slug', { skip }, () => {
  test('the homepage lists only that tenant\'s published products', async () => {
    const a = await get(`/${slugA}`);
    assert.equal(a.status, 200);
    assert.match(a.text, /data-testid="storefront-products"/);
    assert.match(a.text, /Product A/);
    assert.ok(!/Product B/.test(a.text), "another store's product must not appear");
    assert.ok(!/Secret Draft/.test(a.text), 'an unpublished draft must not appear');
  });

  test('a published page renders through the shared template', async () => {
    const r = await get(`/${slugA}/shared-item`);
    assert.equal(r.status, 200);
    assert.match(r.text, /data-page-slug="shared-item"/);
    assert.match(r.text, /data-tenant="/);
  });

  test('both tenants serve the SAME slug, each their own product', async () => {
    // The whole point of per-tenant uniqueness (M-04): two shops may both sell
    // /shared-item, and neither can see the other's.
    const a = await get(`/${slugA}/shared-item`);
    const b = await get(`/${slugB}/shared-item`);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.match(a.text, /Product A/);
    assert.match(b.text, /Product B/);
    assert.ok(!/Product B/.test(a.text));
  });

  test('an unpublished page is not reachable by URL', async () => {
    const r = await get(`/${slugA}/secret-draft`);
    assert.equal(r.status, 404, 'the binding decides whose rows; publication decides which');
  });

  test('an unknown store and an unknown product both 404', async () => {
    assert.equal((await get(`/no-such-store-${stamp}`)).status, 404);
    assert.equal((await get(`/${slugA}/no-such-product`)).status, 404);
  });
});

describe('reserved slugs cannot be shadowed by a storefront (R-08)', { skip }, () => {
  test('platform paths still resolve to the platform', async () => {
    // If a tenant slug could shadow these, one company would break the
    // platform for everybody.
    const login = await get('/console/login');
    assert.equal(login.status, 200, '/console/login belongs to the platform');

    const api = await get('/api/builder/landings');
    assert.equal(api.status, 401, '/api is the platform API, not a store');
  });

  test('a reserved word is never resolved as a tenant', async () => {
    for (const reserved of ['console', 'api']) {
      const r = await get(`/${reserved}/anything-at-all`);
      assert.notEqual(r.status, 200, `/${reserved} must not serve a storefront`);
    }
  });
});

describe('checkout never trusts a price from the client', { skip }, () => {
  test('an order is priced from the tenant\'s own rows', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA,
      customerName: 'Test Customer',
      phone: '0555000111',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 2,
      shippingMethod: 'HOME',
    });
    assert.equal(r.status, 201);
    // 3000 x 2 + 500 delivery. Nothing in the request said so.
    assert.equal(r.body.data.total, '6500');
  });

  test('a forged total in the body changes nothing', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA,
      customerName: 'Bargain Hunter',
      phone: '0555000222',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 1,
      shippingMethod: 'HOME',
      // All ignored.
      totalPrice: 1, productPrice: 1, shippingPrice: 0, price: 1,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.total, '3500', 'the server recomputed the price');
  });

  test('decimal prices survive quantity arithmetic without float dust (M-06)', async () => {
    // 1999.9 and 0.2 are both inexact as binary floats: computed as Numbers,
    // (1999.9 + 0.2) × 3 + 500 stores 6500.299999999… into the permanent
    // commercial snapshot. The route must do this arithmetic in Decimal.
    const { pageId, variantId } = await withTenant(tenantA, async (db) => {
      const p = await (db as any).landingPage.create({
        data: {
          tenantId: tenantA, title: 'Decimal Product', slug: `decimal-${stamp}`,
          price: 1999.9, published: true, status: 'PUBLISHED',
        },
        select: { id: true },
      });
      const v = await (db as any).landingVariant.create({
        data: { tenantId: tenantA, landingPageId: p.id, name: 'Size', value: 'XL', extraPrice: 0.2 },
        select: { id: true },
      });
      return { pageId: p.id, variantId: v.id };
    });

    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: pageId,
      customerName: 'Decimal Buyer',
      phone: '0555000777',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 3,
      variantIds: [variantId],
      shippingMethod: 'HOME',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.total, '6500.3', '(1999.9 + 0.2) × 3 + 500, exactly');

    const stored = await withTenant(tenantA, (db) =>
      (db as any).salesOrder.findFirst({
        where: { landingPageId: pageId },
        select: { totalPrice: true, productPrice: true },
      }),
    );
    assert.equal(String(stored.totalPrice), '6500.3', 'the snapshot carries no dust');
    assert.equal(String(stored.productPrice), '2000.1');
  });

  test('another tenant\'s product cannot be ordered through this store', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedB,
      customerName: 'Cross Tenant',
      phone: '0555000333',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 1,
    });
    assert.equal(r.status, 404);
  });

  test('an unpublished product cannot be ordered', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: draftA,
      customerName: 'Draft Buyer',
      phone: '0555000444',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 1,
    });
    assert.equal(r.status, 404);
  });

  test('an unpriced wilaya is undeliverable, not free', async () => {
    // Shop B priced nothing at all.
    const r = await post(`/api/storefront/${slugB}/orders`, {
      landingPageId: publishedB,
      customerName: 'Hopeful',
      phone: '0555000555',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 1,
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'UNDELIVERABLE');
  });

  test('a shipping method the product does not offer is refused', async () => {
    // Stop desk is off by default.
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA,
      customerName: 'Desk Please',
      phone: '0555000666',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 1,
      shippingMethod: 'DESK',
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'METHOD_UNAVAILABLE');
  });

  test('a malformed order is rejected without a stack trace', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, { landingPageId: publishedA });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
    assert.ok(!/at \w+ \(/.test(JSON.stringify(r.body)), 'no internals leak to a customer');
  });

  test('the order reaches the tenant with a complete history', async () => {
    const orders = await withTenant(tenantA, (db) =>
      (db as any).salesOrder.findMany({
        where: { customerName: 'Test Customer' },
        include: { statusHistory: true },
      }),
    );
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'NEW');
    // The initial state is on the trail, so history is complete from the first
    // row rather than starting at the first change.
    assert.equal(orders[0].statusHistory.length, 1);
    assert.equal(orders[0].statusHistory[0].fromStatus, null);
    assert.equal(orders[0].statusHistory[0].toStatus, 'NEW');
  });

  test('the thank-you page shows the order, and only within its store', async () => {
    const order = await withTenant(tenantA, (db) =>
      (db as any).salesOrder.findFirst({ where: { customerName: 'Test Customer' }, select: { id: true } }),
    );

    const mine = await get(`/${slugA}/thank-you/${order.id}`);
    assert.equal(mine.status, 200);
    assert.match(mine.text, /data-testid="thank-you"/);
    // It deliberately does not echo the phone number back onto a shareable page.
    assert.ok(!mine.text.includes('0555000111'), 'no phone number on the confirmation');

    const theirs = await get(`/${slugB}/thank-you/${order.id}`);
    assert.equal(theirs.status, 404, 'another store cannot display it');
  });
});

describe('the public destination list only offers what works', { skip }, () => {
  test('it lists priced wilayas with their communes', async () => {
    const r = await get(`/api/storefront/${slugA}/wilayas`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.items.length, 1, 'only the one wilaya this shop priced');
    assert.ok(r.body.data.items[0].baladias.length > 0, 'communes come with it');
    assert.equal(typeof r.body.data.items[0].homePrice, 'string', 'Decimal stays a string');
  });

  test('a shop that has priced nothing offers nothing', async () => {
    const r = await get(`/api/storefront/${slugB}/wilayas`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.items, []);
  });

  test('an unknown store is a 404', async () => {
    assert.equal((await get(`/api/storefront/nope-${stamp}/wilayas`)).status, 404);
  });
});

describe('abandoned-checkout capture fails silently', { skip }, () => {
  test('a valid capture is stored against the tenant', async () => {
    const token = `tok-${stamp}-abc12345`;
    const r = await post(`/api/storefront/${slugA}/draft-orders`, {
      token, landingPageId: publishedA, customerName: 'Half Typed', phone: '05551',
    });
    assert.equal(r.status, 204);

    const drafts = await withTenant(tenantA, (db) =>
      (db as any).draftOrder.findMany({ where: { token } }),
    );
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].customerName, 'Half Typed');
  });

  test('repeat captures update one row rather than creating many', async () => {
    const token = `tok-${stamp}-repeat01`;
    for (const name of ['H', 'Ha', 'Has']) {
      await post(`/api/storefront/${slugA}/draft-orders`, {
        token, landingPageId: publishedA, customerName: name,
      });
    }
    const drafts = await withTenant(tenantA, (db) =>
      (db as any).draftOrder.findMany({ where: { token } }),
    );
    assert.equal(drafts.length, 1, 'the token is the upsert key');
    assert.equal(drafts[0].customerName, 'Has');
  });

  test('junk, an unknown store and a foreign page all return 204', async () => {
    // A customer must never see an error from a background capture.
    assert.equal((await post(`/api/storefront/${slugA}/draft-orders`, {})).status, 204);
    assert.equal((await post(`/api/storefront/nope-${stamp}/draft-orders`, {})).status, 204);

    const token = `tok-${stamp}-foreign1`;
    assert.equal(
      (await post(`/api/storefront/${slugA}/draft-orders`, { token, landingPageId: publishedB })).status,
      204,
    );
    const leaked = await withTenant(tenantA, (db) =>
      (db as any).draftOrder.findMany({ where: { token } }),
    );
    assert.equal(leaked.length, 0, "another tenant's page must not create a draft here");
  });
});

/* =============================================================================
 * LB.1 — the browser and the API share ONE contract.
 *
 * The defect class these exist for: the purchase form and the routes each held
 * their own copy of the body shape, drifted, and every browser checkout
 * answered 422 while this suite — posting the route's own shape — stayed
 * green (BUILDER_AUDIT B-01..B-06). The schemas now live in
 * `lib/storefront/contract.ts`, imported by BOTH sides; these tests exercise
 * the fields the form actually sends, including the ones the old schema
 * silently stripped.
 * ========================================================================== */

describe('the checkout body is the contract the form sends (LB.1)', { skip }, () => {
  test('a checkout carrying draftToken/fbc/fbp is accepted, and the draft is marked converted', async () => {
    const token = `tok-${stamp}-convert1`;
    await post(`/api/storefront/${slugA}/draft-orders`, {
      token, landingPageId: publishedA, customerName: 'Almost Left', phone: '0555010203',
    });

    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA,
      customerName: 'Almost Left',
      phone: '0555010203',
      wilayaId,
      baladiaName: 'Centre',
      quantity: 1,
      shippingMethod: 'HOME',
      variantIds: [],
      draftToken: token,
      fbc: 'fb.1.1700000000.AbCdEf',
      fbp: 'fb.1.1700000000.1234567890',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));

    const draft = await withTenant(tenantA, (db) =>
      (db as any).draftOrder.findFirst({ where: { token } }),
    );
    assert.ok(draft, 'the draft still exists');
    assert.equal(draft.convertedOrderId, r.body.data.id, 'the lead is marked converted');
    assert.ok(draft.convertedAt, 'with a timestamp');
  });

  test('an unresolvable draftToken does not fail the sale', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA, customerName: 'No Draft', phone: '0555020304',
      wilayaId, baladiaName: 'Centre', quantity: 1, shippingMethod: 'HOME',
      draftToken: `tok-${stamp}-never-existed`,
    });
    assert.equal(r.status, 201, 'a cleared sessionStorage must not block a purchase');
  });

  test('an order that carries no draftToken leaves the lead open', async () => {
    const token = `tok-${stamp}-untoken1`;
    await post(`/api/storefront/${slugA}/draft-orders`, {
      token, landingPageId: publishedA, phone: '0555030405',
    });
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA, customerName: 'Cross Check', phone: '0555030405',
      wilayaId, baladiaName: 'Centre', quantity: 1,
    });
    assert.equal(r.status, 201);

    // Conversion is opt-in by token, never inferred from a matching phone —
    // inference would mark somebody else's lead on a shared family number.
    const untouched = await withTenant(tenantA, (db) =>
      (db as any).draftOrder.findFirst({ where: { token } }),
    );
    assert.equal(untouched.convertedOrderId, null, 'no token, no conversion');
  });

  test('the capture accepts the fields the form sends: names, variants, method', async () => {
    const token = `tok-${stamp}-fullcap1`;
    const r = await post(`/api/storefront/${slugA}/draft-orders`, {
      token,
      landingPageId: publishedA,
      customerName: 'Typed Everything',
      phone: '0555040506',
      wilaya: 'Adrar',
      baladia: 'Adrar Centre',
      quantity: 2,
      variants: [{ name: 'Couleur', value: 'Noir' }],
      shippingMethod: 'DESK',
    });
    assert.equal(r.status, 204);

    const draft = await withTenant(tenantA, (db) =>
      (db as any).draftOrder.findFirst({ where: { token } }),
    );
    assert.ok(draft, 'stored');
    assert.equal(draft.wilaya, 'Adrar');
    assert.equal(draft.baladia, 'Adrar Centre');
    assert.equal(draft.shippingMethod, 'DESK');
    assert.deepEqual(draft.variants, [{ name: 'Couleur', value: 'Noir' }]);
  });

  test('the wilayas response shape is the one the form reads: data.items with embedded prices', async () => {
    const r = await get(`/api/storefront/${slugA}/wilayas`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data.items), 'items is the array, not data itself');
    const w = r.body.data.items[0];
    assert.equal(typeof w.homePrice, 'string', 'a price is a Decimal string, never a float');
    assert.ok(Array.isArray(w.baladias));
  });
});

describe('free shipping and the floating WhatsApp reach the customer (B2)', { skip }, () => {
  test('freeShipping zeroes the delivery charge the customer pays', async () => {
    // The flag has been honoured by checkout since the port; what was missing
    // was any way to set it. Arrange the row the way the editor's new switch
    // lands it, then prove the money.
    await withTenant(tenantA, (db) => (db as any).landingSetting.upsert({
      where: { landingPageId: publishedA },
      create: { tenantId: tenantA, landingPageId: publishedA, freeShipping: true },
      update: { freeShipping: true },
    }));
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA, customerName: 'Free Ship', phone: '0555030405',
      wilayaId, baladiaName: 'Somewhere', quantity: 1, shippingMethod: 'HOME',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.total, '3000', 'the 500 delivery charge must not be billed');
    // Leave the flag off for every pricing assertion that follows.
    await withTenant(tenantA, (db) => (db as any).landingSetting.update({
      where: { landingPageId: publishedA }, data: { freeShipping: false },
    }));
  });

  test('the WhatsApp button renders only when toggled AND a number exists', async () => {
    const before = await get(`/${slugA}/shared-item`);
    assert.ok(!/data-testid="floating-whatsapp"/.test(before.text), 'absent by default');

    await withTenant(tenantA, async (db) => {
      await (db as any).landingSetting.update({
        where: { landingPageId: publishedA }, data: { floatingWhatsapp: true },
      });
      await (db as any).storeSettings.upsert({
        where: { tenantId: tenantA },
        create: { tenantId: tenantA, whatsapp: '0555 12 34 56' },
        update: { whatsapp: '0555 12 34 56' },
      });
    });
    const on = await get(`/${slugA}/shared-item`);
    assert.match(on.text, /data-testid="floating-whatsapp"/);
    // The local 0… number became international digits for wa.me.
    assert.match(on.text, /wa\.me\/213555123456/);

    await withTenant(tenantA, (db) => (db as any).landingSetting.update({
      where: { landingPageId: publishedA }, data: { floatingWhatsapp: false },
    }));
    const off = await get(`/${slugA}/shared-item`);
    assert.ok(!/data-testid="floating-whatsapp"/.test(off.text), 'the toggle is the off switch');
  });
});
