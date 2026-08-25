import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';
import { withTenant } from '@landingos/db';

import {
  skip, BASE, uid, phone, makeTenant, makeErpTenant, slugOf,
  storefront, checkout, draftCapture, draftToken, cleanup,
  contractTest as test,
  type Storefront,
} from './helpers.ts';

/* =============================================================================
 * test/erp/abandoned-bridge.test.ts — LB.57.
 *
 * The counterpart of `order-split.test.ts`: that file proves a COMPLETED sale
 * reaches the call-centre, this one proves the cart that never completed does
 * too.
 *
 * The defect it closes was not a broken write — it was the absence of one.
 * `DraftOrder` had no reader anywhere beneath `api/erp`, `console/erp` or
 * `lib/erp`, so a lead the merchant paid for sat in a builder-side list while
 * the identical record arriving from Shopify became a callable order. Nothing
 * failed, nothing logged, and every route test passed.
 *
 * WHY THE ASSERTIONS ARE SCREEN-SHAPED. A row in a table is not a lead anybody
 * can call. LB.23b shipped a feature that was correct in seventeen route tests
 * and unreachable from any UI, and the fix was assertions against the rendered
 * console. So the two that matter here fetch the real orders screen and the
 * real agent queue and look for the order's id in the HTML.
 * ========================================================================== */

let erp: Awaited<ReturnType<typeof makeErpTenant>>;
let erpSlug = '';
let shop: Storefront;
let builderOnlySlug = '';
let builderOnlyId = '';

