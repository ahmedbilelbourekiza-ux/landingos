/* =============================================================================
 * test/delivery-outcome.test.js — audit BUG-02 and BUG-04.
 *
 * BUG-02: orders.deliveryOutcome / deliveryOutcomeAt were read in eight places
 * and written in none, so the profit calculator, delivered-pay payroll, client
 * lifetime spend and product revenue were all permanently zero.
 *
 * BUG-04: lib/providers/index.js called broadcast(payload, target) with three
 * arguments, event-name first, so delivery and follow-up SSE events were
 * malformed and never rendered.
 *
 * The mock carrier walks a parcel one step per poll along
 * created -> dispatched -> in_transit -> at_office -> out_for_delivery ->
 * delivered, which lets these tests drive a real parcel to a real terminal
 * state through the real ingest path.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, waitFor, uid } = require('./helpers');

let srv;
let providerCode;

before(async () => {
  srv = await startServer();
  providerCode = 'mk' + uid();
  const { body: p } = await srv.api('POST', '/api/providers', {
    name: 'Mock Carrier', code: providerCode, adapter: 'mock', apiEnabled: true,
  });
  await srv.api('POST', `/api/providers/${p.id}/default`);
  await srv.api('PUT', '/api/settings', { autoCreateShipment: true, reservationMode: 'on_confirm' });
});
after(async () => { if (srv) await srv.stop(); });

/** Create an order, confirm it, and poll its shipment until it is delivered. */
async function deliverAnOrder({ price = 5000, product = '', quantity = 1 } = {}) {
  const { body: order } = await srv.api('POST', '/api/orders', {
    client: 'Buyer ' + uid(),
    phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
    price, product, quantity, delivery: providerCode,
  });
  await srv.api('POST', `/api/orders/${order.id}/call-start`);
  await srv.api('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' });

  const { body: ship } = await srv.api('GET', `/api/orders/${order.id}/shipment`);
  assert.ok(ship.shipment, 'confirming the order auto-created a shipment');

  // Each refresh advances the mock parcel one step; six steps reach delivered.
  for (let i = 0; i < 8; i++) {
    const { body } = await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);
    if ((body.events || []).some((e) => e.crmStatus === 'delivered')) break;
  }
  return order;
}

const getOrder = async (id) =>
  (await srv.api('GET', '/api/orders')).body.find((o) => o.id === id);

describe('deliveryOutcome is settled from carrier events (BUG-02)', () => {
  test('a delivered parcel sets deliveryOutcome and deliveryOutcomeAt', async () => {
    const order = await deliverAnOrder();
    const settled = await waitFor(async () => {
      const o = await getOrder(order.id);
      return o && o.deliveryOutcome ? o : null;
    }, { label: 'deliveryOutcome to be set' });

    assert.equal(settled.deliveryOutcome, 'delivered');
    assert.equal(typeof settled.deliveryOutcomeAt, 'number');
    assert.ok(settled.deliveryOutcomeAt > 0, 'the settlement moment is recorded');
  });

  test('the outcome is settled once and never overwritten', async () => {
    const order = await deliverAnOrder();
    const first = await waitFor(async () => {
      const o = await getOrder(order.id);
      return o && o.deliveryOutcome ? o : null;
    }, { label: 'first settlement' });

    // More polls keep arriving; the settled value and moment must not move.
    await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);
    await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);
    const again = await getOrder(order.id);
    assert.equal(again.deliveryOutcome, first.deliveryOutcome);
    assert.equal(again.deliveryOutcomeAt, first.deliveryOutcomeAt, 'settled once, permanently');
  });

  test('an in-flight parcel has no outcome yet', async () => {
    const { body: order } = await srv.api('POST', '/api/orders', {
      client: 'InFlight', phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
      price: 1000, delivery: providerCode,
    });
    await srv.api('POST', `/api/orders/${order.id}/call-start`);
    await srv.api('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' });
    await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);   // -> dispatched only

    const o = await getOrder(order.id);
    assert.equal(o.deliveryOutcome, '', 'a parcel still moving is not settled');
    assert.equal(o.deliveryOutcomeAt, null);
  });

  test('confirming by phone alone never settles an outcome', async () => {
    const { body: order } = await srv.api('POST', '/api/orders', {
      client: 'PhoneOnly', phone: '05' + Math.floor(10000000 + Math.random() * 89999999), price: 2000,
    });
    await srv.api('POST', `/api/orders/${order.id}/call-start`);
    await srv.api('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' });
    const o = await getOrder(order.id);
    assert.equal(o.deliveryOutcome, '', 'under COD a phone confirmation is not a sale');
  });
});

