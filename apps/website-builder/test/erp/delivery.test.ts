import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  skip, uid, phone, waitFor, makeErpTenant, cleanup, BASE, slugOf,
  backdateShipmentPoll, setCarrierAdapter, linkProduct, setOrderExternalProduct,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/delivery.test.ts
 *
 * Ported from apps/erp/test/delivery-outcome.test.js (audit BUG-02) and the
 * providers/shipments sections of apps/erp/test/regression.test.js.
 *
 * BUG-02 was that orders.deliveryOutcome and deliveryOutcomeAt were READ in
 * eight places and WRITTEN in none. Nothing errored. The profit calculator,
 * delivered-pay payroll, client lifetime spend and product revenue were all
 * permanently zero, and every screen rendered perfectly while showing a company
 * that had apparently never sold anything.
 *
 * That is the shape of defect this whole suite exists to catch, and it is why
 * the tests below follow the chain end to end — carrier event, to settlement,
 * to the four things that read it — rather than asserting the column is
 * writable and stopping there.
 *
 * The mock carrier walks a parcel one step per poll along
 *   created → dispatched → in_transit → at_office → out_for_delivery → delivered
 * which lets a test drive a real parcel to a real terminal state through the
 * real ingest path.
 *
 * NOT ported: the SSE half of the original file (BUG-04, malformed broadcast
 * frames). The platform has no notification transport yet — see M-16 and
 * PORTING.md.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let carrierCode = '';

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('delivery');

  carrierCode = `mk${uid()}`;
  const created = await acme.manager.api('POST', '/api/erp/carriers', {
    name: 'Mock Carrier', code: carrierCode, adapter: 'mock', apiEnabled: true,
  });
  assert.equal(created.status, 201, `carrier creation failed: ${JSON.stringify(created.body)}`);
  await acme.manager.api('POST', `/api/erp/carriers/${created.body.data.id}/default`, {});
  await acme.manager.api('PUT', '/api/erp/settings', {
    autoCreateShipment: true, reservationMode: 'on_confirm',
  });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

const read = async (id: string) =>
  (await acme.manager.api('GET', `/api/erp/orders/${id}`)).body.data;

/** Create an order, confirm it, and poll its shipment until it is delivered. */
async function deliverAnOrder({ price = 5000, product = '', quantity = 1 } = {}) {
  const created = await acme.manager.api('POST', '/api/erp/orders', {
    client: `Buyer ${uid()}`, phone: phone(),
    price, product, quantity, carrierCode,
  });
  const id = created.body.data.id as string;

  await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
  await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });

  const ship = await acme.manager.api('GET', `/api/erp/orders/${id}/shipment`);
  assert.ok(ship.body.data.shipment, 'confirming the order auto-created a shipment');

  // Each refresh advances the mock parcel one step; six steps reach delivered.
  for (let i = 0; i < 8; i++) {
    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});
    if ((r.body.data.events ?? []).some((e: { crmStatus: string }) => e.crmStatus === 'delivered')) break;
  }
  return id;
}

/* -----------------------------------------------------------------------------
 * Carriers
 * -------------------------------------------------------------------------- */

describe('carrier credentials are never disclosed', () => {
  let carrierId = '';

  test('creating one masks its secrets on read', async () => {
    const r = await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Test Carrier', code: `p${uid()}`, adapter: 'mock',
      apiKey: 'super-secret-key-value', secretKey: 'another-secret',
    });
    assert.equal(r.status, 201);
    carrierId = r.body.data.id;

    assert.ok(!String(r.body.data.apiKey).includes('super-secret'), 'apiKey must be masked');
    assert.ok(!String(r.body.data.secretKey).includes('another-secret'), 'secretKey must be masked');
    assert.equal(r.body.data._hasCredentials, true, 'but the caller is told there ARE credentials');
  });

  test('re-saving with the masked value does not destroy the stored secret', async () => {
    // The failure this catches is quiet and expensive: the console reads the
    // masked value, the user edits the name, the console saves the whole
    // object back, and the real API key is replaced with four bullet
    // characters. Nothing errors until the next shipment fails to book.
    const listed = await acme.manager.api('GET', '/api/erp/carriers');
    const carrier = listed.body.data.items.find((c: { id: string }) => c.id === carrierId);

    await acme.manager.api('PUT', `/api/erp/carriers/${carrierId}`, {
      ...carrier, name: 'Renamed Carrier',
    });

    const after = await acme.manager.api('GET', '/api/erp/carriers');
    const updated = after.body.data.items.find((c: { id: string }) => c.id === carrierId);
    assert.equal(updated.name, 'Renamed Carrier');
    assert.equal(updated._hasCredentials, true, 'the real secret must still be there');
  });

  test('no secret appears anywhere in the list response', async () => {
    const raw = JSON.stringify((await acme.manager.api('GET', '/api/erp/carriers')).body);
    assert.ok(!raw.includes('super-secret-key-value'));
    assert.ok(!raw.includes('another-secret'));
  });

  test('status mappings round-trip and preserve the carrier’s own wording', async () => {
    // The ORIGINAL carrier status is always kept alongside the mapped one, here
    // and on every ShipmentEvent, so a mapping added later can be applied to
    // history instead of history having been flattened on the way in.
    await acme.manager.api('POST', `/api/erp/carriers/${carrierId}/status-mappings`, {
      originalStatus: 'Livré au client', crmStatus: 'delivered',
    });
    const r = await acme.manager.api('GET', `/api/erp/carriers/${carrierId}/status-mappings`);
    const mapping = r.body.data.items.find(
      (m: { originalStatus: string }) => m.originalStatus === 'Livré au client',
    );
    assert.ok(mapping);
    assert.equal(mapping.crmStatus, 'delivered');
  });

  test('two tenants may use the same carrier code', async () => {
    // Rescoped in M-04. Every tenant configures their own carriers and will all
    // reuse the same well-known codes — "zr", "yalidine", "ecom".
    const beta = await makeErpTenant('carrier-beta');
    const code = `zr-${uid()}`;
    assert.equal((await acme.manager.api('POST', '/api/erp/carriers', { name: 'ZR', code })).status, 201);
    assert.equal((await beta.manager.api('POST', '/api/erp/carriers', { name: 'ZR', code })).status, 201);
  });

  test('the same code twice inside one tenant is still refused', async () => {
    const code = `dup-${uid()}`;
    assert.equal((await acme.manager.api('POST', '/api/erp/carriers', { name: 'A', code })).status, 201);
    assert.equal((await acme.manager.api('POST', '/api/erp/carriers', { name: 'B', code })).status, 409);
  });

  test('an agent cannot configure carriers', async () => {
    assert.equal(
      (await acme.agent.api('POST', '/api/erp/carriers', { name: 'x', code: `c${uid()}` })).status,
      403,
    );
  });
});

/* -----------------------------------------------------------------------------
 * An adapter this deployment does not have (LP.2)
 *
 * `getAdapter` used to fall back to `mock` for any unregistered key. The legacy
 * ERP offers twelve adapter keys and implements four; this port carries one. So
 * a carrier configured as `zr` booked a parcel that never existed — a `MOCK…`
 * tracking number, a 201, and an order nobody looks at again because it booked
 * successfully. A wrong answer that looks right is worse than an error.
 * -------------------------------------------------------------------------- */

