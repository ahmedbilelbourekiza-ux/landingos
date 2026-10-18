import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, hashPassword, SESSION_COOKIE } from '@landingos/auth';
import arMessages from '@landingos/i18n/messages/ar.json' with { type: 'json' };

import { stockKey, levelsFromMatrix, groupCount, readLevel, STOCK_REASON } from '../src/lib/landing/variant-stock.ts';

/* =============================================================================
 * VS.1 — the variant editor shows (and sets) the Manager's stock.
 *
 * The bug this answers: the builder had no stock field, so a merchant typed
 * stock into the add-on box; setting an own price then cleared it ("stock
 * reset to 0"). Measured first: saving builder variants never touched the
 * Manager's stock (prod movement history, and a scripted dev repro). So the
 * fix is a REAL stock line, fed from and written to the Manager's matrix
 * through the ledger — never a bare level.
 * ========================================================================== */

describe('VS.1 — the pure rules', () => {
  test('a one-group option is stocked under its value', () => {
    assert.equal(stockKey('size', '500g'), '500g');
  });

  test('levels are read off a stored matrix, junk skipped, never negative', () => {
    assert.deepEqual(
      levelsFromMatrix([
        { name: '500g', stock: 100 },
        { name: '1kg', stock: '50' },
        { name: '', stock: 9 },
        { stock: 3 },
        { name: 'bad', stock: -4 },
      ]),
      { '500g': 100, '1kg': 50, bad: 0 },
    );
    assert.deepEqual(levelsFromMatrix(null), {});
  });

  test('groups are counted folded, like the variants PUT', () => {
    assert.equal(groupCount([{ name: 'Size' }, { name: 'size ' }]), 1);
    assert.equal(groupCount([{ name: 'Size' }, { name: 'Colour' }]), 2);
    assert.equal(groupCount([]), 0);
  });

  test('a level is a whole number from 0, nothing else', () => {
    assert.equal(readLevel('0'), 0);
    assert.equal(readLevel(' 120 '), 120);
    for (const bad of ['', '-1', '1.5', '1,5', 'ten', '12345678']) assert.equal(readLevel(bad), null, bad);
  });
});

/* ---- against the running server ------------------------------------------ */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();
const tenants: string[] = [];
const users: string[] = [];
const tokens: Record<string, string> = {};
let erpTenant = '';
let builderTenant = '';
let onePage = '';      // one group, linked
let twoPage = '';      // two groups, linked
let freshPage = '';    // one group, never sent
let builderPage = '';  // a shop without the Manager
let productId = '';
let twoProductId = '';

async function member(tenantId: string, key: string, role: string, permissions: string[] = []) {
  const email = `vs1-${key}-${stamp}@landingos.test`;
  const u = await asPlatform().user.create({ data: { email, name: email, passwordHash: await hashPassword('x') } });
  users.push(u.id);
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({ data: { tenantId, userId: u.id, role, permissions } }),
  );
  tokens[key] = (await createSession(u.id, tenantId)).token;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, text };
}

const editor = async (pageId: string, token: string) => {
  const r = await api('GET', `/console/builder/pages/${pageId}/edit`, token);
  assert.equal(r.status, 200);
  return r.text as string;
};

async function page(tenantId: string, slug: string, variants: { name: string; value: string }[]) {
  return withTenant(tenantId, (tx) =>
    (tx as any).landingPage.create({
      data: {
        tenantId, title: `VS1 ${slug}`, slug: `${slug}-${stamp}`, price: 2000, published: true, status: 'PUBLISHED',
        variants: { create: variants.map((v, i) => ({ tenantId, ...v, displayOrder: i })) },
      },
      select: { id: true },
    }),
  ).then((p: any) => p.id as string);
}

const productOf = (tenantId: string, pageId: string) =>
  withTenant(tenantId, (tx) =>
    (tx as any).catalogProductLink.findFirst({ where: { externalProductId: pageId }, select: { productId: true } }),
  ).then((l: any) => l?.productId as string);

const storedLevels = (tenantId: string, id: string) =>
  withTenant(tenantId, (tx) => (tx as any).catalogProduct.findUnique({ where: { id }, select: { variants: true } }))
    .then((p: any) => levelsFromMatrix(p.variants));