describe('the reporting chain that depended on deliveryOutcome', () => {
  test('client lifetime delivered count and spend now move', async () => {
    const phone = '05' + Math.floor(10000000 + Math.random() * 89999999);
    const { body: order } = await srv.api('POST', '/api/orders', {
      client: 'Lifetime', phone, price: 7500, delivery: providerCode,
    });
    await srv.api('POST', `/api/orders/${order.id}/call-start`);
    await srv.api('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' });
    for (let i = 0; i < 8; i++) {
      const { body } = await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);
      if ((body.events || []).some((e) => e.crmStatus === 'delivered')) break;
    }

    const client = await waitFor(async () => {
      const { body } = await srv.api('GET', '/api/clients?search=' + phone);
      const c = body.items[0];
      return c && c.deliveredOrders > 0 ? c : null;
    }, { label: 'client delivered stats' });

    assert.equal(client.deliveredOrders, 1);
    assert.equal(client.totalSpent, 7500, 'lifetime spend counts the delivered order');
    assert.equal(client.avgOrderValue, 7500);
  });

  test('product sales-summary reports real delivered units and revenue', async () => {
    const productName = 'Reported Widget ' + uid();
    const { body: product } = await srv.api('POST', '/api/products', {
      name: productName, price: 9000, costPrice: 3000, packagingCost: 200, stock: 50,
    });
    await deliverAnOrder({ price: 9000, product: productName, quantity: 1 });

    const summary = await waitFor(async () => {
      const { body } = await srv.api(
        'GET', `/api/products/${product.id}/sales-summary?since=0&until=${Date.now() + 60000}`
      );
      return body.deliveredCount > 0 ? body : null;
    }, { label: 'sales summary to report a delivery' });

    assert.equal(summary.deliveredCount, 1);
    assert.equal(summary.realCA, 9000, 'real revenue is no longer zero');
    assert.ok(summary.avgBuyPrice > 0, 'cost basis resolves for the profit calculation');
    assert.equal(summary.totalCostOfGoods, 3200, 'cost + packaging for one unit');
  });

  test('agent delivered-pay payroll now earns', async () => {
    const agent = 'Payroll ' + uid();
    await srv.api('POST', '/api/agents', {
      name: agent, pass: 'x', role: 'confirmation',
      baseSalaryMonthly: 0, payPerConfirmedOrder: 0, payPerDeliveredOrder: 250,
    });

    const { body: order } = await srv.api('POST', '/api/orders', {
      client: 'PayMe', phone: '05' + Math.floor(10000000 + Math.random() * 89999999),
      price: 4000, agent, delivery: providerCode,
    });
    await srv.api('POST', `/api/orders/${order.id}/call-start`);
    await srv.api('POST', `/api/orders/${order.id}/call`, { result: 'confirmed' });
    for (let i = 0; i < 8; i++) {
      const { body } = await srv.api('POST', `/api/orders/${order.id}/shipment/refresh`);
      if ((body.events || []).some((e) => e.crmStatus === 'delivered')) break;
    }
    await waitFor(async () => (await getOrder(order.id)).deliveryOutcome === 'delivered',
      { label: 'settlement' });

    const { body } = await srv.api(
      'GET', `/api/agents/${encodeURIComponent(agent)}/payroll?since=0&until=${Date.now() + 60000}`
    );
    assert.equal(body.deliveredOrders, 1);
    assert.equal(body.deliveredPay, 250, 'payPerDeliveredOrder finally pays out');
    assert.equal(body.totalPay, 250);
  });
});

describe('SSE delivery events are well formed (BUG-04)', () => {
  test('a delivery update arrives as a parseable object with type set', async () => {
    const events = [];
    const controller = new AbortController();

    // Subscribe as the manager before generating traffic.
    const streamDone = (async () => {
      // EventSource cannot set headers, so the SSE route also accepts ?token=
      // — the identity comes from the session either way, never from ?agent=.
      const { body: session } = await srv.api('POST', '/api/auth/login', {
        name: srv.admin.name, password: srv.admin.password,
      });
      const res = await fetch(
        `${srv.base}/api/notifications/subscribe?token=${encodeURIComponent(session.token)}`,
        { signal: controller.signal }
      );
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (line) { try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ } }
          }
        }
      } catch { /* aborted */ }
    })();

    await waitFor(async () => events.some((e) => e && e.type === 'connected'), { label: 'SSE connect' });
    await deliverAnOrder();

    const update = await waitFor(
      async () => events.find((e) => e && e.type === 'delivery_update'),
      { label: 'a delivery_update event', timeout: 12000 }
    );

    controller.abort();
    await streamDone;

    assert.equal(typeof update, 'object', 'the payload is an object, not the bare event name');
    assert.equal(update.type, 'delivery_update');
    assert.ok(update.shipmentId, 'shipmentId is present — the UI branches on it');
    assert.ok(update.orderId);
    assert.ok('customer' in update, 'the enriched fields the console renders are present');
    assert.ok('carrier' in update);
    assert.ok('oldStatusLabel' in update);
    assert.ok('newStatusLabel' in update);

    // The old bug produced a bare string frame; prove none arrived.
    assert.ok(
      !events.some((e) => typeof e === 'string'),
      'no malformed string-only frames were broadcast'
    );
  });
});
