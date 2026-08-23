import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { withTenant } from '@landingos/db';

import {
  skip, uid, phone, makeErpTenant, slugOf,
  storefront, checkout, draftCapture, draftToken, cleanup,
  contractTest as test,
  type Storefront,
} from './helpers.ts';

/* =============================================================================
 * test/erp/checkout-idempotency.test.ts — SEC.11.
 *
 * One intended purchase is one parcel, however many times it is submitted.
 *
 * The readiness audit's Action F. The purchase form's own guard —
 * `if (submitting) return` plus a disabled button — covers the impatient
 * double-tap and nothing else. It does not survive a page reload, and it never
 * sees the case that actually costs money: under load this route measured
 * eleven seconds before failing, and a customer on an Algerian mobile network
 * who gives up, reloads and submits again was, until this slice, two COD
 * parcels and two courier fees that nobody refunds.
 *
 * WHY THESE TESTS LIVE BESIDE THE ERP RATHER THAN IN THE STOREFRONT SUITE.
 * The response shape is storefront business and is pinned there. What is
 * pinned HERE is everything the dedupe could quietly break on the way past:
 * the `TenantSequence` counter that mints ORD- numbers for the call-centre,
 * and LB.57's promotion-in-place. A dedupe that burned a reference, left a gap
 * in the run, or promoted one abandoned cart twice would be a worse bug than
 * the duplicate it replaced — and none of that is visible from a route test.
 * ========================================================================== */

let erp: Awaited<ReturnType<typeof makeErpTenant>>;
let erpSlug = '';
let shop: Storefront;

/** Every ORD- number this tenant holds, ascending. */
const references = () =>
  withTenant(erp.tenantId, async (db) => {
    const rows = await db.fulfillmentOrder.findMany({ select: { reference: true } });
    return rows
      .map((r) => Number(String(r.reference).split('-')[1]))
      .filter((n) => Number.isSafeInteger(n))
      .sort((a, b) => a - b);
  });

/** Where the per-tenant counter currently stands. */
const sequenceValue = () =>
  withTenant(erp.tenantId, async (db) => {
    const row = await db.tenantSequence.findUnique({
      where: { tenantId_name: { tenantId: erp.tenantId, name: 'order' } },
      select: { value: true },
    });
    return row?.value ?? 0;
  });

const salesWithKey = (key: string) =>
  withTenant(erp.tenantId, (db) => (db as any).salesOrder.count({ where: { requestKey: key } }));

const fulfilmentsForSale = (salesOrderId: string) =>
  withTenant(erp.tenantId, (db) => db.fulfillmentOrder.count({ where: { salesOrderId } }));

type DraftRow = { id: string };
const draftByToken = (token: string): Promise<DraftRow | null> =>
  withTenant(erp.tenantId, (db) =>
    (db as any).draftOrder.findUnique({ where: { token }, select: { id: true } }),
  );

const leadFor = (draftOrderId: string) =>
  withTenant(erp.tenantId, (db) =>
    db.fulfillmentOrder.findUnique({
      where: { draftOrderId },
      select: {
        id: true, reference: true, salesOrderId: true, orderType: true,
        source: true, status: true, agentUserId: true,
      },
    }),
  );

const leadCount = (draftOrderId: string) =>
  withTenant(erp.tenantId, (db) => db.fulfillmentOrder.count({ where: { draftOrderId } }));

before(async () => {
  if (skip) return;
  erp = await makeErpTenant('idem');
  erpSlug = await slugOf(erp.tenantId);
  shop = await storefront(erp.tenantId);
});

after(async () => {
  if (skip) return;
  await cleanup();
});

