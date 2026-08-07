import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, uid, phone, makeErpTenant, makeMember, cleanup, raw, ONE_PIXEL_PNG,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/catalog.test.ts
 *
 * Ported from apps/erp/test/regression.test.js — products and inventory, the
 * client registry, agents, and financial records.
 *
 * Three properties in here are append-only and stay that way: the inventory
 * movement ledger, the product event timeline, and the financial record. Each
 * is asserted by trying to break it, because "append-only" is a claim about
 * what routes DON'T exist, and the absence of a route is invisible in a diff.
 *
 * Money is the other theme. 37 columns became `numeric` in M-06 and none are
 * `double precision`, so every assertion below compares the STRING form. A test
 * that compares `body.price === 5000` passes today and starts failing the day a
 * price has a fractional part — which is the day it matters.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('catalog');
});

after(async () => {
  if (skip) return;
  await cleanup();
});

async function newProduct(extra: Record<string, unknown> = {}) {
  const r = await acme.manager.api('POST', '/api/erp/products', {
    name: `Test Shoe ${uid()}`, sku: `TS-${uid()}`, price: 5000,
    costPrice: 2000, packagingCost: 100, threshold: 10, ...extra,
  });
  assert.equal(r.status, 201, `product creation failed: ${JSON.stringify(r.body)}`);
  return r.body.data;
}

/* -----------------------------------------------------------------------------
 * Products
 * -------------------------------------------------------------------------- */

describe('a catalog product carries its cost basis', () => {
  test('create with variants, and every field survives', async () => {
    // costPrice, packagingCost and the variant sku were each dropped by an
    // earlier version of the create path. Nothing failed — the product simply
    // appeared with a zero cost basis, which makes every profit figure that
    // uses it wrong rather than absent.
    const product = await newProduct({
      variants: [{ name: 'Black/42', stock: 20, threshold: 5, sku: 'TS-1-B42' }],
    });
    assert.equal(String(product.costPrice), '2000', 'costPrice must survive create');
    assert.equal(String(product.packagingCost), '100');
    assert.equal(product.variants[0].sku, 'TS-1-B42', 'variant sku must survive create');
  });

  test('inventory reflects per-variant stock', async () => {
    const product = await newProduct({
      variants: [{ name: 'Black/42', stock: 20, threshold: 5 }],
    });
    const r = await acme.manager.api('GET', `/api/erp/products/${product.id}/inventory`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.variants[0].stock, 20);
    assert.equal(r.body.data.variants[0].threshold, 5);
  });

  test('two tenants may hold the same sku', async () => {
    // Rescoped in M-04. A global unique here would mean the first company to
    // use "TS-1" claimed it for every company on the platform.
    const beta = await makeErpTenant('catalog-beta');
    const sku = `SHARED-${uid()}`;
    assert.equal((await acme.manager.api('POST', '/api/erp/products', { name: 'A', sku, price: 1 })).status, 201);
    assert.equal((await beta.manager.api('POST', '/api/erp/products', { name: 'B', sku, price: 1 })).status, 201);
  });

  test('archive hides the product from the active list but keeps it', async () => {
    const product = await newProduct();
    await acme.manager.api('DELETE', `/api/erp/products/${product.id}`);

    const active = await acme.manager.api('GET', '/api/erp/products?pageSize=200');
    assert.ok(!active.body.data.items.some((p: { id: string }) => p.id === product.id));

    const archived = await acme.manager.api('GET', '/api/erp/products?archived=true&pageSize=200');
    assert.ok(archived.body.data.items.some((p: { id: string }) => p.id === product.id),
      'archived, not deleted');

    await acme.manager.api('POST', `/api/erp/products/${product.id}/unarchive`, {});
    const back = await acme.manager.api('GET', '/api/erp/products?pageSize=200');
    assert.ok(back.body.data.items.some((p: { id: string }) => p.id === product.id));
  });

  test('the product timeline records the lifecycle', async () => {
    const product = await newProduct();
    await acme.manager.api('DELETE', `/api/erp/products/${product.id}`);
    const r = await acme.manager.api('GET', `/api/erp/products/${product.id}/history`);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.items.some((e: { eventType: string }) => e.eventType === 'archived'));
  });

  test('the product timeline is append-only', async () => {
    const product = await newProduct();
    const history = await acme.manager.api('GET', `/api/erp/products/${product.id}/history`);
    const eventId = history.body.data.items[0]?.id;
    if (eventId === undefined) return;

    for (const method of ['PATCH', 'DELETE'] as const) {
      const r = await acme.manager.api(method, `/api/erp/products/${product.id}/history/${eventId}`, {});
      assert.ok(r.status === 404 || r.status === 405,
        `${method} on a product event returned ${r.status} — the timeline must not be editable`);
    }
  });

  test('an agent can read products but not change them', async () => {
    assert.equal((await acme.agent.api('GET', '/api/erp/products')).status, 200);
    assert.equal((await acme.agent.api('POST', '/api/erp/products', { name: 'nope', price: 1 })).status, 403);
  });
});

/* -----------------------------------------------------------------------------
 * Correcting a product — the legacy `PUT /api/products/:id`, restored.
 *
 * This whole block exists because the port dropped the edit path and nothing
 * noticed: a contract test attacks routes that exist, and a route that is
 * simply absent has nothing to fail. Until now a product could be created and
 * archived and never fixed, which for `costPrice` means every profit figure
 * derived from it stays wrong rather than becoming absent.
 * -------------------------------------------------------------------------- */

