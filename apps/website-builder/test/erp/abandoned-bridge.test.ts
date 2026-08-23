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

