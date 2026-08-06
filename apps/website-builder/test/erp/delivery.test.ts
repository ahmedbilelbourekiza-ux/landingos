import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, uid, phone, waitFor, makeErpTenant, cleanup, BASE, slugOf,
  backdateShipmentPoll, setCarrierAdapter,
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
    const r = await acme.manager.api('POST', '/api/erp/carriers', {
      name: 'ZR Express', code: `zr${uid()}`, adapter: 'zr',
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'UNKNOWN_ADAPTER');
    // A dead-end refusal is barely better than the silent fallback: twelve keys
    // exist in the legacy dropdown and one works here, so the message has to
    // name it or there is nothing to try next.
    assert.match(String(r.body.error.message), /mock/, 'the message must name the keys that work');
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
    await setCarrierAdapter(acme.tenantId, carrier.id, 'zr');

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