before(async () => {
  if (skip) return;
  for (const [slug, ents] of [
    [`vs1-erp-${stamp}`, ['product.website-builder', 'product.erp']],
    [`vs1-b-${stamp}`, ['product.website-builder']],
  ] as const) {
    const t = await asPlatform().tenant.create({ data: { slug, name: slug } });
    tenants.push(t.id);
    await withTenant(t.id, (tx) =>
      (tx as any).subscription.create({ data: { tenantId: t.id, status: 'ACTIVE', entitlements: [...ents] } }),
    );
  }
  [erpTenant, builderTenant] = tenants;
  await member(erpTenant, 'owner', 'OWNER');
  // May edit pages but NOT move stock: the read-only case.
  await member(erpTenant, 'editor', 'MEMBER', ['website-builder:pages:write']);
  await member(builderTenant, 'builder', 'OWNER');

  onePage = await page(erpTenant, 'honey', [
    { name: 'size', value: '500g' },
    { name: 'size', value: '1kg' },
  ]);
  twoPage = await page(erpTenant, 'robe', [
    { name: 'size', value: 'M' },
    { name: 'colour', value: 'Blue' },
  ]);
  freshPage = await page(erpTenant, 'fresh', [{ name: 'size', value: 'S' }]);
  builderPage = await page(builderTenant, 'solo', [{ name: 'size', value: 'S' }]);

  for (const id of [onePage, twoPage]) {
    const r = await api('POST', '/api/builder/publish-to-erp', tokens.owner, { scope: 'one', landingPageId: id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  productId = await productOf(erpTenant, onePage);
  twoProductId = await productOf(erpTenant, twoPage);
});

after(async () => {
  if (skip) return;
  for (const u of users) await destroySessionsForUser(u).catch(() => {});
  for (const t of tenants) await deleteTenant(t).catch(() => {});
  for (const u of users) await asPlatform().user.delete({ where: { id: u } }).catch(() => {});
  await disconnect();
});

describe('VS.1 — the stock route', { skip }, () => {
  test('a typed level becomes a MOVEMENT against the stored level, with the page-editor reason', async () => {
    const r = await api('PUT', `/api/builder/landings/${onePage}/stock`, tokens.owner, {
      levels: [{ value: '500g', level: 100 }, { value: '1kg', level: 50 }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.moved, 2);
    assert.deepEqual(r.body.data.levels, { '500g': 100, '1kg': 50 });
    assert.deepEqual(await storedLevels(erpTenant, productId), { '500g': 100, '1kg': 50 });

    const moves = await withTenant(erpTenant, (tx) =>
      (tx as any).inventoryMovement.findMany({
        where: { productId }, orderBy: { ts: 'asc' }, select: { variantName: true, delta: true, reason: true },
      }),
    );
    assert.deepEqual(
      (moves as any[]).map((m) => [m.variantName, m.delta, m.reason]),
      [['500g', 100, STOCK_REASON], ['1kg', 50, STOCK_REASON]],
      'the ledger says what moved and why — no bare level',
    );
  });

  test('lowering a level records the negative delta; an unchanged level records nothing', async () => {
    const r = await api('PUT', `/api/builder/landings/${onePage}/stock`, tokens.owner, {
      levels: [{ value: '500g', level: 90 }, { value: '1KG', level: 50 }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.moved, 1, 'only the changed option moved');
    assert.deepEqual(r.body.data.levels, { '500g': 90, '1kg': 50 });
  });

  test('saving builder variants (with an own price) leaves the stock alone', async () => {
    const r = await api('PUT', `/api/builder/landings/${onePage}/variants`, tokens.owner, {
      items: [
        { name: 'size', value: '500g', extraPrice: 0, price: 3200 },
        { name: 'size', value: '1kg', extraPrice: 0, price: 6000 },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await storedLevels(erpTenant, productId), { '500g': 90, '1kg': 50 });
  });

  test('a person who may edit pages but not move stock is refused', async () => {
    const r = await api('PUT', `/api/builder/landings/${onePage}/stock`, tokens.editor, {
      levels: [{ value: '500g', level: 1 }],
    });
    assert.equal(r.status, 403);
    assert.deepEqual(await storedLevels(erpTenant, productId), { '500g': 90, '1kg': 50 });
  });

  test('a shop without the Manager is refused', async () => {
    const r = await api('PUT', `/api/builder/landings/${builderPage}/stock`, tokens.builder, {
      levels: [{ value: 'S', level: 1 }],
    });
    assert.equal(r.status, 403);
  });

  test('a two-group page is refused by code: its stock is per combination', async () => {
    const r = await api('PUT', `/api/builder/landings/${twoPage}/stock`, tokens.owner, {
      levels: [{ value: 'M', level: 1 }],
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'STOCK_PER_COMBINATION');
  });

  test('a page never sent to the Manager is refused by code', async () => {
    const r = await api('PUT', `/api/builder/landings/${freshPage}/stock`, tokens.owner, {
      levels: [{ value: 'S', level: 1 }],
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'NOT_IN_MANAGER');
  });

  test('an option the Manager does not have yet refuses the WHOLE batch', async () => {
    const add = await api('PUT', `/api/builder/landings/${onePage}/variants`, tokens.owner, {
      items: [
        { name: 'size', value: '500g', price: 3200 },
        { name: 'size', value: '1kg', price: 6000 },
        { name: 'size', value: '2kg' },
      ],
    });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const r = await api('PUT', `/api/builder/landings/${onePage}/stock`, tokens.owner, {
      levels: [{ value: '500g', level: 5 }, { value: '2kg', level: 5 }],
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'NOT_IN_MANAGER');
    assert.deepEqual(await storedLevels(erpTenant, productId), { '500g': 90, '1kg': 50 }, 'nothing half-applied');
  });

  test('a value that is not an option of this page, or a non-whole level, is refused', async () => {
    const other = await api('PUT', `/api/builder/landings/${onePage}/stock`, tokens.owner, {
      levels: [{ value: 'M', level: 1 }],
    });
    assert.equal(other.status, 422);
    const frac = await api('PUT', `/api/builder/landings/${onePage}/stock`, tokens.owner, {
      levels: [{ value: '500g', level: 1.5 }],
    });
    assert.equal(frac.status, 422);
  });
});

describe('VS.1 — what the editor shows', { skip }, () => {
  const ed = (arMessages as any).builder.editor;

  test('a linked one-group page: a Stock line per option, with the Manager level', async () => {
    const html = await editor(onePage, tokens.owner);
    const inputs = html.match(/<input[^>]*data-testid="variant-stock-input"[^>]*>/g) ?? [];
    assert.equal(inputs.length, 2, 'the two options the Manager has');
    assert.ok(inputs.some((i) => /value="90"/.test(i)) && inputs.some((i) => /value="50"/.test(i)));
    assert.ok(inputs.every((i) => !/disabled=""/.test(i)), 'editable for the owner');
    assert.equal((html.match(/data-testid="variant-stock-missing"/g) ?? []).length, 1, '2kg is not in the Manager yet');
    assert.ok(html.includes('data-testid="variant-stock-send"'), 'and can be sent again');
    assert.ok(html.includes(ed.stockLabel));
  });

  test('without stock access the levels are shown, not editable', async () => {
    const html = await editor(onePage, tokens.editor);
    const inputs = html.match(/<input[^>]*data-testid="variant-stock-input"[^>]*>/g) ?? [];
    assert.equal(inputs.length, 2);
    assert.ok(inputs.every((i) => /disabled=""/.test(i)));
    assert.ok(html.includes(ed.stockSingleReadOnly));
    assert.ok(!html.includes('data-testid="variant-stock-send"'), 'sending needs product write');
  });

  test('a two-group page links to the Manager variant editor for ITS product', async () => {
    const html = await editor(twoPage, tokens.owner);
    assert.equal((html.match(/data-testid="variant-stock-input"/g) ?? []).length, 0);
    const link = html.match(/<a[^>]*data-testid="variant-stock-manager-link"[^>]*>/)?.[0] ?? '';
    assert.ok(link.includes(`/console/erp/products?variants=${twoProductId}#variant-editor`), link);
  });

  test('a page never sent: the note and the send button, no stock line', async () => {
    const html = await editor(freshPage, tokens.owner);
    assert.ok(html.includes(ed.stockUnlinked));
    assert.ok(html.includes('data-testid="variant-stock-send"'));
    assert.equal((html.match(/data-testid="variant-stock-line"/g) ?? []).length, 0);
  });

  test('a shop without the Manager sees nothing about stock', async () => {
    const html = await editor(builderPage, tokens.builder);
    assert.ok(!html.includes('data-testid="variant-stock-note"'));
    assert.ok(!html.includes('data-testid="variant-stock-line"'));
  });

  test('the deep link opens the Manager variant editor on that product', async () => {
    const r = await api('GET', `/console/erp/products?variants=${twoProductId}`, tokens.owner);
    assert.equal(r.status, 200);
    const html = r.text as string;
    assert.ok(html.includes('id="variant-editor"'));
    const select = html.match(/<select[^>]*id="variant-product"[\s\S]*?<\/select>/)?.[0] ?? '';
    assert.match(select, new RegExp(`<option[^>]*value="${twoProductId}"[^>]*selected`), 'the linked product is the selection');
    const toggle = html.match(/<button[^>]*data-testid="variant-editor-toggle"[^>]*>/)?.[0] ?? '';
    assert.match(toggle, /aria-expanded="true"/, 'and the panel is open');
  });
});
