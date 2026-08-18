import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';

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
let themeIdA = '';
let orderOnThemedA = '';

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

        // Theme-scope fixtures for the chrome pages: a category holding the
        // published page, and an order on a page that HAS a theme row — the
        // thank-you must wear the MERCHANT's theme, not the default, so the
        // fixture theme's colors are deliberately nothing like DEFAULT_THEME.
        const cat = await (db as any).category.create({
          data: { tenantId: t.id, name: 'Fixture Category', slug: 'fixture-category' },
          select: { id: true },
        });
        await (db as any).landingPage.update({
          where: { id: publishedA },
          data: { categoryId: cat.id },
        });

        const theme = await (db as any).landingTheme.create({
          data: {
            tenantId: t.id, name: 'Merchant Night',
            primary: '#7C3AED', primaryForeground: '#FFFFFF', accent: '#F59E0B',
            background: '#141414', card: '#1F1F1F', text: '#FAFAFA',
            muted: '#262626', border: '#333333',
          },
          select: { id: true },
        });
        themeIdA = theme.id;
        const themed = await (db as any).landingPage.create({
          data: {
            tenantId: t.id, title: 'Themed Product', slug: 'themed-item',
            price: 4500, published: true, status: 'PUBLISHED', themeId: theme.id,
          },
          select: { id: true },
        });
        const ord = await (db as any).salesOrder.create({
          data: {
            tenantId: t.id, landingPageId: themed.id,
            customerName: 'Theme Buyer', phone: '0555000222',
            wilaya: 'Alger', baladia: 'Centre', address: '',
            quantity: 1, productPrice: 4500, shippingPrice: 500, totalPrice: 5000,
          },
          select: { id: true },
        });
        orderOnThemedA = ord.id;
      }
    });
  }
});