describe('a product can be corrected after it exists', () => {
  const history = async (id: string) =>
    (await acme.manager.api('GET', `/api/erp/products/${id}/history`)).body.data.items as
      Array<{ eventType: string; field: string | null; oldValue: string | null; newValue: string | null }>;

  test('a field is changed and the stored value comes back', async () => {
    const product = await newProduct();
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, {
      name: 'Corrected Shoe', sku: 'FIXED-1',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.name, 'Corrected Shoe');
    assert.equal(r.body.data.sku, 'FIXED-1');

    const again = await acme.manager.api('GET', `/api/erp/products/${product.id}`);
    assert.equal(again.body.data.name, 'Corrected Shoe', 'and it was actually stored');
  });

  test('a field the patch did not name is left alone', async () => {
    // The reason this is PATCH and not the ERP's PUT. A whole-resource write
    // means a console that reads the row, edits one box and sends the object
    // back rewrites every column — which is how a masked secret gets written
    // over a real one elsewhere in this codebase.
    const product = await newProduct();
    await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, { name: 'Only the name' });

    const after = (await acme.manager.api('GET', `/api/erp/products/${product.id}`)).body.data;
    assert.equal(String(after.costPrice), '2000', 'the cost basis must survive an unrelated edit');
    assert.equal(String(after.packagingCost), '100');
    assert.equal(after.sku, product.sku);
  });

  test('the cost basis can be corrected, and the timeline says exactly what changed', async () => {
    const product = await newProduct();
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, {
      price: '5500', costPrice: '2100',
    });
    assert.equal(r.status, 200);
    assert.equal(String(r.body.data.costPrice), '2100');

    const events = await history(product.id);
    const cost = events.find((e) => e.eventType === 'cost_change');
    assert.ok(cost, 'a cost correction must leave a record');
    assert.equal(cost.field, 'costPrice');
    assert.equal(cost.oldValue, '2000');
    assert.equal(cost.newValue, '2100');

    const price = events.find((e) => e.eventType === 'price_change');
    assert.ok(price, 'and so must a price correction');
    assert.equal(price.oldValue, '5000');
    assert.equal(price.newValue, '5500');
  });

  test('a field that did not change records nothing', async () => {
    // The ERP logged one event per CHANGED field rather than one per submitted
    // one. A timeline that records every save is a timeline nobody reads.
    const product = await newProduct();
    const before = (await history(product.id)).length;
    await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, {
      price: '5000', costPrice: '2000', name: 'Test Shoe renamed',
    });
    assert.equal((await history(product.id)).length, before,
      'the same price and cost, plus an untracked field, is not a change');
  });

  test('money is compared as a decimal, not as text', async () => {
    // `2000` and `2000.00` are the same price. Comparing the string form would
    // record a change that never happened; comparing the float form would
    // eventually miss one that did (M-06).
    const product = await newProduct();
    const before = (await history(product.id)).length;
    await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, { costPrice: '2000.00' });
    assert.equal((await history(product.id)).length, before);
  });

  test('stock is refused, because a level without a reason is not a level (D-LP.1)', async () => {
    // The ERP's PUT recomputed the stock column from whatever was sent. Here
    // stock is owned by the movement ledger: `applyMovement` writes the level
    // and its reason in one transaction, and that pairing is the only reason
    // the cost basis can be trusted at all.
    const product = await newProduct({ variants: [{ name: 'Solo', stock: 12 }] });
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, { stock: 999 });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');

    const inv = await acme.manager.api('GET', `/api/erp/products/${product.id}/inventory`);
    assert.equal(inv.body.data.variants[0].stock, 12, 'and nothing moved');
  });

  test('variants are refused rather than half-honoured', async () => {
    const product = await newProduct({ variants: [{ name: 'Solo', stock: 12 }] });
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, {
      variants: [{ name: 'Solo', stock: 0 }],
    });
    assert.equal(r.status, 422);

    const inv = await acme.manager.api('GET', `/api/erp/products/${product.id}/inventory`);
    assert.equal(inv.body.data.variants[0].stock, 12);
  });

  test('an invalid batch changes nothing at all', async () => {
    // Half-applying a rejected request is worse than refusing it: the caller is
    // told it failed and half of it happened anyway. Same rule as the settings
    // route, and it is why `buildProductPatch` returns on the first problem.
    const product = await newProduct();
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, {
      name: 'Should not stick', costPrice: 'not-a-number',
    });
    assert.equal(r.status, 422);

    const after = (await acme.manager.api('GET', `/api/erp/products/${product.id}`)).body.data;
    assert.equal(after.name, product.name, 'the valid half must not have landed');
  });

  test('an empty name is refused', async () => {
    const product = await newProduct();
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, { name: '   ' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
  });

  test('a negative price is refused', async () => {
    const product = await newProduct();
    assert.equal(
      (await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, { price: '-1' })).status,
      422,
    );
  });

  test('an empty patch succeeds and does nothing', async () => {
    // A form that submits only what somebody touched sends nothing when they
    // touched nothing. Refusing that would make "save" fail for doing what was
    // asked.
    const product = await newProduct();
    const before = (await history(product.id)).length;
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, {});
    assert.equal(r.status, 200);
    assert.equal((await history(product.id)).length, before);
  });

  test('an archived product can still be corrected', async () => {
    // Archiving means "stop selling it", not "freeze it". A wrong cost basis is
    // usually found from a report about something nobody sells any more.
    const product = await newProduct();
    await acme.manager.api('DELETE', `/api/erp/products/${product.id}`);
    const r = await acme.manager.api('PATCH', `/api/erp/products/${product.id}`, { costPrice: '2500' });
    assert.equal(r.status, 200);
    assert.equal(String(r.body.data.costPrice), '2500');
    assert.equal(r.body.data.archived, true, 'and it stays archived');
  });

  test('an agent cannot correct a product', async () => {
    const product = await newProduct();
    const r = await acme.agent.api('PATCH', `/api/erp/products/${product.id}`, { price: '1' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'FORBIDDEN');
  });

  test('another tenant’s product answers 404, not 403', async () => {
    // 404 rather than 403 throughout: confirming a row exists elsewhere is
    // itself information.
    const beta = await makeErpTenant('catalog-edit-beta');
    const theirs = (await beta.manager.api('POST', '/api/erp/products', {
      name: 'Beta Only', price: 100, costPrice: 40,
    })).body.data;

    const r = await acme.manager.api('PATCH', `/api/erp/products/${theirs.id}`, { costPrice: '1' });
    assert.equal(r.status, 404);

    const still = await beta.manager.api('GET', `/api/erp/products/${theirs.id}`);
    assert.equal(String(still.body.data.costPrice), '40', 'untouched');
  });

  test('a product that does not exist answers 404', async () => {
    const r = await acme.manager.api('PATCH', '/api/erp/products/nonexistent', { price: '1' });
    assert.equal(r.status, 404);
  });
});

