import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant } from '@landingos/db';

import {
  skip, BASE, uid, phone, makeTenant, makeMember, makeErpTenant, slugOf, cleanup,
  contractTest as test,
  type Caller,
} from './helpers.ts';

/* =============================================================================
 * test/erp/order-split.test.ts — M-05, Phase 5.4.
 *
 * The one contract file with no ERP ancestor, because the case it covers could
 * not exist before: two products, in one database, both with an "Order".
 *
 * 3.2 settled that one schema cannot hold two, and named them — SalesOrder is
 * the IMMUTABLE commercial snapshot of what a customer agreed to buy,
 * FulfillmentOrder is the MUTABLE record of getting it to them. Only the names
 * landed. This is the relationship, and the thing it replaces: a storefront
 * checkout used to write the sale and then fire an unawaited HTTP webhook that
 * the ERP turned into its own order.
 *
 * That is what these tests are really about. A fire-and-forget network call
 * between two products in the SAME database can fail after the sale is
 * recorded, leaving the call-centre with nothing to confirm, no error anybody
 * sees, and nothing to reconcile the two — which is precisely the class of
 * silent, invisible defect this whole port has been chasing.
 * ========================================================================== */

let erp: Awaited<ReturnType<typeof makeErpTenant>>;
let erpSlug = '';
let builderOnly = '';
let builderOnlySlug = '';
let builderOnlyOwner: Caller;

/** Build a published page with a priced wilaya, and return what checkout needs. */
async function storefront(tenantId: string) {
  return withTenant(tenantId, async (db) => {
    const page = await db.landingPage.create({
      data: {
        tenantId,
        title: `Split Widget ${uid()}`,
        slug: `split-${uid()}`,
        price: 4900,
        published: true,
        status: 'PUBLISHED',
      },
      select: { id: true, title: true },
    });
    const wilaya = await asPlatform().wilaya.findFirst({ select: { id: true, name: true } });
    // Upsert, not create: the price is per (tenant, wilaya) and this helper runs
    // once per test against the same tenant and the same first wilaya.
    await db.tenantDeliveryPrice.upsert({
      where: { tenantId_wilayaId: { tenantId, wilayaId: wilaya!.id } },
      create: { tenantId, wilayaId: wilaya!.id, homePrice: 500, deskPrice: 300 },
      update: {},
    });
    const baladia = await asPlatform().baladia.findFirst({
      where: { wilayaId: wilaya!.id },
      select: { name: true },
    });
    return { page, wilaya: wilaya!, baladiaName: baladia?.name ?? 'Centre' };
  });
}