/** The console renders every row's detail link, so the id is a stable hook. */
const html = async (path: string, token: string) => {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}; locale=en` },
  });
  return { status: res.status, body: await res.text() };
};

/** The ERP row raised for a draft, or null. */
const leadFor = (draftOrderId: string) =>
  withTenant(erp.tenantId, (db) =>
    db.fulfillmentOrder.findUnique({
      where: { draftOrderId },
      select: {
        id: true, reference: true, client: true, phone: true, phoneNormalized: true,
        wilaya: true, commune: true, product: true, quantity: true, price: true,
        status: true, orderType: true, source: true, salesOrderId: true,
        agentUserId: true, draftOrderId: true,
      },
    }),
  );

/** Every ERP row pointing at this draft — the count is what "exactly one" means. */
const leadCount = (draftOrderId: string) =>
  withTenant(erp.tenantId, (db) =>
    db.fulfillmentOrder.count({ where: { draftOrderId } }),
  );

/**
 * The draft row itself.
 *
 * Annotated because `draftOrder` is reached through `as any` — the storefront
 * routes do the same, since the tenant client's generated types do not carry
 * the builder models. Without the annotation the awaited value widens to `{}`
 * and every `.id` below is a type error rather than a test.
 */
type DraftRow = { id: string; phone: string | null; customerName: string | null };

const draftByToken = (tenantId: string, token: string): Promise<DraftRow | null> =>
  withTenant(tenantId, (db) =>
    (db as any).draftOrder.findUnique({
      where: { token },
      select: { id: true, phone: true, customerName: true },
    }),
  );

before(async () => {
  if (skip) return;
  erp = await makeErpTenant('draftbridge');
  erpSlug = await slugOf(erp.tenantId);
  shop = await storefront(erp.tenantId);

  // Entitled to the builder ONLY. Selling — and abandoning — must not require
  // owning the ERP, and the bridge must stay silent for a tenant without it.
  builderOnlyId = await makeTenant('draftbridge-builder', ['product.website-builder']);
  builderOnlySlug = await slugOf(builderOnlyId);
});

after(async () => {
  if (skip) return;
  await cleanup();
});

describe('a captured cart becomes a callable lead', () => {
  test('a callable phone raises exactly one abandoned order', async () => {
    const token = draftToken();
    const customerName = `Abandoned ${uid()}`;
    const number = phone();

    await draftCapture(erpSlug, shop, token, {
      customerName, phone: number, wilaya: 'Alger', baladia: 'Bab Ezzouar', quantity: 3,
    });

    const draft = await draftByToken(erp.tenantId, token);
    assert.ok(draft, 'the draft itself is still captured');

    const lead = await leadFor(draft.id);
    assert.ok(lead, 'the call-centre has a lead to ring');
    assert.equal(lead.client, customerName);
    assert.equal(lead.wilaya, 'Alger');
    assert.equal(lead.commune, 'Bab Ezzouar');
    assert.equal(lead.quantity, 3);
    assert.equal(lead.orderType, 'abandoned', 'identifiable as a cart nobody completed');
    assert.equal(lead.source, 'storefront_abandoned', 'provenance is recorded');
    assert.ok(lead.reference, 'it has a number an agent can read down the phone');
    assert.equal(
      String(lead.price), '0',
      'a draft carries no prices, so nothing here may look like money',
    );
  });

  test('repeated captures do not raise a second one', async () => {
    const token = draftToken();
    const number = phone();
    const capture = (extra: Record<string, unknown>) =>
      draftCapture(erpSlug, shop, token, { phone: number, ...extra });

    await capture({ customerName: `Repeat ${uid()}` });
    const draft = await draftByToken(erp.tenantId, token);
    assert.ok(draft);

    // The client debounces on every keystroke. One visitor is one lead however
    // many times they edit the form.
    await capture({ customerName: `Repeat ${uid()}`, wilaya: 'Oran' });
    await capture({ customerName: `Repeat ${uid()}`, wilaya: 'Oran', baladia: 'Es Senia' });
    await capture({ customerName: `Repeat ${uid()}`, wilaya: 'Oran', baladia: 'Es Senia', quantity: 2 });

    assert.equal(await leadCount(draft.id), 1, 'one visitor, one lead');
  });

  test('a half-typed number raises nothing, and the finished one raises the lead', async () => {
    const token = draftToken();
    const customerName = `Partial ${uid()}`;

    // `use-draft-capture` fires at SIX digits and an Algerian mobile is ten, so
    // this is the ordinary case, not a contrived one. A row created here would
    // hand an agent a number that does not ring.
    await draftCapture(erpSlug, shop, token, { customerName, phone: '055823' });

    const draft = await draftByToken(erp.tenantId, token);
    assert.ok(draft, 'the draft is captured either way — it is still a lead in progress');
    assert.equal(await leadCount(draft.id), 0, 'a partial number is not a callable lead');

    // The rest of the number arrives on the next debounce. This capture is NOT
    // `leadArrived` — the draft already had a phone — which is exactly why the
    // bridge is not gated on that flag.
    await draftCapture(erpSlug, shop, token, { customerName, phone: '0558236002' });

    const lead = await leadFor(draft.id);
    assert.ok(lead, 'the completed number raises the lead the partial one could not');
    assert.equal(lead.phoneNormalized, '0558236002');
  });

  test('a capture with no phone at all raises nothing', async () => {
    const token = draftToken();
    await draftCapture(erpSlug, shop, token, { customerName: `Nameless ${uid()}` });

    const draft = await draftByToken(erp.tenantId, token);
    assert.ok(draft, 'a name alone is still worth capturing');
    assert.equal(await leadCount(draft.id), 0, 'nothing to call');
  });
});

describe('later captures top up without overwriting', () => {
  test('a blank field fills, and a known one is left alone', async () => {
    const token = draftToken();
    const original = `Original ${uid()}`;
    const number = phone();

    await draftCapture(erpSlug, shop, token, { customerName: original, phone: number });
    const draft = await draftByToken(erp.tenantId, token);
    assert.ok(draft);

    const before = await leadFor(draft.id);
    assert.ok(before);
    assert.equal(before.wilaya, '', 'the wilaya is typed after the phone, so it starts blank');

    // The customer picks their wilaya, and the form re-sends everything it
    // knows — including a name the agent may already have corrected.
    await draftCapture(erpSlug, shop, token, {
      customerName: `Changed ${uid()}`, phone: number, wilaya: 'Constantine', baladia: 'El Khroub',
    });

    const after = await leadFor(draft.id);
    assert.ok(after);
    assert.equal(after.wilaya, 'Constantine', 'the blank filled');
    assert.equal(after.commune, 'El Khroub', 'the blank filled');
    assert.equal(after.client, original, 'what was already known is never overwritten');
    assert.equal(await leadCount(draft.id), 1, 'a top-up is not a second lead');
  });

  test('a corrected phone number replaces the one that would not ring', async () => {
    const token = draftToken();
    const typo = '0558236002';
    const corrected = '0770292634';

    await draftCapture(erpSlug, shop, token, { customerName: `Typo ${uid()}`, phone: typo });
    const draft = await draftByToken(erp.tenantId, token);
    assert.ok(draft);
    assert.equal((await leadFor(draft.id))?.phoneNormalized, typo);

    await draftCapture(erpSlug, shop, token, { customerName: `Typo ${uid()}`, phone: corrected });

    const after = await leadFor(draft.id);
    assert.equal(
      after?.phoneNormalized, corrected,
      'the deliberate exception to never-overwrite: this link is per visitor, ' +
      'not per phone, so the old number is simply wrong',
    );
    assert.equal(await leadCount(draft.id), 1);
  });
});

describe('the lead is reachable, and workable — LB.57 decision 1', () => {
  let leadId = '';
  let passiveId = '';

  before(async () => {
    if (skip) return;
    const token = draftToken();
    await draftCapture(erpSlug, shop, token, {
      customerName: `Queued ${uid()}`, phone: phone(), wilaya: 'Blida', baladia: 'Boufarik',
    });
    const draft = await draftByToken(erp.tenantId, token);
    leadId = (await leadFor(draft!.id))!.id;

    // A `lead-capture` row, written the way that endpoint writes one: status
    // `abandoned`, which IS terminal. It is the control for the decision — the
    // storefront's leads had to become workable WITHOUT dragging these with
    // them, because anybody who knows that endpoint's URL can create one.
    passiveId = await withTenant(erp.tenantId, async (db) => {
      const row = await db.fulfillmentOrder.create({
        data: {
          tenantId: erp.tenantId,
          reference: `ORD-LC-${uid()}`,
          client: `Passive ${uid()}`,
          phone: '0555000111',
          phoneNormalized: '0555000111',
          price: 0,
          orderType: 'abandoned',
          status: 'abandoned',
          source: 'lead_capture',
        },
        select: { id: true },
      });
      return row.id;
    });
  });

  test('it renders on the ERP orders screen', async () => {
    const res = await html('/console/erp/orders', erp.manager.token);
    assert.equal(res.status, 200);
    assert.ok(
      res.body.includes(leadId),
      'an abandoned cart that no screen shows is the defect this slice closes',
    );
  });

  test('it renders in the agent call queue', async () => {
    const res = await html('/console/erp/queue', erp.manager.token);
    assert.equal(res.status, 200);
    assert.ok(
      res.body.includes(leadId),
      'the whole point is that somebody rings this customer back',
    );
  });

  test('lead-capture rows stay passive — the decision did not leak', async () => {
    const res = await html('/console/erp/queue', erp.manager.token);
    assert.equal(res.status, 200);
    assert.ok(
      !res.body.includes(passiveId),
      'TERMINAL_STATUSES was left alone on purpose: an unauthenticated public ' +
      'endpoint must not be able to fill the call queue',
    );
  });
});

describe('a tenant without the ERP', () => {
  test('captures the cart and raises nothing', async () => {
    const token = draftToken();
    const theirShop = await storefront(builderOnlyId);

    await draftCapture(builderOnlySlug, theirShop, token, {
      customerName: `NoErp ${uid()}`, phone: phone(), wilaya: 'Setif',
    });

    const draft = await draftByToken(builderOnlyId, token);
    assert.ok(draft, 'selling — and abandoning — never required owning the ERP');

    const raised = await withTenant(builderOnlyId, (db) =>
      db.fulfillmentOrder.count({ where: { draftOrderId: draft.id } }),
    );
    assert.equal(raised, 0, 'no fulfilment record for a tenant that holds no ERP');
  });
});

describe('conversion promotes the lead in place', () => {
  test('the abandoned row BECOMES the order — exactly one survives', async () => {
    const token = draftToken();
    const number = phone();
    const customerName = `Recovered ${uid()}`;

    await draftCapture(erpSlug, shop, token, {
      customerName, phone: number, wilaya: 'Annaba', baladia: 'El Bouni',
    });
    const draft = await draftByToken(erp.tenantId, token);
    assert.ok(draft);

    const before = await leadFor(draft.id);
    assert.ok(before, 'the lead exists before the customer comes back');
    assert.equal(before.salesOrderId, null);

    // The customer returns and completes the purchase. The token is what the
    // storefront still holds in sessionStorage.
    const placed = await checkout(erpSlug, shop, customerName, { draftToken: token, phone: number });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const salesOrderId = placed.body.data.id;

    assert.equal(
      await leadCount(draft.id), 1,
      'two rows would mean two ORD numbers and two notifications for one customer',
    );

    const after = await leadFor(draft.id);
    assert.ok(after);
    assert.equal(after.id, before.id, 'it is the SAME row — the call history rides along');
    assert.equal(after.reference, before.reference, 'the number already quoted is kept');
    assert.equal(after.agentUserId, before.agentUserId, 'the agent working it keeps it');
    assert.equal(after.salesOrderId, salesOrderId, 'and it now carries the sale');
    assert.equal(after.orderType, 'normal', 'it leaves the abandoned filter');
    assert.equal(after.status, 'pending', 'a request to buy, awaiting confirmation');
    assert.equal(after.source, 'storefront_recovered', 'recovered, not sold outright');
    assert.ok(Number(after.price) > 0, 'the money arrives with the sale');

    // And the sale is not ALSO holding a second fulfilment row somewhere.
    const bySale = await withTenant(erp.tenantId, (db) =>
      db.fulfillmentOrder.count({ where: { salesOrderId } }),
    );
    assert.equal(bySale, 1, 'one sale, one operational record');
  });

  test('a checkout with no draft token still creates its own row', async () => {
    const placed = await checkout(erpSlug, shop, `Direct ${uid()}`);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));

    const linked = await withTenant(erp.tenantId, (db) =>
      db.fulfillmentOrder.findUnique({
        where: { salesOrderId: placed.body.data.id },
        select: { id: true, source: true, orderType: true, draftOrderId: true },
      }),
    );
    assert.ok(linked, 'the M-05 path is untouched');
    assert.equal(linked.source, 'storefront');
    assert.equal(linked.draftOrderId, null, 'nothing to promote, nothing claimed');
  });
});

/* -----------------------------------------------------------------------------
 * INV.2 — the sale names its variant, in the column the ERP actually reads
 *
 * The selection has always travelled in `lineItems[0].variants`, and nothing
 * joins or matches on it: `applyMovement` finds a variant BY NAME off
 * `FulfillmentOrder.productVariant`, and the storefront never wrote that
 * column. So every storefront sale reached the call-centre naming no variant.
 *
 * That is what made INV.1's silent corruption reachable on the MAIN path
 * rather than in a corner, and it is why retyping the variants in the Manager
 * bought a display and not tracking.
 * -------------------------------------------------------------------------- */

describe('INV.2 — a storefront sale names the variant it bought', () => {
  const erpRowFor = (salesOrderId: string) =>
    withTenant(erp.tenantId, (db) =>
      db.fulfillmentOrder.findUnique({
        where: { salesOrderId },
        select: { id: true, product: true, productVariant: true, lineItems: true },
      }),
    ) as Promise<{
      id: string; product: string | null; productVariant: string | null; lineItems: any;
    } | null>;

  /** A page selling Size(M) × Colour(Blue, Red), defined in that order. */
  const optionPage = () =>
    storefront(erp.tenantId, [
      { name: 'Size', value: 'M' },
      { name: 'Colour', value: 'Blue' },
      { name: 'Colour', value: 'Red' },
    ]);

  test('the chosen options land in productVariant, as the catalogue names them', async () => {
    const shop = await optionPage();
    const res = await checkout(erpSlug, shop, 'Variant Buyer', {
      variantIds: [shop.variantIds['Size:M'], shop.variantIds['Colour:Blue']],
    });
    assert.equal(res.status, 201, `checkout failed: ${JSON.stringify(res.body)}`);

    const row = await erpRowFor(res.body.data.id);
    assert.ok(row, 'no ERP row for the sale');
    assert.equal(
      row!.productVariant,
      'M / Blue',
      'the ERP row does not name the variant, so stock cannot move against it',
    );

    // The display snapshot is untouched: this slice ADDS a column, it does not
    // reshape the line items the order screen already renders.
    const line = (row!.lineItems as any[])[0];
    assert.deepEqual(
      line.variants,
      [{ name: 'Size', value: 'M' }, { name: 'Colour', value: 'Blue' }],
      'the line-item snapshot changed shape',
    );
  });

  test('the name is the values in DEFINITION order, whatever order they were picked in', async () => {
    /* The whole reason this has a canonical function rather than a join at the
       call site. The matrix generator names a row by joining values in
       definition order, and its own comment says why: a catalogue growing both
       "M / Blue" and "Blue / M" holds separate stock for one real thing. The
       checkout used to read its variants with NO `orderBy`, so which axis came
       first was whatever Postgres returned. */
    const shop = await optionPage();
    // Colour clicked FIRST, deliberately.
    const res = await checkout(erpSlug, shop, 'Reverse Picker', {
      variantIds: [shop.variantIds['Colour:Blue'], shop.variantIds['Size:M']],
    });
    assert.equal(res.status, 201);

    const row = await erpRowFor(res.body.data.id);
    assert.equal(
      row!.productVariant,
      'M / Blue',
      'the click order leaked into the catalogue name — that is two names for one variant',
    );
  });

  test('a page with no options names no variant, which is what the column means', async () => {
    const shop = await storefront(erp.tenantId);
    const res = await checkout(erpSlug, shop, 'Plain Buyer');
    assert.equal(res.status, 201);

    const row = await erpRowFor(res.body.data.id);
    assert.equal(row!.productVariant, '', 'a variantless product must name no variant');
  });

  test('THE POINT: stock moves against the variant that was actually sold', async () => {
    /* End to end, and the reason INV.1 and INV.2 are two halves of one fix.
       Before INV.2 this order named no variant, `applyMovement` took the
       product branch, and before INV.1 that branch wrote a ledger row and
       moved nothing. Now the sale names "M / Blue", the catalogue has a row by
       that name, and confirming takes the stock off THAT row. */
    const shop = await optionPage();

    const product = (await erp.manager.api('POST', '/api/erp/products', {
      name: shop.page.title, sku: `SKU${uid()}`, price: 4900, costPrice: 1000,
      variants: [{ name: 'M / Blue', stock: 0 }, { name: 'M / Red', stock: 0 }],
    })).body.data;
    for (const name of ['M / Blue', 'M / Red']) {
      await erp.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
        variantName: name, qty: 10, unitCost: 1000,
      });
    }

    const res = await checkout(erpSlug, shop, 'Stock Mover', {
      variantIds: [shop.variantIds['Size:M'], shop.variantIds['Colour:Blue']],
      quantity: 3,
    });
    assert.equal(res.status, 201);
    const row = await erpRowFor(res.body.data.id);
    assert.equal(row!.productVariant, 'M / Blue');

    const confirmed = await erp.manager.api('PATCH', `/api/erp/orders/${row!.id}`, {
      status: 'confirmed',
    });
    assert.equal(confirmed.status, 200, `confirm failed: ${JSON.stringify(confirmed.body)}`);

    const inv = (await erp.manager.api(
      'GET', `/api/erp/products/${product.id}/inventory`,
    )).body.data;
    const blue = inv.variants.find((v: any) => v.name === 'M / Blue');
    const red = inv.variants.find((v: any) => v.name === 'M / Red');
    assert.equal(blue.stock, 7, 'the sold variant did not lose its three units');
    assert.equal(red.stock, 10, 'a variant nobody bought moved — the wrong row was decremented');

    const moves = (await erp.manager.api(
      'GET', `/api/erp/products/${product.id}/inventory/history?variant=all`,
    )).body.data.items as any[];
    const confirm = moves.find((m) => m.orderId === row!.id && m.reason === 'confirm');
    assert.ok(confirm, 'no ledger row explains where the stock went');
    assert.equal(confirm.variantName, 'M / Blue', 'the ledger names the wrong variant');
    assert.equal(confirm.delta, -3);
  });

  test('an abandoned cart names its variant too, and keeps it when it converts', async () => {
    /* LB.57's path. A lead the agent phones has to say WHICH one, and a cart
       promoted in place must not lose the choice on the way — `commercial` is
       one object feeding both branches precisely so it cannot. */
    const shop = await optionPage();
    const token = draftToken();
    const number = phone();

    await draftCapture(erpSlug, shop, token, {
      customerName: 'Cart Leaver',
      phone: number,
      variants: [{ name: 'Size', value: 'M' }, { name: 'Colour', value: 'Red' }],
    });

    const lead = await withTenant(erp.tenantId, (db) =>
      db.fulfillmentOrder.findFirst({
        where: { phoneNormalized: { contains: number.slice(-8) } },
        select: { id: true, productVariant: true, orderType: true, salesOrderId: true },
      }),
    ) as { id: string; productVariant: string | null; orderType: string; salesOrderId: string | null } | null;
    assert.ok(lead, 'no lead was raised for the abandoned cart');
    assert.equal(lead!.orderType, 'abandoned');
    assert.equal(lead!.productVariant, 'M / Red', 'the lead does not say which variant was in the cart');

    // The same visitor comes back and buys.
    const res = await checkout(erpSlug, shop, 'Cart Leaver', {
      draftToken: token,
      phone: number,
      variantIds: [shop.variantIds['Size:M'], shop.variantIds['Colour:Red']],
    });
    assert.equal(res.status, 201);

    const promoted = await erpRowFor(res.body.data.id);
    assert.equal(promoted!.id, lead!.id, 'the cart was not promoted in place (LB.57)');
    assert.equal(
      promoted!.productVariant,
      'M / Red',
      'the promotion lost the variant — the bug back again for recovered customers',
    );
  });
});

/* -----------------------------------------------------------------------------
 * VAR.2 — the page's options reach the Manager as a real matrix
 *
 * The reported bug: variants do not transfer when a page is sent to the
 * Manager, so the merchant recreates them on the ERP side by hand. Traced to
 * three gaps, all closed here and in INV.2: the send's SELECT never asked for
 * `variants`, `catalogProductFromLanding` had no field to write them to, and
 * storefront orders named no variant anyway — so even a hand-built matrix
 * never moved any stock.
 * -------------------------------------------------------------------------- */

describe('VAR.2 — sending a page carries its options across', () => {
  const send = (landingPageId: string) =>
    erp.manager.api('POST', '/api/builder/publish-to-erp', { scope: 'one', landingPageId });

  const productFor = (landingPageId: string) =>
    withTenant(erp.tenantId, async (db) => {
      const link = await db.catalogProductLink.findFirst({
        where: { platform: 'landingos', externalProductId: landingPageId },
        select: { productId: true },
      });
      if (!link) return null;
      return db.catalogProduct.findUnique({
        where: { id: link.productId },
        select: { id: true, variants: true, optionDefs: true, stock: true },
      });
    }) as Promise<{ id: string; variants: any; optionDefs: any; stock: number | null } | null>;

  const shopWithOptions = () =>
    storefront(erp.tenantId, [
      { name: 'Size', value: 'S' },
      { name: 'Size', value: 'M' },
      { name: 'Colour', value: 'Blue' },
      { name: 'Colour', value: 'Red' },
    ]);

  test('the matrix is generated, every combination at zero', async () => {
    const shop = await shopWithOptions();
    const r = await send(shop.page.id);
    assert.equal(r.status, 200, `send failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.data.created, 1);
    assert.equal(r.body.data.variantsAdded, 4, 'two axes of two is four combinations');

    const product = await productFor(shop.page.id);
    assert.ok(product, 'no catalogue product was linked');
    const names = (product!.variants as any[]).map((v) => v.name);
    // Definition order, so the name a checkout produces matches (INV.2).
    assert.deepEqual(names, ['S / Blue', 'S / Red', 'M / Blue', 'M / Red']);
    for (const v of product!.variants as any[]) {
      assert.equal(v.stock, 0, `${v.name} arrived with invented stock`);
    }
    // The vocabulary travels too, so the ERP matrix editor can regenerate.
    assert.deepEqual((product!.optionDefs as any[]).map((d) => d.name), ['Size', 'Colour']);
  });

  test('a re-send KEEPS the levels the warehouse entered', async () => {
    /* The property that matters most here. A merchant edits the page's
       description, presses send again, and their stock must still be there —
       D-LP.18.2's loss, one door over. */
    const shop = await shopWithOptions();
    await send(shop.page.id);
    const product = (await productFor(shop.page.id))!;

    await erp.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
      variantName: 'M / Blue', setTo: 25, unitCost: 400,
    });

    const again = await send(shop.page.id);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.updated, 1);

    const after = (await productFor(shop.page.id))!;
    const blue = (after.variants as any[]).find((v) => v.name === 'M / Blue');
    assert.equal(blue.stock, 25, 'a re-publish zeroed a level the warehouse had entered');
  });

  test('a combination the page drops is kept when it still holds stock', async () => {
    const shop = await storefront(erp.tenantId, [
      { name: 'Size', value: 'S' },
      { name: 'Size', value: 'M' },
    ]);
    await send(shop.page.id);
    const product = (await productFor(shop.page.id))!;
    await erp.manager.api('POST', `/api/erp/products/${product.id}/stock-lots`, {
      variantName: 'S', setTo: 9, unitCost: 100,
    });

    // The merchant removes the S option from the page entirely.
    await withTenant(erp.tenantId, (db) =>
      (db as any).landingVariant.deleteMany({
        where: { landingPageId: shop.page.id, value: 'S' },
      }),
    );

    const again = await send(shop.page.id);
    assert.equal(again.status, 200);
    assert.deepEqual(
      again.body.data.variantsKeptHoldingStock,
      ['S'],
      'the merchant was not told a variant survived because it holds stock',
    );

    const after = (await productFor(shop.page.id))!;
    const survivor = (after.variants as any[]).find((v) => v.name === 'S');
    assert.ok(survivor, 'nine units were deleted by a re-publish');
    assert.equal(survivor.stock, 9);
  });

  test('a page selling no options leaves an existing matrix alone', async () => {
    // A merchant who never used variants in the builder must not have a
    // hand-built ERP matrix quietly emptied by a re-publish.
    const shop = await storefront(erp.tenantId);
    await send(shop.page.id);
    const product = (await productFor(shop.page.id))!;

    await erp.manager.api('PUT', `/api/erp/products/${product.id}/variants`, {
      variants: [{ name: 'Hand typed', stock: 0 }],
      reason: 'set up by hand',
    });

    await send(shop.page.id);
    const after = (await productFor(shop.page.id))!;
    assert.deepEqual(
      (after.variants as any[]).map((v) => v.name),
      ['Hand typed'],
      'a variant-less page wiped the matrix a manager built by hand',
    );
  });
});