/* -----------------------------------------------------------------------------
 * Inventory — the FIFO ledger
 * -------------------------------------------------------------------------- */

describe('stock movements are a ledger, not a counter', () => {
  test('a purchase lot raises stock and records its own cost', async () => {
    const product = await newProduct({ variants: [{ name: 'Black/42', stock: 20, threshold: 5 }] });

    const r = await acme.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
      variantName: 'Black/42', mode: 'purchase', qty: 10, unitCost: 2500, packagingCost: 120,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.inventory.variants[0].stock, 30);

    const lots = await acme.manager.api(
      'GET', `/api/erp/products/${product.id}/stock-lots?variantName=${encodeURIComponent('Black/42')}`,
    );
    const lot = lots.body.data.active.find((l: { unitCost: string }) => String(l.unitCost) === '2500');
    assert.ok(lot, 'the new lot is active');
    assert.equal(lot.qtyRemaining, 10);
  });

  test('a manual adjustment appends to the ledger rather than overwriting a total', async () => {
    const product = await newProduct({ variants: [{ name: 'Black/42', stock: 20, threshold: 5 }] });
    await acme.manager.api('POST', `/api/erp/products/${product.id}/inventory/adjust`, {
      variantName: 'Black/42', delta: -5, reason: 'damaged',
    });

    const r = await acme.manager.api(
      'GET', `/api/erp/products/${product.id}/inventory/history?variant=all`,
    );
    const movement = r.body.data.items.find(
      (m: { reason: string; delta: number }) => m.reason === 'damaged' && m.delta === -5,
    );
    assert.ok(movement, 'the adjustment is in the ledger');
    assert.equal(movement.prevQty, 20, 'and it carries where stock was');
    assert.equal(movement.newQty, 15, 'and where it went');
  });

  test('the movement ledger cannot be rewritten', async () => {
    // The whole reason InventoryMovement carries prevQty and newQty rather than
    // just a delta: the history has to be reconstructable and unarguable. An
    // UPDATE path would make it neither.
    const product = await newProduct({ variants: [{ name: 'Black/42', stock: 20 }] });
    await acme.manager.api('POST', `/api/erp/products/${product.id}/inventory/adjust`, {
      variantName: 'Black/42', delta: -1, reason: 'damaged',
    });
    const history = await acme.manager.api(
      'GET', `/api/erp/products/${product.id}/inventory/history?variant=all`,
    );
    const movementId = history.body.data.items[0].id;

    for (const method of ['PATCH', 'DELETE'] as const) {
      const r = await acme.manager.api(
        method, `/api/erp/products/${product.id}/inventory/history/${movementId}`, { delta: 100 },
      );
      assert.ok(r.status === 404 || r.status === 405,
        `${method} on a movement returned ${r.status} — the ledger must be append-only`);
    }
  });

  test('a cancellation returns stock to the lots it came from', async () => {
    // MovementLotConsumption exists for exactly this: a confirm records what it
    // consumed, and the matching cancel restores those lots rather than
    // guessing. Guessing means the cost basis drifts every time an order is
    // cancelled, and the profit calculator quietly stops being true.
    const product = await newProduct({ variants: [{ name: 'Solo', stock: 0 }] });
    await acme.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
      variantName: 'Solo', mode: 'purchase', qty: 5, unitCost: 1000,
    });
    await acme.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
      variantName: 'Solo', mode: 'purchase', qty: 5, unitCost: 2000,
    });

    const order = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'FIFO', phone: phone(), product: product.name, productVariant: 'Solo',
      quantity: 3, price: 9000,
    });
    const id = order.body.data.id;
    await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { status: 'confirmed' });
    await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { status: 'cancelled' });

    const lots = await acme.manager.api(
      'GET', `/api/erp/products/${product.id}/stock-lots?variantName=Solo`,
    );
    const cheap = lots.body.data.active.find((l: { unitCost: string }) => String(l.unitCost) === '1000');
    assert.equal(cheap.qtyRemaining, 5,
      'the cheap lot FIFO consumed was restored to exactly what it was');
  });

  test('low-stock listing responds and respects the threshold', async () => {
    const r = await acme.manager.api('GET', '/api/erp/inventory/low-stock');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data.items));
  });

  test('another tenant’s product cannot be adjusted', async () => {
    const beta = await makeErpTenant('inventory-beta');
    const theirs = (await beta.manager.api('POST', '/api/erp/products', {
      name: 'Beta Widget', price: 100, variants: [{ name: 'Solo', stock: 10 }],
    })).body.data;

    const r = await acme.manager.api('POST', `/api/erp/products/${theirs.id}/inventory/adjust`, {
      variantName: 'Solo', delta: -10, reason: 'sabotage',
    });
    assert.equal(r.status, 404);

    const still = await beta.manager.api('GET', `/api/erp/products/${theirs.id}/inventory`);
    assert.equal(still.body.data.variants[0].stock, 10, 'untouched');
  });
});

/* -----------------------------------------------------------------------------
 * The client registry
 * -------------------------------------------------------------------------- */