describe('a carrier cannot name an integration this deployment does not have', () => {
  test('creating one is refused, and the refusal says what IS available', async () => {
    // `yalidine` rather than `zr`: LP.5 registered ZR Express for real, so it is
    // no longer an example of an integration this deployment lacks. The legacy
    // dropdown offers twelve keys and this deployment implements two, so the
    // boundary this test guards has moved by exactly one adapter — it has not
    // been relaxed.
    const r = await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Yalidine', code: `yl${uid()}`, adapter: 'yalidine',
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'UNKNOWN_ADAPTER');
    // A dead-end refusal is barely better than the silent fallback: twelve keys
    // exist in the legacy dropdown and two work here, so the message has to
    // name them or there is nothing to try next.
    assert.match(String(r.body.error.message), /mock/, 'the message must name the keys that work');
    assert.match(String(r.body.error.message), /zr/, 'including the one LP.5 added');
  });

  test('omitting the adapter still defaults to the one that works', async () => {
    const r = await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Unspecified', code: `un${uid()}`,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.adapter, 'mock');
  });

  test('editing a working carrier into a broken one is refused too', async () => {
    const created = await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Editable', code: `ed${uid()}`, adapter: 'mock',
    });
    const r = await acme.manager.api('PUT', `/api/erp/carriers/${created.body.data.id}`, {
      adapter: 'yalidine',
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'UNKNOWN_ADAPTER');
  });

  test('a row that already holds one cannot book a parcel', async () => {
    // The second half of the guard. A row can hold an unregistered key from
    // before the check existed, or because a deployment dropped an adapter it
    // used to have — so booking refuses as well as configuration.
    const code = `st${uid()}`;
    const carrier = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Stale', code, adapter: 'mock',
    })).body.data;
    await setCarrierAdapter(acme.tenantId, carrier.id, 'yalidine');

    const order = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'No Parcel', phone: phone(), price: 1000, carrierCode: code,
    })).body.data;

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'UNKNOWN_ADAPTER');

    // And no fabricated tracking number reached the order.
    const back = await acme.manager.api('GET', `/api/erp/orders/${order.id}`);
    assert.ok(!back.body.data.trackingNumber, 'no tracking number may be invented');
    assert.ok(!back.body.data.shipmentId);
  });

  test('a parcel whose carrier lost its adapter is not walked along the mock pipeline', async () => {
    // Polling through a fallback would advance a REAL parcel through the mock's
    // synthetic six steps and settle its outcome — booking revenue for a
    // delivery that may never have happened.
    const code = `pl${uid()}`;
    const carrier = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Loses adapter', code, adapter: 'mock',
    })).body.data;

    const order = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Booked then broken', phone: phone(), price: 1000, carrierCode: code,
    })).body.data;
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    const before = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
    await setCarrierAdapter(acme.tenantId, carrier.id, 'noest');

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment/refresh`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'UNKNOWN_ADAPTER');

    const after = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
    assert.equal(after.events.length, before.events.length, 'no event may be invented');
    assert.equal(after.shipment.crmStatus, before.shipment.crmStatus, 'and the parcel did not move');
  });

  test('but a webhook the carrier PUSHED is still ingested', async () => {
    // The deliberate exception. Interpreting a status string cannot invent a
    // parcel, and the carrier sent this — dropping it would lose a real
    // delivery outcome to a configuration problem. `mapCarrierStatus` keeps its
    // keyword fallback for exactly this path.
    const code = `wh${uid()}`;
    const carrier = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Pushes anyway', code, adapter: 'mock',
    })).body.data;

    const order = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Pushed', phone: phone(), price: 1000, carrierCode: code,
    })).body.data;
    await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    const tracking = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`))
      .body.data.shipment.trackingNumber;

    await setCarrierAdapter(acme.tenantId, carrier.id, 'ems');

    const slug = await slugOf(acme.tenantId);
    const res = await fetch(`${BASE}/api/erp/webhooks/${slug}/delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackingNumber: tracking, status: 'Livré au client' }),
    });
    assert.equal(res.status, 200);

    const settled = await waitFor(async () => {
      const o = (await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).body.data;
      return o.deliveryOutcome === 'delivered' ? o : null;
    });
    assert.ok(settled, 'the keyword fallback must still resolve a pushed event');
  });
});

/* -----------------------------------------------------------------------------
 * Shipments
 * -------------------------------------------------------------------------- */

describe('shipments', () => {
  test('a confirmed order gets a shipment with a tracking number', async () => {
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Ship Me', phone: phone(), price: 3000, carrierCode,
    });
    const id = created.body.data.id;

    const r = await acme.manager.api('POST', `/api/erp/orders/${id}/shipment`, {});
    assert.equal(r.status, 201);
    assert.equal(r.body.data.shipment.crmStatus, 'created', 'a new shipment starts at created');
    assert.ok(r.body.data.shipment.trackingNumber, 'the carrier returned a tracking number');

    const back = await acme.manager.api('GET', `/api/erp/orders/${id}/shipment`);
    assert.equal(back.body.data.shipment.id, r.body.data.shipment.id);
    assert.equal(back.body.data.events.length, 1, 'creation is recorded as the first event');
  });

  test('shipment events are append-only', async () => {
    const id = await deliverAnOrder();
    const r = await acme.manager.api('GET', `/api/erp/orders/${id}/shipment`);
    const eventId = r.body.data.events[0].id;

    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const attempt = await acme.manager.api(
        method, `/api/erp/shipment-events/${eventId}`, { crmStatus: 'returned' },
      );
      assert.ok(attempt.status === 404 || attempt.status === 405,
        `${method} returned ${attempt.status} — shipment history must not be rewritable`);
    }
  });

  test('a carrier re-sending the same event does not duplicate it', async () => {
    // The unique on (tenant, shipment, eventTime, originalStatus) is what makes
    // intake idempotent. Carriers replay backlogs; without it a replayed day
    // doubles every event in the timeline.
    const id = await deliverAnOrder();
    const before = (await acme.manager.api('GET', `/api/erp/orders/${id}/shipment`)).body.data.events.length;

    await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});

    const after = (await acme.manager.api('GET', `/api/erp/orders/${id}/shipment`)).body.data.events.length;
    assert.equal(after, before, 'a terminal parcel polled again adds nothing');
  });

  test('another tenant’s shipment is not readable', async () => {
    const beta = await makeErpTenant('shipment-beta');
    const id = await deliverAnOrder();
    assert.equal((await beta.manager.api('GET', `/api/erp/orders/${id}/shipment`)).status, 404);
  });
});

/* -----------------------------------------------------------------------------
 * BUG-02 — settlement
 * -------------------------------------------------------------------------- */

describe('deliveryOutcome is settled from carrier events (BUG-02)', () => {
  test('a delivered parcel sets deliveryOutcome and deliveryOutcomeAt', async () => {
    const id = await deliverAnOrder();
    const settled = await waitFor(async () => {
      const o = await read(id);
      return o?.deliveryOutcome ? o : null;
    }, { label: 'deliveryOutcome to be set' });

    assert.equal(settled.deliveryOutcome, 'delivered');
    assert.ok(settled.deliveryOutcomeAt, 'the settlement moment is recorded');
  });

  test('the settlement moment comes from the carrier event, not the clock', async () => {
    // A migration or an ingest that stamps "now" loses the only trustworthy
    // fact in the record: when the parcel actually arrived.
    const id = await deliverAnOrder();
    const order = await waitFor(async () => {
      const o = await read(id);
      return o?.deliveryOutcomeAt ? o : null;
    }, { label: 'settlement' });

    const shipment = (await acme.manager.api('GET', `/api/erp/orders/${id}/shipment`)).body.data;
    const delivered = shipment.events
      .filter((e: { crmStatus: string }) => e.crmStatus === 'delivered')
      .map((e: { eventTime: string }) => new Date(e.eventTime).getTime())
      .sort((a: number, b: number) => a - b)[0];

    assert.equal(new Date(order.deliveryOutcomeAt).getTime(), delivered,
      'the timestamp matches the carrier event exactly');
  });

  test('the outcome is settled once and never overwritten', async () => {
    const id = await deliverAnOrder();
    const first = await waitFor(async () => {
      const o = await read(id);
      return o?.deliveryOutcome ? o : null;
    }, { label: 'first settlement' });

    // More polls keep arriving; the settled value and moment must not move.
    await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});

    const again = await read(id);
    assert.equal(again.deliveryOutcome, first.deliveryOutcome);
    assert.equal(again.deliveryOutcomeAt, first.deliveryOutcomeAt, 'settled once, permanently');
  });

  test('an in-flight parcel has no outcome yet', async () => {
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'InFlight', phone: phone(), price: 1000, carrierCode,
    });
    const id = created.body.data.id;
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });
    await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});  // → dispatched only

    const o = await read(id);
    assert.ok(!o.deliveryOutcome, 'a parcel still moving is not settled');
    assert.equal(o.deliveryOutcomeAt, null);
  });

  test('confirming by phone alone never settles an outcome', async () => {
    // Under cash on delivery a phone confirmation is not a sale. Treating it as
    // one is how a company books revenue for parcels that are later refused at
    // the door — which is a large fraction of them.
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'PhoneOnly', phone: phone(), price: 2000,
    });
    const id = created.body.data.id;
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });

    assert.ok(!(await read(id)).deliveryOutcome);
  });
});

/* -----------------------------------------------------------------------------
 * The reporting chain that depended on it
 * -------------------------------------------------------------------------- */

describe('the four things that read deliveryOutcome', () => {
  test('client lifetime delivered count and spend move', async () => {
    const number = phone();
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Lifetime', phone: number, price: 7500, carrierCode,
    });
    const id = created.body.data.id;
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });
    for (let i = 0; i < 8; i++) {
      const r = await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});
      if ((r.body.data.events ?? []).some((e: { crmStatus: string }) => e.crmStatus === 'delivered')) break;
    }

    const client = await waitFor(async () => {
      const r = await acme.manager.api('GET', `/api/erp/clients?search=${number}`);
      const c = r.body.data.items[0];
      return c && c.deliveredOrders > 0 ? c : null;
    }, { label: 'client delivered stats' });

    assert.equal(client.deliveredOrders, 1);
    assert.equal(String(client.totalSpent), '7500', 'lifetime spend counts the delivered order');
  });

  test('product sales-summary reports real delivered units and revenue', async () => {
    const name = `Reported Widget ${uid()}`;
    const product = (await acme.manager.api('POST', '/api/erp/products', {
      name, price: 9000, costPrice: 3000, packagingCost: 200,
      variants: [{ name: 'Solo', stock: 50 }],
    })).body.data;

    await deliverAnOrder({ price: 9000, product: name, quantity: 1 });

    const summary = await waitFor(async () => {
      const r = await acme.manager.api(
        'GET', `/api/erp/products/${product.id}/sales-summary?since=0&until=${Date.now() + 60000}`,
      );
      return r.body.data.deliveredCount > 0 ? r.body.data : null;
    }, { label: 'sales summary to report a delivery' });

    assert.equal(summary.deliveredCount, 1);
    assert.equal(String(summary.realCA), '9000', 'real revenue is no longer zero');
    assert.ok(Number(summary.avgBuyPrice) > 0, 'the cost basis resolves for the profit calculation');
    assert.equal(String(summary.totalCostOfGoods), '3200', 'cost + packaging for one unit');

    // LP.16a. The two used to be ONE number — `avgBuyPrice` was
    // (unit + packaging) / units — and the profit calculator multiplies BOTH
    // by units, so filling one field from it and leaving the other counted
    // packaging twice. Wrong in the safe-looking direction, which is the kind
    // of error nobody investigates.
    assert.equal(String(summary.avgBuyPrice), '3000', 'the buy price alone');
    assert.equal(String(summary.avgPackagingCost), '200', 'packaging, separately');
    assert.equal(
      Number(summary.avgBuyPrice) + Number(summary.avgPackagingCost),
      Number(summary.totalCostOfGoods) / summary.deliveredUnits,
      'and the two still add up to what was actually spent per unit',
    );
    assert.equal(
      summary.costTrackedUnits + summary.costFallbackUnits,
      summary.deliveredUnits,
      'every delivered unit is accounted for as tracked or fallen back on',
    );
    assert.equal(summary.productName, name, 'the answer names what it is about');
  });

  /* ---------------------------------------------------------------------------
   * LP.16a — which orders belong to a product
   *
   * The defect this group exists for: `where: { product: product.name }` was
   * EXACT STRING EQUALITY, so a catalogue product named `Montre™` matched no
   * orders at all and reported zero revenue on a screen that already ships.
   * Every number was a real number and the product had apparently never sold
   * anything — BUG-02's shape exactly.
   * ------------------------------------------------------------------------ */
  describe('a product is matched by normalised name, then by the channel’s link', () => {
    test('a ™, a non-breaking space and a capital letter no longer hide the revenue', async () => {
      const base = `Montre Or ${uid()}`;
      // What the catalogue holds. What the ORDERS hold is the same product
      // written the way a storefront and an operator each write it.
      const product = (await acme.manager.api('POST', '/api/erp/products', {
        name: `${base}™`, price: 5000, costPrice: 1000, packagingCost: 100,
        variants: [{ name: 'Solo', stock: 50 }],
      })).body.data;

      // Lower-cased, and with a NON-BREAKING space where the catalogue has a
      // normal one — the invisible one, pasted out of a supplier's price list.
      await deliverAnOrder({ price: 5000, product: base.toLowerCase().replace(' ', ' '), quantity: 1 });

      const summary = await waitFor(async () => {
        const r = await acme.manager.api(
          'GET', `/api/erp/products/${product.id}/sales-summary?since=0&until=${Date.now() + 60000}`,
        );
        return r.body.data.deliveredCount > 0 ? r.body.data : null;
      }, { label: 'the normalised match to find the order' });

      assert.equal(summary.deliveredCount, 1, 'the ™ used to make this zero');
      assert.equal(String(summary.realCA), '5000');
    });

    test('a returned parcel is counted as returned and not as a sale', async () => {
      const name = `Returned Widget ${uid()}`;
      const product = (await acme.manager.api('POST', '/api/erp/products', {
        name, price: 3000, costPrice: 900, packagingCost: 100,
        variants: [{ name: 'Solo', stock: 50 }],
      })).body.data;

      const order = (await acme.manager.api('POST', '/api/erp/orders', {
        client: 'Refuser', phone: phone(), price: 3000, product: name, quantity: 1, carrierCode,
      })).body.data;
      await acme.manager.api('POST', `/api/erp/orders/${order.id}/call-start`, {});
      await acme.manager.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });

      const tracking = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`))
        .body.data.shipment.trackingNumber;
      await fetch(`${BASE}/api/erp/webhooks/${await slugOf(acme.tenantId)}/delivery`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking, status: 'Retour au vendeur' }),
      });

      const summary = await waitFor(async () => {
        const r = await acme.manager.api(
          'GET', `/api/erp/products/${product.id}/sales-summary?since=0&until=${Date.now() + 60000}`,
        );
        return r.body.data.returnedCount > 0 ? r.body.data : null;
      }, { label: 'the return to be counted' });

      // `returnedCount` was not answered AT ALL before LP.16a, so the one figure
      // that turns revenue into a return rate had to be typed from memory.
      assert.equal(summary.returnedCount, 1);
      assert.equal(summary.deliveredCount, 0, 'and a refused parcel is not a sale');
      assert.equal(String(summary.realCA), '0');
    });

    test('an order linked to ANOTHER product is refused, even when the names match', async () => {
      // The rule that makes the link exclusive. Two catalogue rows with the
      // same name, one linked to the listing the order came from: the link
      // decides, including by saying no. Without it, a shop that renamed a
      // listing has its sales quietly reattributed by a name collision.
      const shared = `Twin Widget ${uid()}`;
      const mineProduct = (await acme.manager.api('POST', '/api/erp/products', {
        name: shared, price: 4000, costPrice: 1000, variants: [{ name: 'Solo', stock: 20 }],
      })).body.data;
      const theirsProduct = (await acme.manager.api('POST', '/api/erp/products', {
        name: shared, price: 4000, costPrice: 1000, variants: [{ name: 'Solo', stock: 20 }],
      })).body.data;

      const externalProductId = `ext-${uid()}`;
      await linkProduct(acme.tenantId, theirsProduct.id, { externalProductId });

      const orderId = await deliverAnOrder({ price: 4000, product: shared, quantity: 1 });
      await setOrderExternalProduct(acme.tenantId, orderId, { externalProductId });

      const forMine = (await acme.manager.api(
        'GET', `/api/erp/products/${mineProduct.id}/sales-summary?since=0&until=${Date.now() + 60000}`,
      )).body.data;
      const forTheirs = (await acme.manager.api(
        'GET', `/api/erp/products/${theirsProduct.id}/sales-summary?since=0&until=${Date.now() + 60000}`,
      )).body.data;

      assert.equal(forMine.deliveredCount, 0, 'the name matched and the link said no');
      assert.equal(forTheirs.deliveredCount, 1, 'the linked product owns the sale');
      assert.equal(String(forTheirs.realCA), '4000');
    });
  });

  test('agent delivered-pay payroll earns', async () => {
    await acme.manager.api('PATCH', `/api/erp/agents/${acme.agent.userId}`, {
      baseSalaryMonthly: 0, payPerConfirmedOrder: 0, payPerDeliveredOrder: 250,
    });

    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'PayMe', phone: phone(), price: 4000,
      agentUserId: acme.agent.userId, carrierCode,
    });
    const id = created.body.data.id;
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });
    for (let i = 0; i < 8; i++) {
      const r = await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});
      if ((r.body.data.events ?? []).some((e: { crmStatus: string }) => e.crmStatus === 'delivered')) break;
    }
    await waitFor(async () => (await read(id)).deliveryOutcome === 'delivered', { label: 'settlement' });

    const r = await acme.manager.api(
      'GET', `/api/erp/agents/${acme.agent.userId}/payroll?since=0&until=${Date.now() + 60000}`,
    );
    assert.equal(r.body.data.deliveredOrders, 1);
    assert.equal(String(r.body.data.deliveredPay), '250', 'payPerDeliveredOrder finally pays out');
  });

  test('the profit calculator sees the revenue', async () => {
    const r = await acme.manager.api(
      'GET', `/api/erp/financial-records/prorate-fixed?periodType=month`,
    );
    assert.equal(r.status, 200);

    const stats = await acme.manager.api(
      'GET', `/api/erp/orders/stats?deliveryOutcome=delivered`,
    );
    assert.ok(stats.body.data.total > 0, 'delivered orders are countable, which they were not before');
  });
});