async function checkout(slug: string, shop: Awaited<ReturnType<typeof storefront>>) {
  const res = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      landingPageId: shop.page.id,
      customerName: 'Split Customer',
      phone: phone(),
      wilayaId: shop.wilaya.id,
      baladiaName: shop.baladiaName,
      address: '12 Rue de Test',
      quantity: 2,
      variantIds: [],
      shippingMethod: 'HOME',
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

before(async () => {
  if (skip) return;
  erp = await makeErpTenant('split');
  erpSlug = await slugOf(erp.tenantId);
  // Deliberately entitled to the builder ONLY. Neither product is privileged,
  // and selling must not require owning the other one.
  builderOnly = await makeTenant('split-builder', ['product.website-builder']);
  builderOnlySlug = await slugOf(builderOnly);
  builderOnlyOwner = await makeMember(builderOnly, { role: 'OWNER' });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

describe('a storefront sale creates its fulfilment record in the same transaction', () => {
  test('the sale and the operational order both exist, and are linked', async () => {
    const shop = await storefront(erp.tenantId);
    const placed = await checkout(erpSlug, shop);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));

    const salesOrderId = placed.body.data.id;
    const linked = await withTenant(erp.tenantId, (db) =>
      db.fulfillmentOrder.findUnique({
        where: { salesOrderId },
        select: { id: true, client: true, quantity: true, price: true, status: true, source: true },
      }),
    );

    assert.ok(linked, 'the ERP has something to confirm');
    assert.equal(linked.client, 'Split Customer');
    assert.equal(linked.quantity, 2);
    assert.equal(linked.status, 'pending', 'a storefront submission is a request to buy, not a sale');
    assert.equal(linked.source, 'storefront', 'provenance is recorded');
  });

  test('the money is COPIED from the snapshot, not recomputed', async () => {
    // The sale is what the customer agreed to pay. Recalculating it here would
    // let tomorrow's price change alter an order already placed.
    const shop = await storefront(erp.tenantId);
    const placed = await checkout(erpSlug, shop);
    const salesOrderId = placed.body.data.id;

    const [sale, fulfilment] = await withTenant(erp.tenantId, async (db) => [
      await db.salesOrder.findUnique({
        where: { id: salesOrderId },
        select: { totalPrice: true, productPrice: true, shippingPrice: true },
      }),
      await db.fulfillmentOrder.findUnique({
        where: { salesOrderId },
        select: { price: true, unitPrice: true, shippingCost: true },
      }),
    ]);

    assert.equal(String(fulfilment!.price), String(sale!.totalPrice));
    assert.equal(String(fulfilment!.unitPrice), String(sale!.productPrice));
    assert.equal(String(fulfilment!.shippingCost), String(sale!.shippingPrice));
  });

  test('it shows up in the ERP order list, where an agent will work it', async () => {
    const shop = await storefront(erp.tenantId);
    await checkout(erpSlug, shop);

    const list = await erp.manager.api('GET', '/api/erp/orders?pageSize=100&search=Split Customer');
    assert.ok(list.body.data.items.length > 0, 'the call-centre can see it');
    assert.ok(list.body.data.items[0].reference, 'and it has a number to read out');
  });

  test('the customer joins the registry like any other', async () => {
    // Not a separate kind of customer nobody counted: lifetime history
    // accumulates through the same function every order path uses.
    const shop = await storefront(erp.tenantId);
    const placed = await checkout(erpSlug, shop);
    const fulfilment = await withTenant(erp.tenantId, (db) =>
      db.fulfillmentOrder.findUnique({
        where: { salesOrderId: placed.body.data.id },
        select: { phoneNormalized: true },
      }),
    );

    const clients = await erp.manager.api(
      'GET', `/api/erp/clients?search=${fulfilment!.phoneNormalized}`,
    );
    assert.equal(clients.body.data.items.length, 1);
    assert.equal(clients.body.data.items[0].totalOrders, 1);
  });
});

describe('neither product is privileged', () => {
  test('a tenant with the builder but NOT the ERP can still sell', async () => {
    const shop = await storefront(builderOnly);
    const placed = await checkout(builderOnlySlug, shop);
    assert.equal(placed.status, 201, 'the sale must not depend on owning the other product');

    const fulfilment = await withTenant(builderOnly, (db) =>
      db.fulfillmentOrder.findUnique({ where: { salesOrderId: placed.body.data.id } }),
    );
    assert.equal(fulfilment, null, 'and no fulfilment record was invented for them');
  });

  test('the sale itself is intact for that tenant', async () => {
    const orders = await builderOnlyOwner.api('GET', '/api/builder/orders?pageSize=50');
    assert.equal(orders.status, 200);
    assert.ok(orders.body.data.items.length > 0);
  });
});

describe('the link is one-to-one and idempotent', () => {
  test('a fulfilment order cannot be created twice for one sale', async () => {
    // A retried checkout, or a replayed event, must not produce two parcels for
    // one payment. `salesOrderId` is unique, and the bridge checks first.
    const shop = await storefront(erp.tenantId);
    const placed = await checkout(erpSlug, shop);
    const salesOrderId = placed.body.data.id;

    const count = await withTenant(erp.tenantId, (db) =>
      db.fulfillmentOrder.count({ where: { salesOrderId } }),
    );
    assert.equal(count, 1);

    await assert.rejects(
      () =>
        withTenant(erp.tenantId, (db) =>
          db.fulfillmentOrder.create({
            data: { tenantId: erp.tenantId, salesOrderId, client: 'Duplicate' },
          }),
        ),
      'the database refuses a second fulfilment for the same sale',
    );
  });

  test('another tenant cannot link to this tenant’s sale', async () => {
    const shop = await storefront(erp.tenantId);
    const placed = await checkout(erpSlug, shop);

    const beta = await makeErpTenant('split-beta');
    await assert.rejects(
      () =>
        withTenant(beta.tenantId, (db) =>
          db.fulfillmentOrder.create({
            data: { tenantId: beta.tenantId, salesOrderId: placed.body.data.id, client: 'Thief' },
          }),
        ),
      'the foreign key cannot reach across the tenant boundary',
    );
  });
});