describe('the customer registry is permanent', () => {
  test('an order creates a client keyed on the normalised phone', async () => {
    const number = phone();
    await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Registry Test', phone: number, price: 1000,
    });
    const r = await acme.manager.api('GET', `/api/erp/clients?search=${number}`);
    assert.equal(r.body.data.items.length, 1);
    assert.equal(r.body.data.items[0].totalOrders, 1);
  });

  test('two orders from the same number are one customer', async () => {
    const number = phone();
    // Deliberately different raw forms of the same number.
    await acme.manager.api('POST', '/api/erp/orders', { client: 'Repeat', phone: number, price: 1000 });
    await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Repeat', phone: `+213${number.slice(1)}`, price: 2000,
    });

    const r = await acme.manager.api('GET', `/api/erp/clients?search=${number}`);
    assert.equal(r.body.data.items.length, 1, 'one customer, not two');
    assert.equal(r.body.data.items[0].totalOrders, 2);
  });

  test('imported figures stay separate from observed ones', async () => {
    // A spreadsheet import must never be mistaken for history this system
    // watched happen, which is why there are two sets of counters.
    const number = phone();
    await acme.manager.api('POST', '/api/erp/orders', { client: 'Mixed', phone: number, price: 1000 });
    const r = await acme.manager.api('GET', `/api/erp/clients?search=${number}`);
    const client = r.body.data.items[0];
    assert.equal(client.totalOrders, 1);
    assert.equal(client.importedTotalOrders, 0, 'nothing was imported');
  });

  test('filter options are exposed to a manager', async () => {
    const r = await acme.manager.api('GET', '/api/erp/clients/filter-options');
    assert.equal(r.status, 200);
    assert.ok(r.body.data && typeof r.body.data === 'object');
  });
});

/* -----------------------------------------------------------------------------
 * Agents
 *
 * The ERP's `agents` table is gone — it became User + Membership (M-02), so
 * these are now the team-management surfaces of the ERP product rather than a
 * second identity system. What survives is the payroll configuration, which is
 * genuinely ERP data and has nowhere else to live.
 * -------------------------------------------------------------------------- */

describe('agents and payroll configuration', () => {
  test('the roster lists the tenant’s members and nobody else’s', async () => {
    const beta = await makeErpTenant('agents-beta');
    const r = await acme.manager.api('GET', '/api/erp/agents');
    assert.equal(r.status, 200);

    const ids = (r.body.data.items ?? r.body.data).map((a: { userId: string }) => a.userId);
    assert.ok(ids.includes(acme.agent.userId));
    assert.ok(!ids.includes(beta.agent.userId), "another company's staff must not be listed");
  });

  test('no password material appears anywhere in the response (SEC-02)', async () => {
    // The original finding: GET /api/agents returned every password in
    // cleartext and the agent PWA compared it in the browser. The hash format
    // changed twice since; the rule did not.
    const r = await acme.manager.api('GET', '/api/erp/agents');
    const raw = JSON.stringify(r.body);
    assert.ok(!raw.includes('passwordHash'), 'not even the field name');
    assert.ok(!/scrypt\$|\$argon2|\$2[aby]\$/.test(raw), 'and no hash of any generation');
    for (const agent of (r.body.data.items ?? r.body.data)) {
      assert.ok(!('pass' in agent), 'no "pass"');
      assert.ok(!('password' in agent), 'no "password"');
    }
  });

  test('payment configuration round-trips', async () => {
    const r = await acme.manager.api('PATCH', `/api/erp/agents/${acme.agent.userId}`, {
      baseSalaryMonthly: 30000, payPerConfirmedOrder: 50, payPerDeliveredOrder: 100,
    });
    assert.equal(r.status, 200);
    assert.equal(String(r.body.data.baseSalaryMonthly), '30000');
  });

  test('the job role can be changed and an invalid one refused', async () => {
    assert.equal(
      (await acme.manager.api('PATCH', `/api/erp/agents/${acme.agent.userId}`, { jobRole: 'both' })).status,
      200,
    );
    assert.equal(
      (await acme.manager.api('PATCH', `/api/erp/agents/${acme.agent.userId}`, { jobRole: 'wizard' })).status,
      422,
    );
  });

  test('weekly days off are validated, and out-of-range values dropped', async () => {
    const r = await acme.manager.api('PUT', `/api/erp/agents/${acme.agent.userId}/days-off`, {
      weeklyDaysOff: [5, 99, 'x'],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.weeklyDaysOff, [5], 'out-of-range values are dropped');
  });

  test('suspension is immediate, because sessions are server-side', async () => {
    // The whole reason M-09 chose opaque sessions over a JWT. With a stateless
    // 7-day token a dismissed employee keeps working access for a week.
    const r = await acme.manager.api('POST', `/api/erp/agents/${acme.other.userId}/suspend`, {});
    assert.equal(r.status, 200);

    const after = await acme.other.api('GET', '/api/erp/orders');
    assert.ok(after.status === 401 || after.status === 403,
      `a suspended member must lose access on the very next request (got ${after.status})`);

    await acme.manager.api('POST', `/api/erp/agents/${acme.other.userId}/reactivate`, {});
  });

  test('payroll computes for the tenant', async () => {
    const r = await acme.manager.api(
      'GET', `/api/erp/agents/payroll?since=0&until=${Date.now()}`,
    );
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data.items));
  });

  test('another tenant’s member cannot be suspended', async () => {
    const beta = await makeErpTenant('suspend-beta');
    const r = await acme.manager.api('POST', `/api/erp/agents/${beta.agent.userId}/suspend`, {});
    assert.equal(r.status, 404);
    assert.equal((await beta.agent.api('GET', '/api/erp/orders')).status, 200, 'still working');
  });
});

/* -----------------------------------------------------------------------------
 * Financial records
 * -------------------------------------------------------------------------- */