describe('SEC.11 — a resubmitted checkout is a lookup, not a second parcel', () => {
  test('CONCURRENT duplicates produce exactly ONE sale and ONE operational record', async () => {
    const token = draftToken();
    const number = phone();
    const name = `Racer ${uid()}`;

    // Six at once — the shape a reload storm actually has: identical bodies in
    // flight together, none aware of the others. This is the path the fast
    // path CANNOT catch, so it exercises the unique index and the P2002
    // recovery rather than the cheap read.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        checkout(erpSlug, shop, name, { draftToken: token, phone: number }),
      ),
    );

    for (const r of results) {
      assert.ok(
        r.status === 201 || r.status === 200,
        `unexpected ${r.status}: ${JSON.stringify(r.body)}`,
      );
      assert.equal(r.body.success, true, JSON.stringify(r.body));
    }

    // Every response names the SAME order. That is what the customer
    // experiences: whichever attempt they end up looking at is their order.
    const ids = new Set(results.map((r) => r.body.data.id));
    assert.equal(ids.size, 1, `six submissions must name one order, got ${[...ids].join(', ')}`);

    assert.equal(results.filter((r) => r.status === 201).length, 1, 'exactly one creation');
    assert.equal(
      results.filter((r) => r.body.data.duplicate === true).length,
      5,
      'and the other five say so explicitly',
    );

    const orderId = [...ids][0] as string;
    assert.equal(await salesWithKey(token), 1, 'ONE SalesOrder — the whole point');
    assert.equal(await fulfilmentsForSale(orderId), 1, 'ONE FulfillmentOrder — one parcel, one courier');
  });

  test('the losing submissions burn no ORD- number and leave no gap', async () => {
    const before = await references();
    const token = draftToken();
    const number = phone();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        checkout(erpSlug, shop, `Seq ${uid()}`, { draftToken: token, phone: number }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);

    const after = await references();
    assert.equal(after.length, before.length + 1, 'five submissions, one new reference');

    // A rolled-back loser must not have consumed a number. The SalesOrder
    // insert carrying the key runs BEFORE nextReference is called, so the
    // unique violation fires before the counter is ever touched — and the
    // abort rolls back what little it did. Counter and highest reference stay
    // in step, and the run stays contiguous.
    assert.equal(
      await sequenceValue(),
      after[after.length - 1],
      'the counter matches the highest reference in use',
    );
    for (let i = 1; i < after.length; i++) {
      assert.equal(after[i], after[i - 1] + 1, `gap at ORD-${after[i - 1]} to ORD-${after[i]}`);
    }
  });

  test('promotion-in-place still happens exactly once under a duplicate storm', async () => {
    const token = draftToken();
    const number = phone();
    await draftCapture(erpSlug, shop, token, { customerName: 'Promo Racer', phone: number });

    const draft = await draftByToken(token);
    assert.ok(draft, 'the cart was captured');
    const lead = await leadFor(draft.id);
    assert.ok(lead, 'and raised as a callable lead');
    assert.equal(lead.salesOrderId, null, 'not yet a sale');

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        checkout(erpSlug, shop, 'Promo Racer', { draftToken: token, phone: number }),
      ),
    );
    const ids = new Set(results.map((r) => r.body.data.id));
    assert.equal(ids.size, 1, 'one order');
    const orderId = [...ids][0] as string;

    // The abandoned row BECAME the order, once, keeping its own identity —
    // LB.57's whole argument. A dedupe that let two of these through would
    // give the call-centre two ORD- numbers for one customer.
    assert.equal(await leadCount(draft.id), 1, 'still exactly one row for this cart');
    const after = await leadFor(draft.id);
    assert.equal(after!.reference, lead.reference, 'one customer keeps one ORD- number');
    assert.equal(after!.salesOrderId, orderId, 'and it carries the one sale');
    assert.equal(after!.orderType, 'normal', 'it left the abandoned filter');
    assert.equal(after!.source, 'storefront_recovered', 'recovered, not sold outright');
    assert.equal(await fulfilmentsForSale(orderId), 1, 'no second row raced in beside it');
  });

  test('a SEQUENTIAL retry takes the cheap read path and returns the same order', async () => {
    const token = draftToken();
    const number = phone();

    const first = await checkout(erpSlug, shop, 'Retrier', { draftToken: token, phone: number });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.duplicate, undefined, 'the first is a real creation');

    const retry = await checkout(erpSlug, shop, 'Retrier', { draftToken: token, phone: number });
    assert.equal(retry.status, 200, 'a duplicate is not an error');
    assert.equal(retry.body.success, true, 'and not a failure the form would show');
    assert.equal(retry.body.data.id, first.body.data.id, 'same order');
    assert.equal(retry.body.data.total, first.body.data.total, 'same money');
    assert.equal(retry.body.data.duplicate, true);

    assert.equal(await salesWithKey(token), 1);
    assert.equal(await fulfilmentsForSale(first.body.data.id), 1);
  });

  test('different tokens are different purchases and still get their own everything', async () => {
    const number = phone();
    const first = await checkout(erpSlug, shop, 'Repeat Buyer', {
      draftToken: draftToken(), phone: number,
    });
    const second = await checkout(erpSlug, shop, 'Repeat Buyer', {
      draftToken: draftToken(), phone: number,
    });

    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.notEqual(first.body.data.id, second.body.data.id, 'two orders');
    assert.equal(first.body.data.duplicate, undefined);
    assert.equal(second.body.data.duplicate, undefined);

    // Same customer, same phone, deliberately buying twice — two parcels is
    // the CORRECT answer, and it is why the client retires its token after a
    // confirmed sale instead of keeping one per landing page forever.
    assert.equal(await fulfilmentsForSale(first.body.data.id), 1);
    assert.equal(await fulfilmentsForSale(second.body.data.id), 1);
  });

  test('a checkout with no token is not deduplicated, and two of them are two orders', async () => {
    const number = phone();
    const a = await checkout(erpSlug, shop, 'No Token', { phone: number });
    const b = await checkout(erpSlug, shop, 'No Token', { phone: number });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.notEqual(a.body.data.id, b.body.data.id, 'NULLs are distinct in the unique index');

    const rows = (await withTenant(erp.tenantId, (db) =>
      (db as any).salesOrder.findMany({
        where: { id: { in: [a.body.data.id, b.body.data.id] } },
        select: { requestKey: true },
      }),
    )) as Array<{ requestKey: string | null }>;
    assert.deepEqual(
      rows.map((r) => r.requestKey),
      [null, null],
      'no key stored, so nothing to collide on',
    );
  });

  test('MATCHING THE KEY IS NOT ENOUGH: a different phone gets its own order, not somebody else', async () => {
    // The token is Math.random()-derived with a guessable timestamp prefix, and
    // an order id is a bearer handle — the thank-you page renders a customer's
    // name, wilaya and total for anyone holding one. So a guessed token must
    // not be sufficient to be handed one back.
    const token = draftToken();
    const victim = await checkout(erpSlug, shop, 'Real Customer', {
      draftToken: token, phone: phone(),
    });
    assert.equal(victim.status, 201);

    const probe = await checkout(erpSlug, shop, 'Someone Else', {
      draftToken: token, phone: phone(),
    });

    assert.notEqual(
      probe.body?.data?.id,
      victim.body.data.id,
      "a guessed key must never hand back another customer's order",
    );
    // And the sale is not lost to protect a value that was never a secret:
    // the key is dropped and the order goes through unguarded.
    assert.equal(probe.status, 201, JSON.stringify(probe.body));
    assert.equal(await salesWithKey(token), 1, 'the key still belongs to the first order only');
    assert.equal(await fulfilmentsForSale(probe.body.data.id), 1, 'the second sale is real');
  });

  test('the same token in ANOTHER tenant is a different purchase entirely', async () => {
    // The index is per tenant, not global: one company's client-supplied string
    // must never be able to refuse another company's order (D-05.3's reasoning
    // applied to a column an anonymous caller controls).
    const other = await makeErpTenant('idem-other');
    const otherSlug = await slugOf(other.tenantId);
    const otherShop = await storefront(other.tenantId);

    const token = draftToken();
    const number = phone();
    const mine = await checkout(erpSlug, shop, 'Tenant A Buyer', { draftToken: token, phone: number });
    const theirs = await checkout(otherSlug, otherShop, 'Tenant B Buyer', {
      draftToken: token, phone: number,
    });

    assert.equal(mine.status, 201, JSON.stringify(mine.body));
    assert.equal(theirs.status, 201, JSON.stringify(theirs.body));
    assert.notEqual(mine.body.data.id, theirs.body.data.id);
    assert.equal(theirs.body.data.duplicate, undefined, 'not a duplicate of another tenant');
  });
});