after(async () => {
  if (skip) return;
  for (const id of [tenantA, tenantB].filter(Boolean)) {
    await deleteTenant(id).catch(() => {});
  }
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

describe("a landing page wears its OWN theme, never the viewer's dark mode", { skip }, () => {
  // The theme-bleed fix. next-themes stamps `.dark` on <html> for EVERY route
  // — the storefront included, where it follows the VISITOR's OS preference —
  // and the template's structural sections are written in console Tailwind
  // tokens. `--theme-background` was written by the ThemeProvider and read by
  // nothing, so a customer with a dark phone saw a near-black page whatever
  // the merchant themed. The fix is scoped: the provider PAINTS the canvas
  // and redefines the console token names inside its own subtree, where the
  // nearest declaration wins over `.dark`'s values on :root.
  test('the served page paints the theme canvas and redefines the console tokens in scope', async () => {
    const r = await get(`/${slugA}/shared-item`);
    assert.equal(r.status, 200);

    // The scope element (DEFAULT_THEME: the fixture page has no theme row).
    const tag = r.text.match(/<div[^>]*data-landing-theme="default"[^>]*>/)?.[0] ?? '';
    assert.notEqual(tag, '', 'the theme scope element is not in the served HTML');
    const style = tag.match(/style="([^"]*)"/)?.[1] ?? '';
    assert.notEqual(style, '', 'the theme scope carries no inline style');

    // The canvas is painted from the theme — the reader --theme-background
    // never had.
    assert.match(style, /background-color:\s*#FAF9F6/i, 'the canvas is not the theme background');

    // The console token names, redefined in scope. This is what makes `.dark`
    // on <html> unable to reach a landing page: Tailwind v4 utilities resolve
    // var(--background) at the element they style, and the nearest
    // declaration wins.
    for (const decl of [
      '--background:#FAF9F6',
      '--card:#FFFFFF',
      '--foreground:#111827',
      '--border:#E5E7EB',
      // LB.55: `--muted` is no longer raw theme.muted but the derived SAFE
      // tint (muted pulled toward the background until full text holds AA on
      // it) — on the default theme's already-light muted the tint is a hair
      // off the raw value. Pinned exactly so a silent formula change, or a
      // regression back to the raw mid-tone, shows up here.
      '--muted:#f8f8f6',
    ]) {
      assert.ok(style.includes(decl), `${decl} missing — the console/visitor theme can leak in`);
    }

    // LB.55's muted pair, both halves. ONE surface definition serves the
    // theme vocabulary and the console remap, and ONE ink definition serves
    // `--theme-text-muted` (LB.53's token) and `--muted-foreground` — the
    // live defect was precisely these existing as two different strengths.
    const readVar = (name: string) =>
      style.match(new RegExp(`${name}:(#[0-9a-fA-F]{6})`))?.[1] ?? '';
    assert.equal(readVar('--theme-muted-surface'), readVar('--muted'), 'two muted surface definitions');
    assert.notEqual(readVar('--theme-text-muted'), '', 'muted ink is not a concrete hex');
    assert.equal(readVar('--theme-text-muted'), readVar('--muted-foreground'), 'two muted ink strengths');

    // next-themes also writes `color-scheme: dark` on <html>; unoverridden,
    // the purchase form's NATIVE widgets render dark chrome in a light page.
    assert.match(style, /color-scheme:\s*light/);
  });
});

describe("the storefront's chrome pages wear a stable theme, never the viewer's", { skip }, () => {
  // Same bleed, different pages: the LB.26 fix covered only pages rendered
  // through LandingTemplate. Home, category and thank-you rendered console
  // tokens with no scope, so a dark-phone customer bought on a light page and
  // landed on a near-black confirmation. Home and category wear DEFAULT_THEME
  // (no store-level theme row exists yet); the thank-you inherits the theme
  // of the landing page its order came from.
  const scopeStyle = (html: string, themeId: string) => {
    const tag = html.match(new RegExp(`<div[^>]*data-landing-theme="${themeId}"[^>]*>`))?.[0] ?? '';
    return tag.match(/style="([^"]*)"/)?.[1] ?? '';
  };

  test('the store home is scoped to the default theme', async () => {
    const r = await get(`/${slugA}`);
    assert.equal(r.status, 200);
    const style = scopeStyle(r.text, 'default');
    assert.notEqual(style, '', 'the home page has no theme scope');
    assert.match(style, /background-color:\s*#FAF9F6/i, 'the canvas is not the theme background');
    assert.ok(style.includes('--background:#FAF9F6'), 'the console token is not redefined in scope');
    assert.match(style, /color-scheme:\s*light/);
  });

  test('a category page is scoped to the default theme', async () => {
    const r = await get(`/${slugA}/category/fixture-category`);
    assert.equal(r.status, 200);
    assert.match(r.text, /data-testid="category-products"/);
    const style = scopeStyle(r.text, 'default');
    assert.notEqual(style, '', 'the category page has no theme scope');
    assert.match(style, /background-color:\s*#FAF9F6/i, 'the canvas is not the theme background');
  });

  test("the thank-you wears the theme of the page its order came from", async () => {
    const r = await get(`/${slugA}/thank-you/${orderOnThemedA}`);
    assert.equal(r.status, 200);
    const style = scopeStyle(r.text, themeIdA);
    assert.notEqual(style, '', "the thank-you is not scoped to the ORDER's landing-page theme");
    assert.match(style, /background-color:\s*#141414/i, "the canvas is not the merchant's background");
    assert.ok(style.includes('--background:#141414'), 'the console token is not redefined in scope');
  });
});

describe('the checkout form is neutral until the customer acts, and its labels work', { skip }, () => {
  // The "Full name shows a red invalid border with no interaction" report did
  // NOT reproduce: measured on the published page and in the editor's preview
  // drawer, a fresh field carries aria-invalid="false" and the theme's neutral
  // border, and the compiled variant is `[aria-invalid=true]`, which "false"
  // cannot match. The red state is real but arrives only after a submit
  // attempt. This test pins the SERVED state so a future default-invalid
  // regression is caught at the source rather than in a screenshot.
  test('a freshly served purchase form marks no field invalid', async () => {
    const r = await get(`/${slugA}/shared-item`);
    assert.equal(r.status, 200);
    assert.match(r.text, /id="fullName"/, 'the name input is not on the page');
    assert.ok(
      !/aria-invalid="true"/.test(r.text),
      'a field is invalid before the customer has touched anything',
    );
    // The error paragraph is rendered only alongside a real error.
    assert.ok(!/role="alert"/.test(r.text), 'an error message is present on a fresh form');
  });

  // The defect the investigation DID find. Field derived htmlFor from the
  // label TEXT — `الاسم الكامل` became `الاسمالكامل` while the input's id is
  // `fullName` — so no label in the checkout form resolved to its control.
  // The labels are merchant-authored and translated; an id derived from them
  // could never match a fixed id.
  test('every checkout label points at a control that exists', async () => {
    const r = await get(`/${slugA}/shared-item`);
    const ids = new Set([...r.text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const fors = [...r.text.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(fors.length > 0, 'no labels rendered at all');
    const dangling = fors.filter((f) => !ids.has(f));
    assert.deepEqual(dangling, [], `labels point at no control: ${dangling.join(', ')}`);
    for (const expected of ['fullName', 'phone']) {
      assert.ok(fors.includes(expected), `nothing labels #${expected}`);
    }
  });
});

describe("a storefront never wears the PLATFORM's identity", { skip }, () => {
  // The branding leak. The template's nav and footer fell back to the platform
  // wordmark — linking to `/`, the platform's own console — whenever the tenant
  // had no StoreSettings row. Measured 13 Aug 2026: BOTH production tenants had
  // exactly that null row, so this was one publish away from a real customer.
  // Tenant B NEVER gets a settings row anywhere in this file, which is what
  // makes it the right fixture here: tenant A acquires one in the B4 block
  // below, so asserting on A would silently depend on test ordering.
  test('a tenant with NO store settings row shows its own name, not the platform', async () => {
    const r = await get(`/${slugB}/shared-item`);
    assert.equal(r.status, 200);

    assert.match(r.text, /data-testid="store-brand"/, 'no store brand rendered at all');
    assert.match(r.text, /Shop B/, "the tenant's own name is the honest fallback");

    // The platform wordmark is built from two spans ("Landing" + "OS"); its
    // presence anywhere in a storefront page is the defect.
    assert.ok(
      !/Landing<span class="text-muted-foreground">OS<\/span>/.test(r.text),
      'the platform wordmark is rendered on a customer-facing page',
    );
    // The platform's INTERNAL description used to be the footer's fallback.
    assert.ok(
      !/Internal tool for building high-converting/.test(r.text),
      "the platform's internal description reached a storefront",
    );
    assert.ok(!/©\s*\d{4}\s*LandingOS/.test(r.text), 'the footer claims platform copyright');
  });

  test('the brand never links to the platform root', async () => {
    const r = await get(`/${slugB}/shared-item`);
    const brand = r.text.match(/<a[^>]*data-testid="store-brand"[^>]*>/)?.[0] ?? '';
    assert.notEqual(brand, '', 'the brand is not a link on a published page');
    const href = brand.match(/href="([^"]*)"/)?.[1] ?? '';
    assert.equal(href, `/${slugB}`, "the brand must lead to the tenant's own storefront");
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

  test('FREE SHIPPING moves the quote and the charge together, or neither', async () => {
    /* D-LB.20.1, the case that slipped past it. `freeShipping` used to be
       applied by the checkout ALONE — two lines under the comment promising the
       two could not differ — so a page with the switch on quoted the company's
       rate in the destination dropdown and then charged nothing. Measured
       before the fix: quote 500, charge 0.
       It favours the customer, which is why nobody noticed, and it defeats the
       feature: free shipping is a conversion lever and the storefront was
       advertising a fee at the moment of choosing. */
    const quoted = async () => {
      const r = await get(`/api/storefront/${slugA}/wilayas?landingPageId=${publishedA}`);
      return r.body.data.items.find((w: any) => w.id === wilayaId)?.homePrice;
    };
    const charged = async (who: string) => {
      const r = await post(`/api/storefront/${slugA}/orders`, {
        landingPageId: publishedA, customerName: who, phone: '0555000123',
        wilayaId, baladiaName: 'Somewhere', quantity: 1, shippingMethod: 'HOME',
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const o = await withTenant(tenantA, (db) =>
        (db as any).salesOrder.findFirst({
          where: { customerName: who }, select: { shippingPrice: true },
        }));
      return String(o.shippingPrice);
    };

    const setFree = (on: boolean) =>
      withTenant(tenantA, (db) =>
        (db as any).landingSetting.upsert({
          where: { landingPageId: publishedA },
          update: { freeShipping: on },
          create: { landingPageId: publishedA, tenantId: tenantA, freeShipping: on },
        }));

    try {
      await setFree(false);
      assert.equal(await quoted(), '500', 'the ordinary rate is quoted');
      assert.equal(await charged(`FreeShip Off ${stamp}`), '500', 'and charged');

      await setFree(true);
      assert.equal(await quoted(), '0', 'the dropdown must stop advertising a fee');
      assert.equal(await charged(`FreeShip On ${stamp}`), '0', 'and the order agrees');
    } finally {
      await setFree(false);
    }
  });

  test('free shipping decides what delivery COSTS, never where it goes', async () => {
    // The older rule this must not overturn: "an unpriced wilaya is
    // undeliverable, not free." Zeroing prices must not add destinations.
    await withTenant(tenantA, (db) =>
      (db as any).landingSetting.upsert({
        where: { landingPageId: publishedA },
        update: { freeShipping: true },
        create: { landingPageId: publishedA, tenantId: tenantA, freeShipping: true },
      }));
    try {
      const r = await get(`/api/storefront/${slugA}/wilayas?landingPageId=${publishedA}`);
      assert.equal(r.body.data.items.length, 1, 'still only the wilaya this shop priced');

      const other = await post(`/api/storefront/${slugA}/orders`, {
        landingPageId: publishedA, customerName: `FreeShip Undeliverable ${stamp}`,
        phone: '0555000124', wilayaId: wilayaId === 1 ? 2 : 1,
        baladiaName: 'Somewhere', quantity: 1, shippingMethod: 'HOME',
      });
      assert.equal(other.status, 422, 'an unpriced wilaya stays undeliverable');
      assert.equal(other.body.error.code, 'UNDELIVERABLE');
    } finally {
      await withTenant(tenantA, (db) =>
        (db as any).landingSetting.update({
          where: { landingPageId: publishedA }, data: { freeShipping: false },
        }));
    }
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

describe("the storefront wears the tenant's identity, not the platform's (B4)", { skip }, () => {
  test('nav and footer carry the store name, logo and socials once set', async () => {
    await withTenant(tenantA, (db) => (db as any).storeSettings.upsert({
      where: { tenantId: tenantA },
      create: {
        tenantId: tenantA, storeName: 'Shop A Store', storeDescription: 'The finest test goods.',
        logo: '/uploads/test-logo.png', facebook: 'shopa', telegram: '@shopa_tg',
      },
      update: {
        storeName: 'Shop A Store', storeDescription: 'The finest test goods.',
        logo: '/uploads/test-logo.png', facebook: 'shopa', telegram: '@shopa_tg',
      },
    }));

    const r = await get(`/${slugA}/shared-item`);
    assert.equal(r.status, 200);
    assert.match(r.text, /data-testid="store-brand"/);
    assert.match(r.text, /data-testid="store-logo"/);
    assert.match(r.text, />Shop A Store</);
    // A bare handle became the canonical link; a handle with @ lost it.
    assert.match(r.text, /data-social="facebook"[^>]*/);
    assert.match(r.text, /facebook\.com\/shopa/);
    assert.match(r.text, /t\.me\/shopa_tg/);
    assert.match(r.text, /The finest test goods\./);
  });

  // REPLACES 'a tenant with no settings row keeps the platform fallback',
  // which asserted the leak as if it were the design: it required that a
  // brandless page render NO store brand, and the template's answer to that
  // was the PLATFORM's wordmark linking to the platform console. The rule is
  // inverted now — a storefront always names its merchant — so the old
  // expectation is not merely outdated, it is the defect written down.
  test('a tenant with no settings row still names ITS OWN store', async () => {
    const r = await get(`/${slugB}/shared-item`);
    assert.equal(r.status, 200);
    assert.match(r.text, /data-testid="store-brand"/, 'a brandless tenant still gets a brand');
    assert.match(r.text, /Shop B/, "the tenant's own name stands in for an unset store name");
    assert.match(r.text, /data-testid="storefront-footer"/);
  });
});

/* =============================================================================
 * LB.14a — the storefront caching story, asserted on the SERVED header.
 *
 * The argument is in `src/lib/storefront/cache-policy.ts`; these tests exist
 * because two halves of it live in `next.config.ts`, where a rule can be
 * declared and lose silently. One of them did: the thank-you page's `no-store`
 * was written first on the assumption that the first matching rule wins, and
 * the broader tenant rule overrode it — the order confirmation was answering
 * `max-age=60` while the config said otherwise. Reading the config would have
 * agreed with itself. Reading the response is what caught it.
 * ========================================================================== */

describe('LB.14a — nothing that costs money may be served stale', { skip }, () => {
  const cacheControl = async (path: string) => {
    const res = await fetch(BASE + path, { redirect: 'manual' });
    return (res.headers.get('cache-control') ?? '').toLowerCase();
  };

  test('THE DELIVERY QUOTE is never stored, by anyone', async () => {
    // D-LB.20.1: the quote and the charge come from one function so they
    // cannot disagree. A cache in the middle re-opens that gap from outside
    // the code — the customer is shown one shipping price and charged another.
    // Before LB.14a this response carried NO Cache-Control at all, and RFC
    // 9111 lets a shared cache invent its own freshness for exactly that.
    const cc = await cacheControl(`/api/storefront/${slugA}/wilayas`);
    assert.match(cc, /no-store/, `the delivery quote is cacheable: "${cc}"`);
    assert.ok(!/(^|[\s,])public/.test(cc), `the delivery quote is public: "${cc}"`);
    assert.ok(!/s-maxage/.test(cc), `the delivery quote grants shared freshness: "${cc}"`);
  });

  test('and so is the 404 it gives for a store that does not exist', async () => {
    // A store created a minute from now must not inherit a cached refusal.
    const cc = await cacheControl(`/api/storefront/nope-${stamp}/wilayas`);
    assert.match(cc, /no-store/, cc);
  });

  test('THE PIXEL CONFIGURATION is never stored either', async () => {
    // A pixel the merchant removed must stop firing; one they added must
    // start. It also names a tenant's advertising setup.
    for (const route of ['tracking', 'meta-pixels']) {
      const cc = await cacheControl(`/api/storefront/${slugA}/${route}`);
      assert.match(cc, /no-store/, `${route}: "${cc}"`);
    }
  });

  test('THE ORDER CONFIRMATION is never stored — the rule that was silently inert', async () => {
    const cc = await cacheControl(`/${slugA}/thank-you/${orderOnThemedA}`);
    assert.match(cc, /no-store/, `a customer's order is cacheable: "${cc}"`);
    assert.ok(!/max-age=60/.test(cc), `the broad tenant rule is winning again: "${cc}"`);
  });

  test('a published page may be redisplayed by ITS OWN browser, and shared with nothing', async () => {
    // Every storefront page renders a price, and the checkout recomputes that
    // price server-side — so a shared copy takes an order at a number the
    // customer never agreed to. `private` is what makes the short window safe;
    // it is not decoration.
    for (const path of [`/${slugA}`, `/${slugA}/shared-item`]) {
      const cc = await cacheControl(path);
      assert.match(cc, /private/, `${path} may be shared: "${cc}"`);
      assert.ok(!/(^|[\s,])public/.test(cc), `${path} is public: "${cc}"`);
      assert.ok(!/s-maxage/.test(cc), `${path} grants shared freshness: "${cc}"`);
      // And it is no longer `no-store`, which forbade even a back-button
      // redisplay — the one real win available without ISR.
      assert.ok(!/no-store/.test(cc), `${path} still forbids reuse entirely: "${cc}"`);
      assert.match(cc, /max-age=\d+/, `${path} states no freshness: "${cc}"`);
    }
  });

  test('the freshness window stays short enough to be a rounding error on a price change', async () => {
    const cc = await cacheControl(`/${slugA}/shared-item`);
    const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? -1);
    assert.ok(maxAge > 0, `no usable max-age: "${cc}"`);
    assert.ok(maxAge <= 300, `${maxAge}s is long enough for a merchant's price edit to matter`);
  });

  test('the console is NOT inside the storefront rule', async () => {
    // The tenant pattern is a catch-all with exclusions carved out of it. If
    // one of them breaks, a console screen starts handing a browser a minute
    // of freshness on somebody's order book.
    for (const path of ['/console/login', '/console/builder/pages']) {
      const cc = await cacheControl(path);
      assert.match(cc, /no-store/, `${path} picked up the storefront policy: "${cc}"`);
    }
  });
});

describe('LB.14a — the bare root keeps the framework default', { skip }, () => {
  test('/ is not caught by the tenant catch-all', async () => {
    // `.*` in the tenant segment also matches the EMPTY string, so `/` fell
    // into the storefront rule and its 307 to /console was cached for a
    // minute. The root is the one path whose meaning depends on the Host —
    // platform root to the console, a verified custom domain's root to that
    // tenant's storefront — and a header chosen by PATH cannot tell them
    // apart, so it must keep the framework's own answer.
    const res = await fetch(BASE + '/', { redirect: 'manual' });
    const cc = (res.headers.get('cache-control') ?? '').toLowerCase();
    assert.ok(!/max-age=60/.test(cc), `the root picked up the storefront policy: "${cc}"`);
    assert.match(cc, /no-store/, cc);
  });
});

/* =============================================================================
 * The <head> half of "a storefront never wears the platform's identity".
 *
 * LB.31 closed the BODY and left the head, where the same leak is harder to
 * see and reaches further: a merchant's shop served the platform's name in the
 * browser tab, the platform's internal tagline as its description, and — on
 * the home and category pages — `noindex, nofollow`, which does not merely
 * look wrong but keeps the shop out of search entirely.
 *
 * Asserted against the SERVED HTML rather than the metadata objects, for
 * LB.14a's reason: a declaration that loses to a parent is exactly the
 * "configured and inert" shape this project keeps catching, and only the
 * response can prove which one won.
 * ========================================================================== */

const metaRobots = (html: string): string =>
  (/<meta name="robots" content="([^"]*)"/i.exec(html)?.[1] ?? '').toLowerCase();

const titleOf = (html: string): string =>
  (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim();

const canonicalOf = (html: string): string =>
  (/<link rel="canonical" href="([^"]*)"/i.exec(html)?.[1] ?? '');

/* The shop's name is READ from the home page rather than written down here.
 * Whether a StoreSettings row exists yet depends on which describe block ran
 * first, and the point being asserted is that every storefront page agrees on
 * ONE merchant identity — which a hardcoded copy would stop testing. */
async function storeNameFromHome(): Promise<string> {
  const home = await get(`/${slugA}`);
  return titleOf(home.text);
}

describe("a storefront's <head> wears the merchant, and is allowed to be found", { skip }, () => {
  test('the store home is titled for the shop and is indexable', async () => {
    const r = await get(`/${slugA}`);
    assert.equal(r.status, 200);
    const title = titleOf(r.text);
    assert.ok(title.length > 0, 'the home served no title at all');
    assert.ok(
      !/LandingOS/i.test(title),
      `the platform's name reached a shop's browser tab: "${title}"`,
    );
    assert.match(metaRobots(r.text), /(^|[\s,])index/, 'a shop must be findable');
    assert.ok(!/noindex/.test(metaRobots(r.text)), 'the home inherited the console noindex');
    // ABSOLUTE since LB.47 (metadataBase on the storefront layout).
    assert.equal(canonicalOf(r.text), `${BASE}/${slugA}`);
  });

  test("a product's title carries the MERCHANT's name, not the platform's", async () => {
    const storeName = await storeNameFromHome();
    const r = await get(`/${slugA}/shared-item`);
    assert.equal(r.status, 200);
    // The product page always set its own title correctly; what it could not
    // control was the root layout's `%s · LandingOS` template appended to it.
    assert.equal(titleOf(r.text), `Product A · ${storeName}`);
    assert.ok(!/noindex/.test(metaRobots(r.text)));
    assert.equal(canonicalOf(r.text), `${BASE}/${slugA}/shared-item`);
  });

  test('a category is titled for itself and is indexable', async () => {
    const storeName = await storeNameFromHome();
    const r = await get(`/${slugA}/category/fixture-category`);
    assert.equal(r.status, 200);
    assert.equal(titleOf(r.text), `Fixture Category · ${storeName}`);
    assert.ok(!/noindex/.test(metaRobots(r.text)), 'the category inherited the console noindex');
    assert.equal(canonicalOf(r.text), `${BASE}/${slugA}/category/fixture-category`);
  });

  test("the thank-you page is NOT indexable — it is a customer's order", async () => {
    // The one page the layout's blanket opt-in must not reach. It carries a
    // name, a wilaya and a total; an unguessable id is what makes it safe to
    // serve without a session, not what keeps it out of an index.
    const r = await get(`/${slugA}/thank-you/${orderOnThemedA}`);
    assert.equal(r.status, 200);
    assert.match(
      metaRobots(r.text),
      /noindex/,
      "a customer's order page became indexable when the storefront opted in",
    );
  });

  test('metadata URLs are ABSOLUTE on the request\'s own origin (LB.47)', async () => {
    // Without metadataBase, Next absolutised og:image against its fallback —
    // http://localhost:PORT — measured serving localhost:10000 to social
    // scrapers in PRODUCTION, while the canonical stayed a relative path
    // PageSpeed flags as invalid. Both must resolve on the serving origin.
    const html = await fetch(`${BASE}/${slugA}/shared-item`).then((r) => r.text());
    assert.match(
      html,
      new RegExp(`rel="canonical" href="${BASE}/${slugA}/shared-item"`),
      'the canonical must be absolute on the serving origin',
    );
    assert.ok(!/localhost:10000/.test(html), 'no metadata URL may name the fallback host');
    const og = html.match(/property="og:image" content="([^"]+)"/);
    if (og) {
      assert.ok(
        og[1].startsWith(BASE),
        `og:image must be absolute on the serving origin, got ${og[1]}`,
      );
    }
  });

  test('the console is still noindex — the root default must not have moved', async () => {
    // The storefront opts IN; the root stays fail-closed. The console declares
    // no robots of its own and relies entirely on that inheritance, so this is
    // the test that fails if somebody "fixes" the root instead.
    const r = await get('/console/login');
    assert.match(metaRobots(r.text), /noindex/, 'the console became indexable');
  });

  test('a storefront path with no tenant behind it is not indexable', async () => {
    const r = await get(`/no-such-shop-${stamp}`);
    assert.equal(r.status, 404);
    assert.ok(
      !/(^|[\s,])index/.test(metaRobots(r.text)) || /noindex/.test(metaRobots(r.text)),
      'a 404 advertised itself as indexable',
    );
  });
});

/* =============================================================================
 * LB.39 — the sitemap, which is LB.37's decision written where a crawler reads.
 *
 * The pairing is the point: LB.37 says which pages may be indexed, and this
 * says which pages to go and look at. If they can disagree, one of them is
 * lying, so these tests assert the SAME boundary from the other side —
 * especially the half-state row (`published: true` with `status: DRAFT`),
 * which is exactly what a filter written from memory rather than from the
 * storefront's own predicate would let through.
 * ========================================================================== */
describe('LB.39 — a shop lists what it sells, and nothing else', { skip }, () => {
  const sitemap = async (slug: string) => {
    const res = await fetch(`${BASE}/${slug}/sitemap.xml`);
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
  };

  test('it lists the home, visible categories and published pages', async () => {
    const s = await sitemap(slugA);
    assert.equal(s.status, 200);
    assert.match(s.type, /application\/xml/);
    assert.match(s.body, /<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(s.body, new RegExp(`<loc>[^<]*/${slugA}</loc>`), 'the store home is missing');
    assert.match(s.body, new RegExp(`<loc>[^<]*/${slugA}/shared-item</loc>`), 'a published page is missing');
    assert.match(s.body, new RegExp(`<loc>[^<]*/${slugA}/category/fixture-category</loc>`), 'a visible category is missing');
  });

  test('it excludes the draft, and the exclusion is the storefront predicate', async () => {
    // `secret-draft` is the same row the "an unpublished draft must not appear"
    // test above keeps off the store home. A sitemap that advertises it hands a
    // crawler a 404 and the merchant an indexed page they never published.
    const s = await sitemap(slugA);
    assert.ok(!/secret-draft/.test(s.body), 'an unpublished draft was advertised to crawlers');
  });

  test('it excludes the thank-you page, which LB.37 marks noindex', async () => {
    // The two must agree. A page carrying a customer's name, wilaya and total
    // is not merely unlisted by accident — it is excluded by the same decision
    // that puts `noindex` in its <head>.
    const s = await sitemap(slugA);
    assert.ok(!/thank-you/.test(s.body), "a customer's order page was listed for crawling");
  });

  test("it lists only THIS tenant's pages", async () => {
    // The whole file is about what a tenant binding must not allow. A sitemap
    // is a list of URLs, which is exactly the shape a leak takes.
    const s = await sitemap(slugA);
    assert.ok(!new RegExp(slugB).test(s.body), "another tenant's shop appeared in this one's sitemap");
    const other = await sitemap(slugB);
    assert.ok(!new RegExp(slugA).test(other.body), 'and the same the other way round');
  });

  test('every lastmod is a real date, not an invented one', async () => {
    // A static date trains a crawler to stop believing the field. Every value
    // here comes off the row's own `updatedAt`, so each must parse and none
    // may sit in the future.
    const s = await sitemap(slugA);
    const stamps = [...s.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    assert.ok(stamps.length > 0, 'no lastmod was emitted at all');
    const soon = Date.now() + 60_000;
    for (const raw of stamps) {
      const t = Date.parse(raw);
      assert.ok(Number.isFinite(t), `lastmod "${raw}" is not a date`);
      assert.ok(t <= soon, `lastmod "${raw}" is in the future`);
    }
    assert.equal(new Set(stamps).size > 0, true);
  });

  test('a slug with no tenant behind it is a 404, not an empty shop', async () => {
    const s = await sitemap(`no-such-shop-${stamp}`);
    assert.equal(s.status, 404, 'an unknown shop reported itself as real but empty');
  });
});

/* =============================================================================
 * LB.40 — /robots.txt, and the two hostnames whose answer differs.
 *
 * It REPLACED a static `public/robots.txt` whose every block was `Allow: /` —
 * so the platform invited crawlers into `/console` and `/api` while LB.37's
 * root layout told each page `noindex`. And a static file cannot say the one
 * thing worth saying: the platform host serves many shops and may name no
 * sitemap without publishing the tenant roster, while a verified custom domain
 * is one shop and may name exactly that shop's.
 *
 * The static file WON while both existed — `public/` is served before app
 * routes, so the new route was completely inert until the old file was
 * deleted. These assert the served body for that reason: which one answers is
 * invisible from the module.
 * ========================================================================== */
describe('LB.40 — robots.txt answers for the host it was asked on', { skip }, () => {
  /* `node:http`, not `fetch`, and only because fetch CANNOT do this: `host` is
   * a forbidden header name there and is silently dropped, so every request
   * would arrive as the platform host and the custom-domain branch — the half
   * that carries the disclosure decision — would be untestable. Measured
   * rather than assumed: a fetch with `headers: { host }` returned the
   * platform answer. */
  const rawGet = (path: string, host?: string): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const url = new URL(BASE);
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path,
          method: 'GET',
          headers: host ? { host } : {},
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  const robots = (host?: string) => rawGet('/robots.txt', host);

  test('the platform host keeps crawlers out of the console and the API', async () => {
    const r = await robots();
    assert.equal(r.status, 200);
    assert.match(r.body, /Disallow:\s*\/console\//i, 'the console is crawlable');
    assert.match(r.body, /Disallow:\s*\/api\//i, 'the API is crawlable');
    assert.match(r.body, /Allow:\s*\//i, 'storefronts must stay crawlable');
  });

  test('the static file it replaced is really gone', async () => {
    // `public/robots.txt` listed Googlebot, Bingbot, Twitterbot and
    // facebookexternalhit, each `Allow: /`. If any of those names comes back,
    // the static file is being served again and this route is inert.
    const r = await robots();
    for (const agent of ['Googlebot', 'Bingbot', 'Twitterbot', 'facebookexternalhit']) {
      assert.ok(!r.body.includes(agent), `the old static robots.txt is back (${agent})`);
    }
  });

  test('the platform host names NO sitemap — that would be the tenant roster', async () => {
    // The same objection that kept the sitemap out of the root in LB.39: the
    // only file this host could name is one listing every shop.
    const r = await robots();
    assert.ok(!/^\s*Sitemap:/im.test(r.body), 'the platform host published a sitemap index');
  });

  test('a request arriving at the platform address ignores a forged X-Forwarded-Host', async () => {
    // The header is client input. `currentHost()` believes it only when the
    // request did NOT arrive at a platform address, and this one did — so a
    // forged value must not be able to put a tenant's sitemap here.
    const res = await fetch(`${BASE}/robots.txt`, {
      headers: { 'x-forwarded-host': 'someone-elses-shop.test' },
    });
    const body = await res.text();
    assert.ok(
      !/^\s*Sitemap:/im.test(body),
      'a forged forwarded host put a sitemap on the platform robots.txt',
    );
  });

  test('a VERIFIED custom domain names that one shop\'s sitemap', async () => {
    // The case where the ambiguity disappears: this host belongs to one
    // merchant, so naming their sitemap tells a crawler something true and
    // discloses nobody else.
    const host = `verified-${stamp}.test`;
    await withTenant(tenantA, (db) =>
      (db as any).tenantDomain.create({
        data: {
          tenantId: tenantA, domain: host,
          verificationToken: `tok-${stamp}`, verifiedAt: new Date(),
        },
      }),
    );
    const r = await robots(host);
    assert.equal(r.status, 200);
    // BARE since LB.45 — the custom domain's own shape, the same URL the
    // rewrites serve and the pages declare canonical.
    assert.match(
      r.body,
      new RegExp(`^\\s*Sitemap:\\s*https://${host}/sitemap\\.xml\\s*$`, 'im'),
      `custom domain named the wrong sitemap:\n${r.body}`,
    );
    // And it does not stop being a console-protecting file.
    assert.match(r.body, /Disallow:\s*\/console\//i);
  });

  test('an UNVERIFIED domain gets the platform answer, not a shop\'s', async () => {
    // Verification is the second gate in `resolve-tenant`, and it is what
    // stops anyone pointing a hostname at the platform and claiming a shop.
    const host = `unverified-${stamp}.test`;
    await withTenant(tenantA, (db) =>
      (db as any).tenantDomain.create({
        data: {
          tenantId: tenantA, domain: host,
          verificationToken: `tok2-${stamp}`, verifiedAt: null,
        },
      }),
    );
    const r = await robots(host);
    assert.ok(
      !/^\s*Sitemap:/im.test(r.body),
      'an unverified domain was treated as a shop',
    );
  });
});

/* =============================================================================
 * LB.45 — a custom domain's paths are the shop's own.
 *
 * The link layer has emitted the bare shape since LB.31 (`storefrontHref`
 * drops the tenant prefix on a custom domain), but nothing SERVED it: `/robe`
 * matched `[tenant]` and rendered the store home, `/category/x` 404'd, and
 * the root redirected to `/{slug}` — measured live on the first real linked
 * domain. The fix is a host-conditioned rewrite pair in next.config.ts that
 * re-inserts a sentinel tenant segment, so these tests assert the SERVED
 * response for each shape, through the same raw-`host` convention LB.40's
 * tests established (fetch silently drops a `host` header).
 * ========================================================================== */
describe('LB.45 — a custom domain\'s paths are the shop\'s own', { skip }, () => {
  const rawGet = (
    path: string,
    host?: string,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; body: string; location?: string }> =>
    new Promise((resolve, reject) => {
      const url = new URL(BASE);
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path,
          method: 'GET',
          headers: { ...(host ? { host } : {}), ...extra },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body,
              location: res.headers.location,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });

  const host = `paths-${stamp}.test`;

  before(async () => {
    await withTenant(tenantA, (db) =>
      (db as any).tenantDomain.create({
        data: {
          tenantId: tenantA, domain: host,
          verificationToken: `tok3-${stamp}`, verifiedAt: new Date(),
        },
      }),
    );
  });

  test('the root RENDERS the store home — no redirect into the platform shape', async () => {
    const r = await rawGet('/', host);
    assert.equal(r.status, 200, `root answered ${r.status} → ${r.location ?? ''}`);
    assert.match(r.body, /href="\/shared-item"/, 'the home\'s product card links the bare path');
    assert.ok(!r.body.includes(`href="/${slugA}/`), 'no platform-shaped link on the custom domain');
  });

  test('the rewrite sentinel never reaches a rendered link (LB.48)', async () => {
    // The brand link was built from the raw path param, which on a rewritten
    // request is `__domain__` — found in the served accessibility tree of a
    // real page. Every link must come through storefrontHref.
    const r = await rawGet('/shared-item', host);
    assert.ok(!r.body.includes('href="/__domain__'), 'the sentinel leaked into a link');
    assert.match(r.body, /href="\/"/, 'the brand links the shop root on its own domain');
  });

  test('a bare page slug serves the LANDING page, not a listing', async () => {
    const r = await rawGet('/shared-item', host);
    assert.equal(r.status, 200);
    assert.match(r.body, /landing-fade-up/, 'the purchase column is what marks the landing template');
    // ABSOLUTE since LB.47 (metadataBase): the bare path on the shop's own
    // origin — a relative canonical is flagged invalid by PageSpeed, and
    // without metadataBase Next absolutised og:image to localhost:PORT.
    assert.match(
      r.body,
      new RegExp(`rel="canonical" href="https://${host}/shared-item"`),
      'canonical is the bare path on the shop\'s own origin',
    );
  });

  test('a bare category path serves the listing, and its cards click through', async () => {
    const r = await rawGet('/category/fixture-category', host);
    assert.equal(r.status, 200, 'the category listing must answer on its bare path');
    assert.match(r.body, /href="\/shared-item"/, 'the card links to the landing page\'s bare path');
  });

  test('the sitemap answers at /sitemap.xml with bare, absolute URLs', async () => {
    const r = await rawGet('/sitemap.xml', host);
    assert.equal(r.status, 200);
    assert.match(r.body, new RegExp(`<loc>https://${host}/shared-item</loc>`));
    assert.match(r.body, new RegExp(`<loc>https://${host}/category/fixture-category</loc>`));
    assert.ok(!r.body.includes(`/${slugA}/`), 'no platform-shaped loc on a custom domain');
  });

  test('the console is NOT rewritten on a custom host', async () => {
    const r = await rawGet('/console/login', host);
    assert.equal(r.status, 200, 'the console must keep its real paths on any host');
    assert.match(r.body, /login|password|mot de passe|كلمة/i);
  });

  test('the platform host is untouched: a bare slug stays a 404 there', async () => {
    const r = await rawGet(`/shared-item`);
    assert.equal(r.status, 404, 'a bare page slug is not a tenant on the platform host');
  });

  test('a forged X-Forwarded-Host cannot move a platform request into the shop shape', async () => {
    // The rewrite keys on the REAL Host header only. A platform-host request
    // claiming to be the custom domain must not be re-shaped by the claim.
    const r = await rawGet('/shared-item', undefined, { 'x-forwarded-host': host });
    assert.equal(r.status, 404, 'the forged header re-shaped a platform request');
  });

  test('an unknown hostname gets a 404, not another shop\'s pages', async () => {
    const r = await rawGet('/shared-item', `unclaimed-${stamp}.test`);
    assert.equal(r.status, 404);
  });
});

describe('first-party page views and their traffic source (AN.1)', { skip }, () => {
  const visitToken = `visit-${stamp}-1`;

  test('a landing view with ad evidence lands as ONE row with the channel derived', async () => {
    const r = await post(`/api/storefront/${slugA}/visits`, {
      token: visitToken,
      pageKind: 'landing',
      landingPageId: publishedA,
      source: { utmSource: 'facebook', referrer: 'https://l.facebook.com/l.php' },
    });
    assert.equal(r.status, 204, 'the beacon answers 204 whatever happens');

    const rows = await withTenant(tenantA, (db) =>
      (db as any).storefrontVisit.findMany({ where: { visitorToken: visitToken } }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].landingPageId, publishedA);
    assert.equal(rows[0].pageKind, 'landing');
    assert.equal(rows[0].sourceChannel, 'facebook');
    assert.equal(rows[0].sourceDetail, 'facebook');
  });

  test('a home view counts page-less; a junk body and an unknown store count nothing', async () => {
    const homeToken = `visit-${stamp}-home`;
    assert.equal(
      (await post(`/api/storefront/${slugA}/visits`, { token: homeToken, pageKind: 'home' })).status,
      204,
    );
    const rows = await withTenant(tenantA, (db) =>
      (db as any).storefrontVisit.findMany({ where: { visitorToken: homeToken } }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].landingPageId, null);
    assert.equal(rows[0].sourceChannel, 'direct');

    assert.equal((await post(`/api/storefront/${slugA}/visits`, {})).status, 204);
    assert.equal((await post(`/api/storefront/nope-${stamp}/visits`, { token: homeToken, pageKind: 'home' })).status, 204);
  });

  test("another tenant's page id records NOTHING — not even a page-less row", async () => {
    const strayToken = `visit-${stamp}-stray`;
    const r = await post(`/api/storefront/${slugA}/visits`, {
      token: strayToken,
      pageKind: 'landing',
      landingPageId: publishedB, // tenant B's page, posted at tenant A's door
    });
    assert.equal(r.status, 204, 'refusals are silent — this must not be a probe');
    const rows = await withTenant(tenantA, (db) =>
      (db as any).storefrontVisit.findMany({ where: { visitorToken: strayToken } }),
    );
    assert.equal(rows.length, 0, 'a row lying about what was seen is worse than none');
  });

  test('an unpublished draft view records nothing either', async () => {
    const draftViewToken = `visit-${stamp}-draft`;
    await post(`/api/storefront/${slugA}/visits`, {
      token: draftViewToken, pageKind: 'landing', landingPageId: draftA,
    });
    const rows = await withTenant(tenantA, (db) =>
      (db as any).storefrontVisit.findMany({ where: { visitorToken: draftViewToken } }),
    );
    assert.equal(rows.length, 0);
  });

  test('the client cannot smuggle a channel name — only evidence is accepted', async () => {
    const forgedToken = `visit-${stamp}-forged`;
    // `sourceChannel` is not a field of VisitBody; zod strips unknown keys, so
    // the write derives from the (absent) evidence and stores DIRECT.
    await post(`/api/storefront/${slugA}/visits`, {
      token: forgedToken, pageKind: 'home', sourceChannel: 'facebook',
    });
    const rows = await withTenant(tenantA, (db) =>
      (db as any).storefrontVisit.findMany({ where: { visitorToken: forgedToken } }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceChannel, 'direct');
  });

  test('a checkout carrying the session evidence snapshots the channel onto the order', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA,
      customerName: 'Attributed Buyer',
      phone: '0555000333',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 1,
      shippingMethod: 'HOME',
      visitSource: { ttclid: 'tt-click-1' },
    });
    assert.equal(r.status, 201);
    const order = await withTenant(tenantA, (db) =>
      (db as any).salesOrder.findUnique({ where: { id: r.body.data.id } }),
    );
    assert.equal(order.sourceChannel, 'tiktok');
    assert.equal(order.sourceDetail, 'ttclid');
  });

  test('a checkout with no evidence stays UNATTRIBUTED — null, not a guessed channel', async () => {
    const r = await post(`/api/storefront/${slugA}/orders`, {
      landingPageId: publishedA,
      customerName: 'Untagged Buyer',
      phone: '0555000444',
      wilayaId,
      baladiaName: 'Somewhere',
      quantity: 1,
      shippingMethod: 'HOME',
    });
    assert.equal(r.status, 201);
    const order = await withTenant(tenantA, (db) =>
      (db as any).salesOrder.findUnique({ where: { id: r.body.data.id } }),
    );
    assert.equal(order.sourceChannel, null);
  });

  test('the aggregates the console screen renders come from these same rows', async () => {
    // The one query builder (lib/builder/analytics), exercised directly over
    // the fixture rows this suite just wrote — the screen is rendering, not
    // arithmetic, so THIS is where the numbers are pinned.
    const { storefrontAnalytics, analyticsRange } = await import('../src/lib/builder/analytics.ts');
    const data = await withTenant(tenantA, (db) =>
      storefrontAnalytics(db, analyticsRange('7')),
    );

    const pageRow = data.byPage.find((row: any) => row.landingPageId === publishedA);
    assert.ok(pageRow, 'the viewed page has a row');
    assert.ok(pageRow.views >= 1);
    assert.ok(pageRow.orders >= 2, 'orders in the window count beside the views');
    assert.equal(pageRow.title, 'Product A');

    const facebook = data.byChannel.find((row: any) => row.channel === 'facebook');
    assert.ok(facebook && facebook.views >= 1, 'the facebook view is in the breakdown');
    const tiktok = data.byChannel.find((row: any) => row.channel === 'tiktok');
    assert.ok(tiktok && tiktok.orders >= 1, 'the attributed order is under its channel');
    const unattributed = data.byChannel.find((row: any) => row.channel === 'unattributed');
    assert.ok(
      unattributed && unattributed.orders >= 1,
      'a console/import order shows as unattributed, never folded into direct',
    );

    assert.ok(data.totals.views >= 2);
    assert.ok(data.totals.orders >= 2);
  });
});