describe('financial records', () => {
  test('a record is saved and its derived figures are computed, not trusted', async () => {
    const start = Date.now() - 7 * 86400000;
    const end = Date.now();
    const r = await acme.manager.api('POST', '/api/erp/financial-records', {
      periodType: 'week', startDate: start, endDate: end,
      revenue: 100000, productCosts: 40000, shippingCosts: 5000,
      advertisingCosts: 10000, fixedExpenses: 8000, unexpectedExpenses: 0,
      // Deliberately wrong. A client-supplied total is an input to be ignored.
      netProfit: 999999,
    });
    assert.equal(r.status, 201);

    const list = await acme.manager.api('GET', '/api/erp/financial-records?periodType=week');
    const record = list.body.data.items.find(
      (x: { startDate: string }) => new Date(x.startDate).getTime() === start,
    );
    assert.ok(record);
    assert.equal(String(record.netProfit), '37000', 'netProfit is derived, not stored blindly');
  });

  test('saving the same period again inserts rather than updates', async () => {
    // INSERT-ONLY by design: older rows stay forever as a record of what the
    // business looked like AT THE TIME each calculation was made.
    const start = Date.now() - 14 * 86400000;
    const end = Date.now() - 7 * 86400000;
    const body = {
      periodType: 'week', startDate: start, endDate: end,
      revenue: 1000, productCosts: 0, shippingCosts: 0,
      advertisingCosts: 0, fixedExpenses: 0, unexpectedExpenses: 0,
    };
    await acme.manager.api('POST', '/api/erp/financial-records', body);
    await acme.manager.api('POST', '/api/erp/financial-records', { ...body, revenue: 2000 });

    const list = await acme.manager.api('GET', '/api/erp/financial-records?periodType=week&pageSize=200');
    const matching = list.body.data.items.filter(
      (x: { startDate: string }) => new Date(x.startDate).getTime() === start,
    );
    assert.equal(matching.length, 2, 'both calculations survive');
  });

  test('a financial record cannot be edited or removed', async () => {
    const list = await acme.manager.api('GET', '/api/erp/financial-records?pageSize=1');
    const id = list.body.data.items[0]?.id;
    if (!id) return;
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const r = await acme.manager.api(method, `/api/erp/financial-records/${id}`, { revenue: 1 });
      assert.ok(r.status === 404 || r.status === 405,
        `${method} returned ${r.status} — financial records are append-only`);
    }
  });

  test('unexpected charges round-trip and can be removed', async () => {
    // These are NOT append-only, unlike the record above: a one-off expense
    // typed in by mistake has no historical meaning worth preserving.
    const created = await acme.manager.api('POST', '/api/erp/unexpected-charges', {
      label: 'Van repair', amount: 12000, date: new Date().toISOString(),
    });
    assert.equal(created.status, 201);
    const id = created.body.data.id;

    const list = await acme.manager.api('GET', '/api/erp/unexpected-charges');
    assert.ok(list.body.data.items.some((c: { label: string }) => c.label === 'Van repair'));

    await acme.manager.api('DELETE', `/api/erp/unexpected-charges/${id}`);
    const after = await acme.manager.api('GET', '/api/erp/unexpected-charges');
    assert.ok(!after.body.data.items.some((c: { id: number }) => c.id === id));
  });

  test('fixed-cost proration responds', async () => {
    const r = await acme.manager.api('GET', '/api/erp/financial-records/prorate-fixed?periodType=month');
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.data.prorated, 'string', 'money is a decimal string');
  });

  test('another tenant’s books are not visible', async () => {
    const beta = await makeErpTenant('finance-beta');
    await beta.manager.api('POST', '/api/erp/financial-records', {
      periodType: 'year', startDate: Date.now() - 86400000, endDate: Date.now(),
      revenue: 5_000_000, productCosts: 0, shippingCosts: 0,
      advertisingCosts: 0, fixedExpenses: 0, unexpectedExpenses: 0,
    });

    const mine = await acme.manager.api('GET', '/api/erp/financial-records?periodType=year&pageSize=200');
    assert.equal(mine.body.data.items.length, 0, "another company's revenue must not be visible");
  });
});

/* -----------------------------------------------------------------------------
 * Stock moving when an order is confirmed or cancelled — Phase 6.6f
 * -------------------------------------------------------------------------- */