describe('VAR.2 — the optional inventory enforcement', () => {
  const enforcementOn = (landingPageId: string, on: boolean) =>
    withTenant(erp.tenantId, (db) =>
      (db as any).landingSetting.upsert({
        where: { landingPageId },
        create: { tenantId: erp.tenantId, landingPageId, inventoryEnforcement: on },
        update: { inventoryEnforcement: on },
      }),
    );

  /** A sent page whose "M" option is deliberately empty and "S" is stocked. */
  const soldOutShop = async () => {
    const shop = await storefront(erp.tenantId, [
      { name: 'Size', value: 'S' },
      { name: 'Size', value: 'M' },
    ]);
    await erp.manager.api('POST', '/api/builder/publish-to-erp', {
      scope: 'one', landingPageId: shop.page.id,
    });
    const link = await withTenant(erp.tenantId, (db) =>
      db.catalogProductLink.findFirst({
        where: { platform: 'landingos', externalProductId: shop.page.id },
        select: { productId: true },
      }),
    );
    await erp.manager.api('POST', `/api/erp/products/${link!.productId}/stock-lots`, {
      variantName: 'S', setTo: 5, unitCost: 100,
    });
    return shop;
  };

  test('OFF (the default) sells an out-of-stock combination, exactly as today', async () => {
    /* The merchant's own reason for wanting the toggle: a new product is
       tested before its stock is entered, and a strict rule blocks that test. */
    const shop = await soldOutShop();
    const r = await checkout(erpSlug, shop, 'Tester', {
      variantIds: [shop.variantIds['Size:M']],
    });
    assert.equal(r.status, 201, 'the default must not refuse anything');
  });

  test('ON refuses the empty combination, and still sells the stocked one', async () => {
    const shop = await soldOutShop();
    await enforcementOn(shop.page.id, true);

    const refused = await checkout(erpSlug, shop, 'Unlucky', {
      variantIds: [shop.variantIds['Size:M']],
    });
    assert.equal(refused.status, 409, `expected a refusal: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.error.code, 'OUT_OF_STOCK');

    const sold = await checkout(erpSlug, shop, 'Lucky', {
      variantIds: [shop.variantIds['Size:S']],
    });
    assert.equal(sold.status, 201, 'the stocked combination must still sell');
  });

  test('ON with no linked product sells freely, so turning it on early is harmless', async () => {
    // Never sent to the Manager: there are no levels, so there is nothing to
    // enforce. The alternative is a toggle that silently closes a shop.
    const shop = await storefront(erp.tenantId, [{ name: 'Size', value: 'M' }]);
    await enforcementOn(shop.page.id, true);
    const r = await checkout(erpSlug, shop, 'Early Adopter', {
      variantIds: [shop.variantIds['Size:M']],
    });
    assert.equal(r.status, 201);
  });
});

/* -----------------------------------------------------------------------------
 * VAR.1 (fuller scope) — a change made in the MANAGER reaches the shop
 *
 * The decision this pins: the Manager is the ongoing source of truth for
 * variants, not just the recipient of a one-time transfer. So editing the
 * matrix after the send must change what a customer sees, with no re-publish,
 * no sync job and no waiting.
 *
 * Asserted against the REAL public page, not a mapper unit — the whole point
 * is that it reaches a customer, and LB.23b's lesson is that a route test
 * cannot see whether anything reached the surface.
 * -------------------------------------------------------------------------- */

describe('VAR.1b — the Manager is the ongoing source of truth', () => {
  const send = (landingPageId: string) =>
    erp.manager.api('POST', '/api/builder/publish-to-erp', { scope: 'one', landingPageId });

  const productIdFor = async (landingPageId: string) => {
    const link = await withTenant(erp.tenantId, (db) =>
      db.catalogProductLink.findFirst({
        where: { platform: 'landingos', externalProductId: landingPageId },
        select: { productId: true },
      }),
    );
    return link!.productId as string;
  };

  /** The live public page, as a customer gets it. */
  const publicPage = async (slug: string) => {
    const res = await fetch(`${BASE}/${erpSlug}/${slug}`, { redirect: 'manual' });
    return { status: res.status, body: await res.text() };
  };

  const pageSlug = (landingPageId: string) =>
    withTenant(erp.tenantId, (db) =>
      (db as any).landingPage.findUnique({ where: { id: landingPageId }, select: { slug: true } }),
    ) as Promise<{ slug: string }>;

  const publish = (landingPageId: string) =>
    withTenant(erp.tenantId, (db) =>
      (db as any).landingPage.update({
        where: { id: landingPageId },
        data: { published: true, status: 'PUBLISHED' },
      }),
    );

  test('a variant ADDED in the Manager appears on the storefront, with no re-publish', async () => {
    const shop = await storefront(erp.tenantId, [
      { name: 'Size', value: 'S' },
      { name: 'Size', value: 'M' },
    ]);
    await publish(shop.page.id);
    await send(shop.page.id);
    const productId = await productIdFor(shop.page.id);
    const { slug } = await pageSlug(shop.page.id);

    const before = await publicPage(slug);
    assert.equal(before.status, 200);
    assert.ok(!before.body.includes('>XL<'), 'precondition: XL is not on the page yet');

    // The manager adds a size in the ERP. Nothing touches the builder.
    await erp.manager.api('PUT', `/api/erp/products/${productId}/variants`, {
      variants: [
        { name: 'S', options: { Size: 'S' } },
        { name: 'M', options: { Size: 'M' } },
        { name: 'XL', options: { Size: 'XL' } },
      ],
      optionDefs: [{ name: 'Size', values: ['S', 'M', 'XL'] }],
      reason: 'new size',
    });

    const after = await publicPage(slug);
    assert.equal(after.status, 200);
    assert.match(after.body, />XL</, 'the size added in the Manager never reached the shop');
  });

  test('a variant REMOVED in the Manager disappears from the storefront', async () => {
    const shop = await storefront(erp.tenantId, [
      { name: 'Size', value: 'S' },
      { name: 'Size', value: 'M' },
    ]);
    await publish(shop.page.id);
    await send(shop.page.id);
    const productId = await productIdFor(shop.page.id);
    const { slug } = await pageSlug(shop.page.id);

    assert.match((await publicPage(slug)).body, />M</, 'precondition: M is on sale');

    // The company stops making M. Removing it is allowed because it holds none.
    const removed = await erp.manager.api('PUT', `/api/erp/products/${productId}/variants`, {
      variants: [{ name: 'S', options: { Size: 'S' } }],
      optionDefs: [{ name: 'Size', values: ['S'] }],
      reason: 'discontinued',
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));

    const after = await publicPage(slug);
    assert.ok(!after.body.includes('>M<'), 'a discontinued variant is still offered to customers');
    assert.match(after.body, />S</, 'the surviving variant must still be offered');
  });

  test('and the checkout refuses the removed one, even with enforcement OFF', async () => {
    /* The guarantee, not the courtesy. Deleting a variant is an editorial act
       — the company stopped making it — so no toggle should let a stale tab
       still sell it. Distinct from an EMPTY variant, which VAR.2's toggle
       governs precisely so a new product can be tested before stock exists. */
    const shop = await storefront(erp.tenantId, [
      { name: 'Size', value: 'S' },
      { name: 'Size', value: 'M' },
    ]);
    await publish(shop.page.id);
    await send(shop.page.id);
    const productId = await productIdFor(shop.page.id);

    await erp.manager.api('PUT', `/api/erp/products/${productId}/variants`, {
      variants: [{ name: 'S', options: { Size: 'S' } }],
      optionDefs: [{ name: 'Size', values: ['S'] }],
      reason: 'discontinued',
    });

    // Enforcement is OFF (the default) and stock is zero everywhere — so this
    // refusal can only be the deleted-combination rule.
    const refused = await checkout(erpSlug, shop, 'Stale Tab', {
      variantIds: [shop.variantIds['Size:M']],
    });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'OUT_OF_STOCK');

    const still = await checkout(erpSlug, shop, 'Fine', {
      variantIds: [shop.variantIds['Size:S']],
    });
    assert.equal(still.status, 201, 'the surviving variant must still sell');
  });

  test('a page never sent to the Manager is untouched by any of this', async () => {
    // No link, no matrix, no propagation — which is every page today, and what
    // makes adopting the Manager later a safe act rather than a change of
    // behaviour nobody asked for.
    const shop = await storefront(erp.tenantId, [
      { name: 'Size', value: 'S' },
      { name: 'Size', value: 'M' },
    ]);
    await publish(shop.page.id);
    const { slug } = await pageSlug(shop.page.id);

    const html = (await publicPage(slug)).body;
    assert.match(html, />S</);
    assert.match(html, />M</);

    const r = await checkout(erpSlug, shop, 'Unlinked', {
      variantIds: [shop.variantIds['Size:M']],
    });
    assert.equal(r.status, 201);
  });
});