/* -----------------------------------------------------------------------------
 * Phase 6.5a — a carrier event raises a follow-up task
 *
 * The half of the follow-up module that was never ported. `onDeliveryStatus` in
 * apps/erp/lib/followup.js raises a `call_customer` task when a carrier reports
 * a state that needs a person — customer out, bad address, a reschedule — and
 * without it the platform could list, count and resolve tasks that nothing
 * created.
 *
 * This belongs in THIS file rather than a new one because the subject is already
 * "a carrier said something, what changed downstream" — the same chain BUG-02 is
 * about. A task appearing is one more thing that changes.
 * -------------------------------------------------------------------------- */

describe('a carrier reporting trouble raises a follow-up task', () => {
  /** A parcel on a carrier with no webhook secret, so the push is accepted. */
  const bookedParcel = async (agentUserId?: string) => {
    const code = `fu${uid()}`;
    await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Followup Carrier', code, adapter: 'mock',
    });
    const orderId = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Followup Customer', phone: phone(), carrierCode: code,
    })).body.data.id as string;

    // The follow-up agent is set by REASSIGNMENT, not at creation: `POST
    // /orders` accepts `agentUserId` and not `followupUserId`, and `buildPatch`
    // is where both are manager-only. Assigning through the route a manager
    // really uses is also what proves the producer reads the stored value.
    if (agentUserId) {
      const assigned = await acme.manager.api('PATCH', `/api/erp/orders/${orderId}`, {
        followupUserId: agentUserId,
      });
      assert.equal(assigned.status, 200);
    }

    const booked = await acme.manager.api('POST', `/api/erp/orders/${orderId}/shipment`, {});
    assert.ok([200, 201].includes(booked.status), `booking answered ${booked.status}`);
    return { orderId, tracking: booked.body.data.shipment.trackingNumber as string };
  };

  const push = async (tracking: string, status: string, description = '') =>
    fetch(`${BASE}/api/erp/webhooks/${await slugOf(acme.tenantId)}/delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackingNumber: tracking, status, description }),
    });

  const tasksFor = async (orderId: string) => {
    const r = await acme.manager.api('GET', '/api/erp/followup/tasks');
    return (r.body.data.items as any[]).filter((t) => t.orderId === orderId);
  };

  test('a CRM status in the call-required set raises one', async () => {
    const { orderId, tracking } = await bookedParcel();
    assert.deepEqual(await tasksFor(orderId), [], 'a task existed before anything happened');

    // "returned" is one of the two CRM statuses that always require a call.
    await push(tracking, 'Retour au vendeur');

    await waitFor(async () => (await tasksFor(orderId)).length || null, { label: 'a follow-up task' });
    const tasks = await tasksFor(orderId);

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'call_customer');
    assert.equal(tasks[0].status, 'open');
    assert.ok(tasks[0].dueAt, 'no countdown was set');
  });

  test('the carrier’s own wording is matched too, not just the mapped status', async () => {
    // The keyword fallback is why this is a two-part rule: carriers write
    // "Client absent" and "Adresse erronée" in their own words, and those map to
    // nothing in particular — but they are exactly the states needing a call.
    const { orderId, tracking } = await bookedParcel();
    await push(tracking, 'Client absent lors de la livraison');

    await waitFor(async () => (await tasksFor(orderId)).length || null, {
      label: 'a follow-up task from the keyword rule',
    });
    const tasks = await tasksFor(orderId);
    assert.equal(tasks.length, 1);
    assert.match(String(tasks[0].reason ?? ''), /absent/i, 'the reason keeps what the carrier said');
  });

  test('an ordinary status raises nothing', async () => {
    // The whole point is that a task means somebody must ring the customer. A
    // parcel simply moving through the network is not that.
    const { orderId, tracking } = await bookedParcel();
    await push(tracking, 'En cours de transport');
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(await tasksFor(orderId), [], 'a routine movement raised a task');
  });

  test('the same problem reported twice does not raise a second task', async () => {
    // Carriers replay. A duplicate task would mean two agents ringing the same
    // customer about the same thing, and an escalation that never clears.
    const { orderId, tracking } = await bookedParcel();
    await push(tracking, 'Client absent');
    await waitFor(async () => (await tasksFor(orderId)).length || null, { label: 'the first task' });

    await push(tracking, 'Client absent');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await tasksFor(orderId)).length, 1, 'the replay raised a duplicate');
  });

  test('it is assigned to the order’s follow-up agent when there is one', async () => {
    const { orderId, tracking } = await bookedParcel(acme.agent.userId);
    await push(tracking, 'Adresse erronée');

    await waitFor(async () => (await tasksFor(orderId)).length || null, { label: 'an assigned task' });
    const tasks = await tasksFor(orderId);
    assert.equal(tasks[0].agentUserId, acme.agent.userId);

    // And the agent it belongs to can then close it — the loop the module is for.
    const resolved = await acme.agent.api(
      'POST', `/api/erp/followup/tasks/${tasks[0].id}/resolve`, {},
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.data.status, 'done');
  });

  test('a task raised in one tenant is invisible to another', async () => {
    const { orderId, tracking } = await bookedParcel();
    await push(tracking, 'Client injoignable');
    await waitFor(async () => (await tasksFor(orderId)).length || null, { label: 'the task' });

    const beta = await makeErpTenant('followup-producer-beta');
    const betaTasks = await beta.manager.api('GET', '/api/erp/followup/tasks');
    assert.equal(
      (betaTasks.body.data.items as any[]).filter((t) => t.orderId === orderId).length,
      0,
      "a neighbouring tenant could see this tenant's follow-up work",
    );
  });
});

/* -----------------------------------------------------------------------------
 * The tracking poll — Phase 6.6b
 * -------------------------------------------------------------------------- */

describe('the scheduled tracking poll', () => {
  const run = () => acme.manager.api('POST', '/api/erp/jobs/tracking-poll', {});

  /** A confirmed order with a booked parcel, never polled. */
  const parcel = async () => {
    const orderId = (await acme.manager.api('POST', '/api/erp/orders', {
      client: `Polled ${uid()}`, phone: phone(), price: 4000, carrierCode,
    })).body.data.id as string;
    const booked = await acme.manager.api('POST', `/api/erp/orders/${orderId}/shipment`, {});
    assert.ok([200, 201].includes(booked.status), `booking answered ${booked.status}`);
    return orderId;
  };

  const eventsFor = async (orderId: string) =>
    ((await acme.manager.api('GET', `/api/erp/orders/${orderId}/shipment`)).body.data.events ??
      []) as Array<{ crmStatus: string }>;

  test('it asks the carrier without anybody pressing anything', async () => {
    // This is the whole feature. Until now a parcel moved only on an inbound
    // webhook or when a person opened the order and pressed "ask the carrier" —
    // so a carrier that does not send webhooks (most of them, in this market)
    // left every parcel frozen at "created" until somebody noticed.
    const orderId = await parcel();
    const before = await eventsFor(orderId);
    assert.equal((await read(orderId)).deliveryStatus, 'created', 'precondition: freshly booked');

    const r = await run();
    assert.equal(r.status, 200);
    // At least one, not exactly one: the job is tenant-wide and this tenant is
    // carrying the parcels every test above it booked. What makes this test
    // about THIS parcel is the two assertions below.
    assert.ok(r.body.data.polled >= 1, 'nothing was polled at all');

    const after = await eventsFor(orderId);
    assert.ok(after.length > before.length, 'the poll stored nothing for this parcel');
    assert.notEqual(
      (await read(orderId)).deliveryStatus, 'created',
      'the parcel is still where it was booked',
    );
  });

  test('a second pass inside the interval polls nothing', async () => {
    // The idempotency property every job in this file has, and here it is also
    // rate limiting: a real carrier's API is somebody else's server, and a
    // worker ticking every minute must not turn `trackingPollMinutes` into a
    // suggestion.
    await parcel();
    const first = await run();
    assert.ok(first.body.data.polled >= 1, 'nothing was polled on the first pass');

    const second = await run();
    assert.equal(second.body.data.polled, 0, 'the same parcels were polled twice');
  });

  test('trackingPollMinutes is what decides when it is due', async () => {
    const orderId = await parcel();
    await run();

    // Long interval, poll marker moved back by less than it: not due.
    await acme.manager.api('PUT', '/api/erp/settings', { trackingPollMinutes: 600 });
    await backdateShipmentPoll(acme.tenantId, orderId, 30);
    assert.equal((await run()).body.data.polled, 0, 'polled inside its own interval');

    // Same marker, short interval: due.
    await acme.manager.api('PUT', '/api/erp/settings', { trackingPollMinutes: 5 });
    assert.ok((await run()).body.data.polled >= 1, 'never became due');
  });

  test('a settled parcel is left alone', async () => {
    // A parcel that has arrived is not going to move again, and polling it
    // forever is a request per parcel per interval for the life of the company.
    const orderId = await deliverAnOrder();
    const settledAt = (await read(orderId)).deliveryOutcomeAt;
    assert.ok(settledAt, 'precondition: the parcel settled');

    const eventsBefore = (await eventsFor(orderId)).length;
    await backdateShipmentPoll(acme.tenantId, orderId, null);
    await acme.manager.api('PUT', '/api/erp/settings', { trackingPollMinutes: 1 });
    await run();

    assert.equal((await eventsFor(orderId)).length, eventsBefore, 'a delivered parcel was polled');
    assert.equal(
      (await read(orderId)).deliveryOutcomeAt, settledAt,
      'polling moved a settled outcome',
    );
  });

  test('it goes through the same ingest path a webhook does', async () => {
    // Not a separate write path. `ingestEvents` is the one choke point where
    // events are stored, the outcome is settled and follow-up tasks are raised —
    // a poll that wrote events directly would be a parcel that updates without
    // ever ringing anybody about a problem.
    const orderId = await parcel();
    await acme.manager.api('PUT', '/api/erp/settings', { trackingPollMinutes: 1 });

    for (let i = 0; i < 10; i += 1) {
      await backdateShipmentPoll(acme.tenantId, orderId, 10);
      await run();
      if ((await read(orderId)).deliveryOutcome) break;
    }

    const order = await read(orderId);
    assert.equal(order.deliveryOutcome, 'delivered', 'the poll never settled the parcel');
    assert.ok(order.deliveryOutcomeAt, 'settled with no timestamp');
  });

  test('one tenant’s poll never touches another’s parcels', async () => {
    const beta = await makeErpTenant('poll-beta');
    const betaCode = `pb${uid()}`;
    const betaCarrier = await beta.manager.api('POST', '/api/erp/carriers', {
      name: 'Beta Carrier', code: betaCode, adapter: 'mock',
    });
    assert.equal(betaCarrier.status, 201);
    const betaOrder = (await beta.manager.api('POST', '/api/erp/orders', {
      client: 'Beta Parcel', phone: phone(), carrierCode: betaCode,
    })).body.data.id as string;
    await beta.manager.api('POST', `/api/erp/orders/${betaOrder}/shipment`, {});

    const before = (await beta.manager.api('GET', `/api/erp/orders/${betaOrder}/shipment`))
      .body.data.events.length;

    await acme.manager.api('PUT', '/api/erp/settings', { trackingPollMinutes: 1 });
    await run();

    const after = (await beta.manager.api('GET', `/api/erp/orders/${betaOrder}/shipment`))
      .body.data.events.length;
    assert.equal(after, before, "acme's poll advanced beta's parcel");
  });

  test('an agent cannot run it', async () => {
    // Same gate as every other job: it spends money at a carrier's API and
    // moves other people's orders.
    assert.equal((await acme.agent.api('POST', '/api/erp/jobs/tracking-poll', {})).status, 403);
  });
});

/* -----------------------------------------------------------------------------
 * The real ZR Express adapter — LP.5
 *
 * Driven against a STUB ZR EXPRESS running in this test process. That is the
 * point, not a shortcut: `Carrier.apiUrl` is a per-carrier column the manager
 * configures, so pointing it at 127.0.0.1 exercises the real adapter over real
 * HTTP — the territory search, the auth headers ZR expects, the exact parcel
 * body, its error shapes, and the Svix envelope on the way back. A mocked
 * adapter would assert that this file's own fixtures agree with themselves.
 *
 * The stub also records every request, which is what lets these tests assert the
 * thing that actually matters about an outbound integration: not that a 201 came
 * back, but that the RIGHT PARCEL was ordered.
 * -------------------------------------------------------------------------- */

describe('ZR Express', () => {
  /** ZR's own territory ids — unrelated to the standard 1–58 wilaya numbers. */
  const TERRITORIES = [
    { id: 'w-alger-0001', name: 'Alger', level: 'wilaya' },
    { id: 'w-oran-0002', name: 'Oran', level: 'wilaya' },
    { id: 'c-babez-0011', name: 'Bab Ezzouar', level: 'commune', parentId: 'w-alger-0001' },
    { id: 'c-bir-0012', name: 'Bir Mourad Rais', level: 'commune', parentId: 'w-alger-0001' },
    // The same commune NAME under a different wilaya, so a test can prove the
    // commune lookup is scoped by parent rather than matched globally.
    { id: 'c-babez-0021', name: 'Bab Ezzouar', level: 'commune', parentId: 'w-oran-0002' },
  ];

  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  interface Recorded {
    readonly path: string;
    readonly headers: Record<string, string | string[] | undefined>;
    readonly body: Record<string, any> | null;
  }

  let server: import('node:http').Server;
  let apiUrl = '';
  let seen: Recorded[] = [];

  /** What the stub does next. Each test sets only what it cares about. */
  const behaviour = {
    parcelStatus: 200,
    parcelBody: { id: 'zr-parcel-1' } as unknown,
    parcelDelayMs: 0,
    searchStatus: 200,
  };

  const reset = () => {
    seen = [];
    behaviour.parcelStatus = 200;
    behaviour.parcelBody = { id: `zr-parcel-${uid()}` };
    behaviour.parcelDelayMs = 0;
    behaviour.searchStatus = 200;
  };

  const WEBHOOK_SECRET = 'whsec_' + Buffer.from('zr-lp5-signing-key-0123456789').toString('base64');
  const API_KEY = 'zr-api-key-value';
  const TENANT_UUID = '11111111-2222-3333-4444-555555555555';

  let carrierCode = '';
  let carrierId = '';
  let zrSlug = '';

  before(async () => {
    if (skip) return;

    const http = await import('node:http');
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: Record<string, any> | null = null;
        try { body = text ? JSON.parse(text) : null; } catch { /* keep null */ }
        seen.push({ path: req.url ?? '', headers: req.headers, body });

        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };

        if ((req.url ?? '').includes('/territories/search')) {
          if (behaviour.searchStatus !== 200) {
            return send(behaviour.searchStatus, { detail: 'territory service unavailable' });
          }
          const keyword = normalize(String(body?.advancedSearch?.keyword ?? ''));
          const items = keyword
            ? TERRITORIES.filter(
                (t) => normalize(t.name).includes(keyword) || keyword.includes(normalize(t.name)),
              )
            : TERRITORIES;
          return send(200, { items, totalCount: items.length });
        }

        if ((req.url ?? '').includes('/parcels')) {
          if (behaviour.parcelDelayMs > 0) {
            await new Promise((r) => setTimeout(r, behaviour.parcelDelayMs));
          }
          return send(behaviour.parcelStatus, behaviour.parcelBody);
        }

        return send(404, { detail: 'no such ZR route' });
      });
    });

    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    apiUrl = `http://127.0.0.1:${port}/api/v1`;

    carrierCode = `zr${uid()}`;
    const created = await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'ZR Express', code: carrierCode, adapter: 'zr',
      apiUrl, apiKey: API_KEY, secretKey: TENANT_UUID, webhookSecret: WEBHOOK_SECRET,
    });
    assert.equal(created.status, 201, `ZR carrier creation failed: ${JSON.stringify(created.body)}`);
    carrierId = created.body.data.id;
    zrSlug = await slugOf(acme.tenantId);
  });

  after(async () => {
    if (skip) return;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  /** An unconfirmed order addressed somewhere ZR knows, unless told otherwise. */
  const zrOrder = async (over: Record<string, unknown> = {}) => {
    reset();
    const r = await acme.manager.api('POST', '/api/erp/orders', {
      client: `ZR Buyer ${uid()}`, phone: phone(),
      wilaya: 'Alger', commune: 'Bab Ezzouar',
      product: 'Montre connectee', quantity: 2, price: 7000,
      carrierCode, ...over,
    });
    assert.equal(r.status, 201, `order creation failed: ${JSON.stringify(r.body)}`);
    return r.body.data as { id: string; reference: string };
  };

  const parcelRequest = () => seen.find((s) => s.path.includes('/parcels'));

  test('a carrier may now name the ZR Express integration', async () => {
    // LP.2 refused this key, correctly, because nothing was registered under it.
    // The refusal was never the goal — booking real parcels was.
    const adapters = (await acme.manager.api('GET', '/api/erp/carriers?adapters=true')).body.data.items;
    const entry = adapters.find((a: { key: string }) => a.key === 'zr');
    assert.ok(entry, 'the adapter registry must offer zr');
    assert.equal(entry.canCreateOutbound, true);
    assert.equal(entry.canPoll, false, 'ZR publishes no tracking endpoint');
  });

  test('booking resolves the address against ZR and orders the right parcel', async () => {
    const order = await zrOrder();

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    assert.equal(r.status, 201, `booking failed: ${JSON.stringify(r.body)}`);

    const parcel = parcelRequest();
    assert.ok(parcel, 'ZR must actually have been asked for a parcel');

    // The territory ids are ZR's own, resolved at booking time — the whole
    // reason the adapter searches instead of carrying a 1,585-row map.
    assert.equal(parcel!.body!.deliveryAddress.cityTerritoryId, 'w-alger-0001');
    assert.equal(parcel!.body!.deliveryAddress.districtTerritoryId, 'c-babez-0011');

    // Money: the order's total is what ZR collects, and the unit price is
    // derived from it rather than taken from a column that disagrees the moment
    // a discount is applied.
    assert.equal(parcel!.body!.amount, 7000);
    assert.equal(parcel!.body!.orderedProducts[0].quantity, 2);
    assert.equal(parcel!.body!.orderedProducts[0].unitPrice, 3500);

    // The identifier ZR echoes back, and the only way a parcel booked without a
    // tracking number can be matched to the webhook that finally brings one.
    assert.equal(parcel!.body!.externalId, order.id);

    // ZR wants an international number; this platform stores the local form.
    assert.match(String(parcel!.body!.customer.phone.number1), /^\+213/);
  });

  test('the credentials travel in ZR own headers, from the fields the CRM stores them in', async () => {
    // The tenant UUID lives in "Secret Key" and the ZR secret in "API Key".
    // Swapping them would silently break every carrier row a company already
    // configured against the legacy CRM.
    const order = await zrOrder();
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    const parcel = parcelRequest();
    assert.equal(parcel!.headers['x-tenant'], TENANT_UUID);
    assert.equal(parcel!.headers['x-api-key'], API_KEY);
  });

  test('the parcel is recorded with ZR id and NO tracking number', async () => {
    const order = await zrOrder();
    behaviour.parcelBody = { id: 'zr-parcel-known' };

    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    const { shipment } = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
    assert.equal(shipment.carrierShipmentId, 'zr-parcel-known');
    assert.equal(shipment.carrierReference, order.id);
    assert.ok(!shipment.trackingNumber, 'ZR assigns the tracking number later, on the webhook');
  });

  test('a wilaya ZR does not know refuses the booking and creates nothing', async () => {
    // The failure the legacy adapter existed to make loud. Booking a parcel to
    // an address the carrier could not resolve is the same class of wrong answer
    // LP.2 removed: it looks exactly like a success.
    const order = await zrOrder({ wilaya: 'Atlantis', commune: 'Bab Ezzouar' });

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'ADDRESS_UNRESOLVED');
    assert.match(String(r.body.error.message), /Atlantis/, 'the refusal must name what could not be resolved');

    assert.ok(!parcelRequest(), 'no parcel may be ordered when the address is unresolved');

    const back = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
    assert.equal(back.shipment, null, 'and no shipment row may exist');
  });

  test('a commune ZR does not know INSIDE a known wilaya refuses too', async () => {
    const order = await zrOrder({ wilaya: 'Alger', commune: 'Nowhere-sur-Mer' });

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'ADDRESS_UNRESOLVED');
    assert.match(String(r.body.error.message), /Nowhere-sur-Mer/);
    assert.ok(!parcelRequest(), 'no parcel may be ordered');
  });

  test('a commune belonging to ANOTHER wilaya is not accepted for this one', async () => {
    // "Bir Mourad Rais" belongs to Alger in the fixture, not to Oran. Communes
    // repeat across wilayas in Algeria, and an unscoped match is how a parcel
    // reaches the right name in the wrong place.
    const order = await zrOrder({ wilaya: 'Oran', commune: 'Bir Mourad Rais' });

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'ADDRESS_UNRESOLVED');
  });

  test('an alternate spelling of a wilaya still resolves', async () => {
    // The wilaya on an order is typed by a customer on a storefront or by an
    // agent on the phone. Normalisation plus the alias table is what turns
    // "ALGER CENTRE" into the territory ZR answers to.
    const order = await zrOrder({ wilaya: 'ALGER CENTRE', commune: 'Bab Ezzouar' });
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);
    assert.equal(parcelRequest()!.body!.deliveryAddress.cityTerritoryId, 'w-alger-0001');
  });

  test('ZR refusing the parcel is reported with ZR own reason', async () => {
    const order = await zrOrder();
    behaviour.parcelStatus = 400;
    behaviour.parcelBody = { errors: [{ description: 'Phone number is not valid' }] };

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'CARRIER_REJECTED');
    assert.match(String(r.body.error.message), /Phone number is not valid/);

    const back = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
    assert.equal(back.shipment, null, 'a refused parcel leaves no shipment behind');
  });

  test('a failed booking is TOLD, not only logged', async () => {
    // The legacy CRM pushed `shipment_failed` with the reason, so the order
    // appeared with "the wilaya is misspelled" on it. Without it an unbooked
    // parcel is invisible: the confirmation succeeded and nothing says the
    // carrier was never told.
    const order = await zrOrder({ wilaya: 'Atlantis' });
    await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});

    const told = await waitFor(async () => {
      const feed = (await acme.manager.api('GET', '/api/platform/notifications')).body.data;
      return feed.items.find(
        (n: { type: string; entityId: string | null }) =>
          n.type === 'shipment_failed' && n.entityId === order.id,
      );
    }, { label: 'a shipment_failed notification' });

    assert.match(String(told.body), /Atlantis/, 'the reason travels with it, or it is a support ticket');
  });

  test('the booking survives a carrier slower than the transaction timeout', async () => {
    // D-LP.5.1, and the load-bearing test of this slice. `withTenant` opens an
    // interactive transaction whose timeout is 15 seconds. Before LP.5 the
    // carrier call happened inside it, which was harmless only because the one
    // registered adapter was synchronous — with a real carrier, a slow third
    // party would have rolled back the CONFIRMATION that triggered the booking.
    //
    // 17 seconds is chosen to be decisively past that timeout and inside the
    // adapter's own 25s limit on parcel creation.
    const order = await zrOrder();
    behaviour.parcelDelayMs = 17_000;

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {});
    assert.equal(r.status, 201, `a slow carrier must not fail the booking: ${JSON.stringify(r.body)}`);

    const { shipment } = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
    assert.ok(shipment, 'and the shipment must have been recorded');
  });

  test('confirming an order books through ZR without the confirmation riding on it', async () => {
    // The other door, and the one that matters most: a confirmed call is real
    // work an agent did. It is committed before ZR is asked anything, so a
    // carrier that refuses — or is slow — cannot undo it.
    await acme.manager.api('PUT', '/api/erp/settings', { autoCreateShipment: true });
    const order = await zrOrder({ wilaya: 'Atlantis' });

    await acme.manager.api('POST', `/api/erp/orders/${order.id}/call-start`, {});
    const call = await acme.manager.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });
    assert.equal(call.status, 200, 'the call must be logged even though ZR refused the address');
    assert.equal(call.body.data.shipmentBooked, false, 'and it says the parcel was not booked');

    const back = (await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.equal(back.status, 'confirmed', 'the confirmation stands');
    assert.ok(!back.shipmentId, 'and no parcel was invented for an address ZR does not know');
  });

  test('a confirmation ZR accepts comes back with the parcel already booked', async () => {
    await acme.manager.api('PUT', '/api/erp/settings', { autoCreateShipment: true });
    const order = await zrOrder();

    await acme.manager.api('POST', `/api/erp/orders/${order.id}/call-start`, {});
    const call = await acme.manager.api('POST', `/api/erp/orders/${order.id}/call`, { result: 'confirmed' });
    assert.equal(call.status, 200);
    assert.equal(call.body.data.shipmentBooked, true, 'the response waits for the answer');
    assert.ok(parcelRequest(), 'and ZR was asked');
  });

  test('two bookings for one order still produce exactly one parcel', async () => {
    // The race D-LP.5.1 widened, and the constraint that closes it. The carrier
    // call now happens outside the transaction, so two operators pressing the
    // button at the same moment can both reach ZR before either writes — and a
    // `findFirst` before a `create` is a hope, not a guard. Two shipment rows
    // would mean two parcels collected and one customer paying once.
    const order = await zrOrder();
    behaviour.parcelDelayMs = 1200;

    const [a, b] = await Promise.all([
      acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {}),
      acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {}),
    ]);

    assert.ok([200, 201].includes(a.status), `first booking answered ${a.status}: ${JSON.stringify(a.body)}`);
    assert.ok([200, 201].includes(b.status), `second booking answered ${b.status}: ${JSON.stringify(b.body)}`);
    assert.equal(a.body.data.shipment.id, b.body.data.shipment.id, 'both must name the same parcel');

    const events = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data.events;
    assert.equal(events.length, 1, 'and one creation event, not two');
  });

  test('asking ZR where a parcel is says WHY it cannot be asked', async () => {
    // LP.2's distinction applied to the other side of the question: "the carrier
    // has no news" and "this carrier cannot be asked" are different facts, and
    // answering 200 with an unchanged timeline states the first when the second
    // is true. ZR publishes no tracking endpoint at all.
    const order = await zrOrder();
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    const r = await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment/refresh`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'CARRIER_NO_POLLING');
  });

  /* ---------------------------------------------------------------------------
   * The Svix webhook
   * ------------------------------------------------------------------------ */

  const svixSign = (raw: string, id: string, timestamp: string) => {
    const key = Buffer.from(WEBHOOK_SECRET.slice('whsec_'.length), 'base64');
    return 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64');
  };

  const pushZr = async (payload: unknown, opts: { sign?: boolean; corrupt?: boolean } = {}) => {
    const raw = JSON.stringify(payload);
    const id = `msg_${uid()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.sign !== false) {
      headers['svix-id'] = id;
      headers['svix-timestamp'] = timestamp;
      headers['svix-signature'] = opts.corrupt
        ? 'v1,' + Buffer.from('not the right mac at all').toString('base64')
        : svixSign(raw, id, timestamp);
    }
    return fetch(`${BASE}/api/erp/webhooks/${zrSlug}/delivery`, { method: 'POST', headers, body: raw });
  };

  const zrEvent = (data: Record<string, unknown>) => ({
    eventType: 'parcel.updated',
    occurredAt: new Date().toISOString(),
    data: { situation: { slug: 'delivered', name: 'Delivered' }, state: { name: 'Delivered' }, ...data },
  });

  test('a signed webhook finds the parcel by the reference we gave it, and attaches the tracking number', async () => {
    // The property without which ZR cannot work at all: a parcel booked with no
    // tracking number could never receive the event that gives it one.
    const order = await zrOrder();
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    const res = await pushZr(zrEvent({
      externalId: order.id,
      trackingNumber: 'ZR-TRK-0001',
      situation: { slug: 'in_transit', name: 'In transit' },
      state: { name: 'In transit' },
    }));
    assert.equal(res.status, 200);

    const attached = await waitFor(async () => {
      const { shipment } = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
      return shipment?.trackingNumber === 'ZR-TRK-0001' ? shipment : null;
    }, { label: 'the tracking number ZR issued' });

    assert.equal(attached.crmStatus, 'in_transit', 'and ZR own vocabulary is mapped');

    const back = (await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.equal(back.trackingNumber, 'ZR-TRK-0001', 'the order carries it too');
  });

  test('a delivered event settles the outcome from ZR own moment', async () => {
    const order = await zrOrder();
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    const when = new Date(Date.now() - 3 * 3600_000);
    const res = await pushZr({
      eventType: 'parcel.updated',
      occurredAt: when.toISOString(),
      data: {
        externalId: order.id, trackingNumber: `ZR-TRK-${uid()}`,
        situation: { slug: 'delivered', name: 'Delivered' }, state: { name: 'Delivered' },
      },
    });
    assert.equal(res.status, 200);

    const settled = await waitFor(async () => {
      const o = (await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).body.data;
      return o.deliveryOutcome === 'delivered' ? o : null;
    }, { label: 'a settled delivery' });

    // Not the clock. A backlog replayed a week late must not book every one of
    // those deliveries into this week's revenue.
    const drift = Math.abs(new Date(settled.deliveryOutcomeAt).getTime() - when.getTime());
    assert.ok(drift < 5000, `deliveryOutcomeAt must come from the carrier event (off by ${drift}ms)`);
  });

  test('an UNSIGNED webhook changes nothing, and so does a forged one', async () => {
    // SEC-04. The legacy Svix check returned "accept" when the headers were
    // absent, when no secret was set, and from its own catch — so omitting the
    // signature was enough. A configured secret here means a signature is
    // REQUIRED and must verify.
    const order = await zrOrder();
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    const unsigned = await pushZr(
      zrEvent({ externalId: order.id, trackingNumber: 'ZR-TRK-BAD' }),
      { sign: false },
    );
    assert.equal(unsigned.status, 200, 'a carrier is never given a retryable error');

    const forged = await pushZr(
      zrEvent({ externalId: order.id, trackingNumber: 'ZR-TRK-BAD' }),
      { corrupt: true },
    );
    assert.equal(forged.status, 200);

    // A moment, in case either had been accepted.
    await new Promise((r) => setTimeout(r, 1500));

    const back = (await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.ok(!back.deliveryOutcome, 'an unsigned delivery must never settle revenue');
    const { shipment } = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
    assert.ok(!shipment.trackingNumber, 'and must not write a tracking number');
  });

  test('a tenant own status mapping still wins over ZR reading', async () => {
    await acme.manager.api('POST', `/api/erp/carriers/${carrierId}/status-mappings`, {
      originalStatus: 'Chez le livreur', crmStatus: 'out_for_delivery',
    });

    const order = await zrOrder();
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    await pushZr(zrEvent({
      externalId: order.id, trackingNumber: `ZR-TRK-${uid()}`,
      situation: { slug: 'unknown-to-us', name: 'Chez le livreur' },
      state: { name: 'Chez le livreur' },
    }));

    const moved = await waitFor(async () => {
      const { shipment } = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
      return shipment?.crmStatus === 'out_for_delivery' ? shipment : null;
    }, { label: 'the tenant own mapping applied' });
    assert.ok(moved);
  });

  test('the scheduled poll counts a ZR parcel as skipped, not polled', async () => {
    // Reporting a healthy sweep over parcels nobody actually asked about is the
    // same class of lie as a fabricated tracking number.
    //
    // In its OWN tenant, deliberately: the poll takes a batch of 25 inside one
    // 15-second transaction, and running it against a tenant that has
    // accumulated three dozen parcels from every other test in this file makes
    // the assertion depend on how much unrelated work the batch happened to
    // pick up. Here the batch is exactly one parcel and the number means what
    // it says.
    const solo = await makeErpTenant('zr-poll');
    const code = `zp${uid()}`;
    assert.equal((await solo.manager.api('POST', '/api/erp/carriers', {
      name: 'ZR Express', code, adapter: 'zr',
      apiUrl, apiKey: API_KEY, secretKey: TENANT_UUID,
    })).status, 201);

    reset();
    const order = (await solo.manager.api('POST', '/api/erp/orders', {
      client: 'Solo ZR', phone: phone(), wilaya: 'Alger', commune: 'Bab Ezzouar',
      price: 5000, carrierCode: code,
    })).body.data;
    assert.equal((await solo.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);

    await solo.manager.api('PUT', '/api/erp/settings', { trackingPollMinutes: 1 });
    const r = await solo.manager.api('POST', '/api/erp/jobs/tracking-poll', {});
    assert.equal(r.status, 200);
    assert.deepEqual(
      { polled: r.body.data.polled, skipped: r.body.data.skipped, failed: r.body.data.failed },
      { polled: 0, skipped: 1, failed: 0 },
      'the one ZR parcel must be reported as skipped, not polled',
    );
  });
});

/* -----------------------------------------------------------------------------
 * The keyword fallback — a defect found while measuring LP.5
 * -------------------------------------------------------------------------- */

describe('an unmapped carrier status is read the way the ERP read it', () => {
  test('"Sorti en livraison" is OUT FOR DELIVERY, not delivered', async () => {
    // Found while porting ZR. `guessStatus` tested `/livr|deliver/` FIRST, and
    // "Sorti en livraison" contains "livr" — so an unmapped carrier reporting a
    // parcel that had just left the depot settled the order as DELIVERED:
    // deliveryOutcome written, client lifetime spend moved, product revenue
    // moved, delivered pay earned, none of it reversible because settlement is
    // permanent by design. Reachable from the one path that deliberately keeps
    // this fallback — a webhook PUSHED for a carrier with no registered adapter
    // (D-LP.2). BUG-02 arriving from the other direction.
    const code = `gs${uid()}`;
    const carrier = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Says it plainly', code, adapter: 'mock',
    })).body.data;

    const order = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Not delivered yet', phone: phone(), price: 4200, carrierCode: code,
    })).body.data;
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);
    const tracking = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`))
      .body.data.shipment.trackingNumber;

    // The carrier loses its adapter, so the keyword fallback is what reads this.
    await setCarrierAdapter(acme.tenantId, carrier.id, 'yalidine');

    const tenantSlug = await slugOf(acme.tenantId);
    const res = await fetch(`${BASE}/api/erp/webhooks/${tenantSlug}/delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackingNumber: tracking, status: 'Sorti en livraison' }),
    });
    assert.equal(res.status, 200);

    const moved = await waitFor(async () => {
      const { shipment } = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
      return shipment?.crmStatus === 'out_for_delivery' ? shipment : null;
    }, { label: 'out_for_delivery, not delivered' });
    assert.ok(moved);

    const back = (await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).body.data;
    assert.ok(!back.deliveryOutcome, 'a parcel that left the depot has not been delivered');
  });

  test('a refusal the carrier spells out is a refusal, not "pending"', async () => {
    // The port dropped the `refus|rejected` branch from the fallback entirely,
    // so every unmapped refusal resolved to "pending" — and a refused parcel is
    // one of the states that must raise a follow-up task.
    const code = `rf${uid()}`;
    const carrier = (await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'Refuses plainly', code, adapter: 'mock',
    })).body.data;

    const order = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Refused parcel', phone: phone(), price: 3300, carrierCode: code,
    })).body.data;
    assert.equal((await acme.manager.api('POST', `/api/erp/orders/${order.id}/shipment`, {})).status, 201);
    const tracking = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`))
      .body.data.shipment.trackingNumber;

    await setCarrierAdapter(acme.tenantId, carrier.id, 'yalidine');

    const tenantSlug = await slugOf(acme.tenantId);
    await fetch(`${BASE}/api/erp/webhooks/${tenantSlug}/delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackingNumber: tracking, status: 'Colis refuse par le client' }),
    });

    const moved = await waitFor(async () => {
      const { shipment } = (await acme.manager.api('GET', `/api/erp/orders/${order.id}/shipment`)).body.data;
      return shipment?.crmStatus === 'refused' ? shipment : null;
    }, { label: 'a refused parcel' });
    assert.ok(moved);
  });
});