describe('confirming an order takes the stock', () => {
  /** A product with one variant and a known cost, plus two lots at two prices. */
  const stocked = async () => {
    const name = `Widget ${uid()}`;
    const product = (await acme.manager.api('POST', '/api/erp/products', {
      name, sku: `SKU${uid()}`, price: 5000, costPrice: 1000, packagingCost: 100,
      variants: [{ name: 'M', stock: 0 }],
    })).body.data;

    // Two purchases at different prices. Which one a sale consumes is what
    // decides whether that sale made money — the whole reason StockLot exists.
    await acme.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
      variantName: 'M', qty: 3, unitCost: 1000, packagingCost: 100,
    });
    await acme.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
      variantName: 'M', qty: 5, unitCost: 2000, packagingCost: 200,
    });
    return { id: product.id as string, name };
  };

  const stockOf = async (productId: string) => {
    const r = await acme.manager.api('GET', `/api/erp/products/${productId}/inventory`);
    const variants = (r.body.data.variants ?? []) as Array<{ name: string; stock: number }>;
    return variants.find((v) => v.name === 'M')?.stock ?? 0;
  };

  const movementsFor = async (productId: string) =>
    ((await acme.manager.api('GET', `/api/erp/products/${productId}/inventory/history`))
      .body.data.items ?? []) as Array<{ reason: string; delta: number; orderId: string | null }>;

  const orderFor = async (product: { name: string }, quantity = 2) =>
    (await acme.manager.api('POST', '/api/erp/orders', {
      client: `Stock Buyer ${uid()}`, phone: phone(), price: 5000,
      product: product.name, productVariant: 'M', quantity,
    })).body.data as { id: string };

  test('a confirmed order decrements the variant and records why', async () => {
    // This is the gap that would have been a functional regression if apps/erp
    // had been deleted: applyMovement had exactly one caller, the manual adjust
    // route, so a confirmed order consumed nothing at all.
    const product = await stocked();
    assert.equal(await stockOf(product.id), 8, 'precondition: two lots, eight units');

    const order = await orderFor(product, 2);
    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });

    assert.equal(await stockOf(product.id), 6, 'confirming did not take the stock');

    const moves = await movementsFor(product.id);
    const confirm = moves.find((m) => m.orderId === order.id && m.reason === 'confirm');
    assert.ok(confirm, 'no ledger row explains where the stock went');
    assert.equal(confirm!.delta, -2);
  });

  test('logging a confirmed call moves it too — the two doors agree', async () => {
    const product = await stocked();
    const order = await orderFor(product, 3);
    await acme.agent.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });

    assert.equal(await stockOf(product.id), 5, 'confirming by call did not take the stock');
  });

  test('confirming twice does not take the stock twice', async () => {
    // A double-submitted button, a status set twice, PATCH and /call racing.
    // The guard is the ledger itself: a `confirm` movement already recorded
    // against this order means this has run.
    const product = await stocked();
    const order = await orderFor(product, 2);

    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });
    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'no_answer' });
    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });

    assert.equal(await stockOf(product.id), 6, 'the stock was taken twice for one order');
    assert.equal(
      (await movementsFor(product.id)).filter((m) => m.orderId === order.id && m.reason === 'confirm').length,
      1,
    );
  });

  test('cancelling gives it back, to the lots it came from', async () => {
    // The property that makes the profit calculator true: a cancellation
    // returns stock to the SAME lots the reservation consumed, read back from
    // MovementLotConsumption — not to the newest lot and not to the cheapest.
    const product = await stocked();
    const order = await orderFor(product, 4);

    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });
    assert.equal(await stockOf(product.id), 4);

    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'cancelled' });
    assert.equal(await stockOf(product.id), 8, 'cancelling did not restore the stock');

    // FIFO: the four units came from the 3-unit lot at 1000 and one from the
    // 5-unit lot at 2000, and they must go back the same way. The lot listing
    // is what proves it, not the variant total.
    const listed = (await acme.manager.api('GET', `/api/erp/products/${product.id}/stock-lots`))
      .body.data as {
        active: Array<{ unitCost: string; qtyRemaining: number }>;
        exhausted: Array<{ unitCost: string; qtyRemaining: number }>;
      };
    // Both halves: a lot the reservation emptied moves to `exhausted`, and
    // restoring has to bring it back — looking only at `active` would pass while
    // the cheap lot stayed at zero.
    const lots = [...listed.active, ...listed.exhausted];
    const cheap = lots.find((l) => Number(l.unitCost) === 1000);
    const dear = lots.find((l) => Number(l.unitCost) === 2000);
    assert.equal(cheap?.qtyRemaining, 3, 'the cheap lot was not made whole');
    assert.equal(dear?.qtyRemaining, 5, 'the dear lot was not made whole');
  });

  test('cancelling an order that was never confirmed invents no stock', async () => {
    const product = await stocked();
    const order = await orderFor(product, 2);

    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'cancelled' });

    assert.equal(await stockOf(product.id), 8, 'a cancellation created stock out of nothing');
    assert.equal(
      (await movementsFor(product.id)).filter((m) => m.orderId === order.id).length, 0,
    );
  });

  test('reservationMode decides — `none` moves nothing', async () => {
    // The setting has been on the automation screen since 6.3d and read by
    // nothing at all until now, which is BUG-03's shape.
    const product = await stocked();
    await acme.manager.api('PUT', '/api/erp/settings', { reservationMode: 'none' });
    try {
      const order = await orderFor(product, 2);
      await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });
      assert.equal(await stockOf(product.id), 8, 'stock moved while reservation was off');
    } finally {
      await acme.manager.api('PUT', '/api/erp/settings', { reservationMode: 'on_confirm' });
    }
  });

  test('a product name that matches nothing moves nothing, and does not fail the confirm', async () => {
    // The silent-failure case the ERP guarded with a log. The confirmation is
    // real work an agent did; it must be recorded whether or not the catalogue
    // has a matching row.
    const order = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Unmatched', phone: phone(), price: 1000, product: `Nothing ${uid()}`, quantity: 1,
    })).body.data;

    const r = await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });
    assert.equal(r.status, 200, 'an unmatched product name failed the confirmation');
    assert.equal(r.body.data.status, 'confirmed');
  });

  test('the name is matched leniently, because a human typed it', async () => {
    // An order stores the product NAME. A trademark symbol, a double space or
    // different casing must not silently stop stock moving.
    const product = await stocked();
    const order = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Sloppy', phone: phone(), price: 5000,
      product: `  ${product.name.toUpperCase()}™  `, productVariant: 'M', quantity: 1,
    })).body.data;

    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });
    assert.equal(await stockOf(product.id), 7, 'a cosmetic name difference stopped the stock moving');
  });

  test('another tenant’s catalogue is never touched', async () => {
    const product = await stocked();
    const beta = await makeErpTenant('stock-beta');
    const order = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Buyer', phone: phone(), price: 5000,
      product: product.name, productVariant: 'M', quantity: 2,
    })).body.data;

    await beta.manager.api('PATCH', `/api/erp/orders/${order.id}`, { status: 'confirmed' });

    assert.equal(await stockOf(product.id), 8, "a neighbouring tenant consumed this tenant's stock");
  });
});

/* =============================================================================
 * LP.18 / R12 — product fields, the variant editor, and three columns
 *
 * A variant could be created once and never renamed, removed or given a
 * threshold; `optionDefs` had a column since Phase 3.2 with no writer anywhere;
 * and `niche`/`category`/`supplier` were not columns at all — which is why LP.10
 * had to leave a filter out of the customer registry.
 *
 * The property every test here defends is D-LP.18.1: a variant's LEVEL never
 * changes without a movement row behind it.
 * ========================================================================== */

describe('a product carries the three classification fields (R12)', () => {
  test('create accepts niche, category and supplier, and they come back', async () => {
    const r = await acme.manager.api('POST', '/api/erp/products', {
      name: `Classified ${uid()}`, price: 1000,
      niche: 'skincare', category: 'serums', supplier: 'Atlas Cosmetics',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.niche, 'skincare');
    assert.equal(r.body.data.category, 'serums');
    assert.equal(r.body.data.supplier, 'Atlas Cosmetics');
  });

  test('the edit route accepts them too', async () => {
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Reclassify ${uid()}`, price: 500,
    });
    const r = await acme.manager.api('PATCH', `/api/erp/products/${created.body.data.id}`, {
      niche: 'haircare', supplier: 'Sahara Supply',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.niche, 'haircare');
    assert.equal(r.body.data.supplier, 'Sahara Supply');
  });
});

describe('the variant editor writes the matrix and moves stock through the ledger (R12)', () => {
  test('it sets the list, the SKUs, the thresholds and the option definitions', async () => {
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Matrix ${uid()}`, price: 2000,
    });
    const id = created.body.data.id;

    const r = await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      optionDefs: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { name: 'S', sku: 'SKU-S', stock: 5, threshold: 2, options: { Size: 'S' } },
        { name: 'M', sku: 'SKU-M', stock: 7, threshold: 3, options: { Size: 'M' } },
      ],
      reason: 'opening stock',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.variants.length, 2);
    assert.equal(r.body.data.stock, 12, 'the product roll-up follows the variants');
    assert.equal(r.body.data.optionDefs.length, 1, 'optionDefs had NO writer before this slice');
    assert.equal(r.body.data.optionDefs[0].name, 'Size');

    const s = r.body.data.variants.find((v: { name: string }) => v.name === 'S');
    assert.equal(s.stock, 5);
    assert.equal(s.threshold, 2);
    assert.equal(s.sku, 'SKU-S');
  });

  test('every stock difference is a MOVEMENT, carrying the reason', async () => {
    // D-LP.18.1. A level written as a column is a level with no movement row
    // behind it, and the FIFO cost basis stops adding up.
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Ledgered ${uid()}`, price: 900,
    });
    const id = created.body.data.id;

    await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'Blue', stock: 10 }],
      reason: 'opening stock',
    });
    await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'Blue', stock: 4 }],
      reason: 'stocktake',
    });

    const history = await acme.manager.api('GET', `/api/erp/products/${id}/inventory/history`);
    assert.equal(history.status, 200);
    const rows = history.body.data.items ?? history.body.data;
    const deltas = rows.map((m: { delta: number }) => m.delta);
    assert.ok(deltas.includes(10), `the opening stock left no movement: ${JSON.stringify(deltas)}`);
    assert.ok(deltas.includes(-6), 'the correction left no movement');
    const reasons = rows.map((m: { reason: string }) => m.reason);
    assert.ok(reasons.includes('stocktake'), 'the reason must reach the ledger');
  });

  test('a variant that has not moved writes NO movement', async () => {
    // Saving the editor after changing a SKU must not manufacture a zero
    // movement row — a ledger full of no-ops is a ledger nobody reads.
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Untouched ${uid()}`, price: 100,
    });
    const id = created.body.data.id;
    await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'One', stock: 3 }],
    });
    const before = (await acme.manager.api('GET', `/api/erp/products/${id}/inventory/history`))
      .body.data.items.length;

    await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'One', stock: 3, sku: 'CHANGED' }],
    });
    const after = (await acme.manager.api('GET', `/api/erp/products/${id}/inventory/history`))
      .body.data.items.length;
    assert.equal(after, before, 'an unchanged level wrote a movement row');
  });

  test('removing a variant that still holds stock is REFUSED BY NAME', async () => {
    // D-LP.18.2. The ERP silently dropped it and the stock went with it: no
    // movement row, no reason, and a cost basis that no longer adds up.
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Holding ${uid()}`, price: 100,
    });
    const id = created.body.data.id;
    await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'Keep', stock: 1 }, { name: 'Drop', stock: 4 }],
    });

    const r = await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'Keep', stock: 1 }],
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'VARIANT_HOLDS_STOCK');
    assert.deepEqual(r.body.error.variants, ['Drop'], 'it must name what would be lost');

    // And nothing was written.
    const view = await acme.manager.api('GET', `/api/erp/products/${id}/variants`);
    assert.equal(view.body.data.variants.length, 2);
  });

  test('a variant at zero can be removed', async () => {
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Zeroed ${uid()}`, price: 100,
    });
    const id = created.body.data.id;
    await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'Keep', stock: 1 }, { name: 'Empty', stock: 0 }],
    });
    const r = await acme.manager.api('PUT', `/api/erp/products/${id}/variants`, {
      variants: [{ name: 'Keep', stock: 1 }],
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.variants.length, 1);
  });

  test('two variants with one name are refused', async () => {
    // `applyMovement` finds a variant BY NAME: a duplicate is a stock level
    // with two owners.
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Dupe ${uid()}`, price: 100,
    });
    const r = await acme.manager.api('PUT', `/api/erp/products/${created.body.data.id}/variants`, {
      variants: [{ name: 'Same', stock: 1 }, { name: 'Same', stock: 2 }],
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'DUPLICATE_VARIANT');
  });

  test('the product route still REFUSES variants, and now says where they live', async () => {
    const created = await acme.manager.api('POST', '/api/erp/products', {
      name: `Refused ${uid()}`, price: 100,
    });
    const r = await acme.manager.api('PATCH', `/api/erp/products/${created.body.data.id}`, {
      variants: [{ name: 'X', stock: 99 }],
    });
    assert.equal(r.status, 422);
    assert.match(r.body.error.message, /variants/);

    const defs = await acme.manager.api('PATCH', `/api/erp/products/${created.body.data.id}`, {
      optionDefs: [{ name: 'Size', values: ['S'] }],
    });
    assert.equal(defs.status, 422, 'optionDefs belong beside the variants they describe');
  });

  test('it needs erp:inventory:write, not erp:products:write', async () => {
    // The route moves stock. Somebody who may only edit product TEXT must not
    // be able to move a level by renaming a variant.
    const staged = await makeErpTenant(`var-${uid()}`);
    const textOnly = await makeMember(staged.tenantId, {
      role: 'MEMBER', permissions: ['erp:products:write'],
    });
    const created = await staged.manager.api('POST', '/api/erp/products', {
      name: 'Gated', price: 100,
    });
    const r = await textOnly.api('PUT', `/api/erp/products/${created.body.data.id}/variants`, {
      variants: [{ name: 'X', stock: 5 }],
    });
    assert.equal(r.status, 403);
  });

  test('another tenant’s product is a 404', async () => {
    const beta = await makeErpTenant(`varbeta-${uid()}`);
    const theirs = (await beta.manager.api('POST', '/api/erp/products', {
      name: 'Beta Product', price: 10,
    })).body.data.id;
    assert.equal(
      (await acme.manager.api('PUT', `/api/erp/products/${theirs}/variants`, { variants: [] })).status,
      404,
    );
  });
});

/* -----------------------------------------------------------------------------
 * Photographs — PM.2
 *
 * `CatalogProduct.image` and each variant's `image` have been writable since
 * Phase 5, and until this slice nothing could put a FILE into either and nothing
 * rendered one. Building the consumer found a defect on the way in that no
 * route inventory could have seen: the WRITER stores
 * `tenants/<tenantId>/<uuid>.<ext>` and the READER refused any key that was not
 * a single path segment, so every image uploaded through the console 404'd
 * unless the deployment happened to have a PUBLIC R2 bucket.
 *
 * The round trip is the assertion, deliberately. A test that only checks the
 * upload answers 200 is a test of half a feature — and it is exactly the half
 * that was already correct.
 * -------------------------------------------------------------------------- */

describe('a product photograph survives the round trip', () => {
  test('upload, then fetch the URL it returned', async () => {
    const form = new FormData();
    form.append('file', new Blob([ONE_PIXEL_PNG], { type: 'image/png' }), 'pixel.png');

    const posted = await raw('POST', '/api/erp/uploads', acme.manager.token, form);
    assert.equal(posted.status, 200);
    const envelope = await posted.json();
    assert.ok(envelope.success);

    const url = envelope.data.url as string;
    assert.match(url, /^\/uploads\/tenants\//, 'the key is scoped to the tenant');

    // THE HALF THAT WAS BROKEN. Anonymous on purpose: a storefront customer has
    // no session and product images must still resolve.
    const served = await raw('GET', url, undefined);
    assert.equal(served.status, 200, 'the URL the uploader returned must resolve');
    assert.match(served.headers.get('content-type') ?? '', /^image\//);
  });

  test('the upload is gated on the permission that stores the result', async () => {
    // `erp:products:write`. Somebody who cannot attach an image to anything has
    // no business filling a bucket with them.
    const reader = await makeMember(acme.tenantId, { role: 'MEMBER', jobRole: 'confirmation' });
    const form = new FormData();
    form.append('file', new Blob([ONE_PIXEL_PNG], { type: 'image/png' }), 'pixel.png');
    const r = await raw('POST', '/api/erp/uploads', reader.token, form);
    assert.equal(r.status, 403);
  });

  test('a request with no file is refused by name', async () => {
    const r = await raw('POST', '/api/erp/uploads', acme.manager.token, new FormData());
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 'NO_FILE');
  });

  test('a file that is not an image is refused by name', async () => {
    const form = new FormData();
    form.append('file', new Blob(['#!/bin/sh\nrm -rf /'], { type: 'text/plain' }), 'x.sh');
    const r = await raw('POST', '/api/erp/uploads', acme.manager.token, form);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 'INVALID_FILE_TYPE');
  });

  test('the serving route still refuses to walk out of its directory', async () => {
    // The nesting fix widened what the reader accepts, so the guard it widened
    // is asserted rather than assumed. Every segment must be safe, and the
    // depth is capped — a malformed record must not become a directory walk.
    for (const bad of [
      '/uploads/tenants/..%2F..%2Fetc/passwd',
      '/uploads/..%2F..%2Fpackage.json',
      '/uploads/a/b/c/d/e/f.png',
    ]) {
      const r = await raw('GET', bad, undefined);
      assert.equal(r.status, 404, `${bad} must not resolve`);
    }
  });

  test('a variant carries its own photograph, and the product is the fallback', async () => {
    // The legacy's rule, and now this one's: a variant with no image of its own
    // shows the product's. The API half is asserted here; the resolution lives
    // in `lib/erp/order-product.ts` for every screen that renders one.
    const product = await newProduct({ image: '/uploads/tenants/x/product.png' });
    const r = await acme.manager.api('PUT', `/api/erp/products/${product.id}/variants`, {
      variants: [
        { name: 'Blue', stock: 5, image: '/uploads/tenants/x/blue.png' },
        { name: 'Red', stock: 5 },
      ],
    });
    assert.equal(r.status, 200);
    const variants = r.body.data.variants as Array<{ name: string; image?: string }>;
    assert.equal(variants.find((v) => v.name === 'Blue')?.image, '/uploads/tenants/x/blue.png');
    assert.equal(variants.find((v) => v.name === 'Red')?.image ?? '', '');
  });
});
