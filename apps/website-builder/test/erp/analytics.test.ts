import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, phone, waitFor, makeErpTenant, makeMember, cleanup, slugOf,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/analytics.test.ts — LP.13, restoring R6 / K1 / N18 / N20.
 *
 * THE CONFIRMATION RATE WAS COMPUTED NOWHERE ON THIS PLATFORM. Not on the
 * dashboard, not on any screen, not in any route. It is the number a COD call
 * centre is MANAGED by — how many of the people who ordered actually agreed when
 * somebody phoned — and the legacy leads its dashboard with it and recomputes it
 * across seven dimensions. Two agents with a 40% and a 75% rate looked identical
 * on every screen that existed.
 *
 * Three properties this file exists to hold, each of which is easy to get wrong
 * in a way that produces a plausible number:
 *
 *   1. ORDERS ARE COUNTED BY CREATION AND PARCELS BY SETTLEMENT. A parcel
 *      ordered in March and delivered in April belongs to March's order count
 *      and April's delivered count. Folding either into the other gives a month
 *      that cannot be reconciled against anything.
 *   2. THE ROWS ARE RECORD-SCOPED. An agent's analytics is their own queue, by
 *      the same `scopedWhere` the list and the export use — and the BY-AGENT
 *      table is withheld without `erp:agents:manage`, because a league table of
 *      colleagues' rates is supervision data.
 *   3. BOTH REVENUE FIGURES ARE REPORTED, AND NEITHER IS CALLED "REVENUE"
 *      (N19). Confirmed value is what customers agreed to; delivered value is
 *      what the carrier paid. Under cash on delivery they are different numbers.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;
let carrierCode = '';

const page = async (path: string, token: string) => {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: `${SESSION_COOKIE}=${token}; locale=en` },
  });
  return { status: res.status, body: await res.text() };
};

const analytics = async (who: typeof acme.manager, query = '') =>
  (await who.api('GET', `/api/erp/analytics${query}`)).body.data as {
    headline: Record<string, string | number>;
    dimensions: Record<string, Array<{ key: string; orders: number; confirmed: number; confirmationRate: string; cancellationRate: string; confirmedValue: string }>>;
    offered: string[];
  };

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('analytics');

  carrierCode = `ak${uid()}`;
  const created = await acme.manager.api('POST', '/api/erp/carriers', {
    name: 'Analytics Carrier', code: carrierCode, adapter: 'mock', apiEnabled: true,
  });
  await acme.manager.api('POST', `/api/erp/carriers/${created.body.data.id}/default`, {});
  await acme.manager.api('PUT', '/api/erp/settings', { autoCreateShipment: true });

  /* Four orders with a KNOWN shape, so every rate below is checkable by hand:
   *   2 confirmed (4000 + 6000 = 10000), 1 cancelled, 1 left pending.
   *   confirmation 50.0%, cancellation 25.0%, average order 5000.00. */
  const make = async (body: Record<string, unknown>) =>
    (await acme.manager.api('POST', '/api/erp/orders', {
      client: `Analytics ${uid()}`, phone: phone(), carrierCode,
      wilaya: 'Alger', product: 'Widget A', ...body,
    })).body.data.id as string;

  const a = await make({ price: 4000 });
  const b = await make({ price: 6000, product: 'Widget B' });
  const c = await make({ price: 9000, wilaya: 'Oran' });
  await make({ price: 1000 });

  // `marketer` is written by the channel webhooks and is MANAGER_WRITABLE, so a
  // manager attributes a phone order to the campaign that produced it. It is
  // deliberately not part of `CreateOrder`'s vocabulary — see N20.
  for (const id of [a, b, c]) {
    await acme.manager.api('PATCH', `/api/erp/orders/${id}`, { marketer: 'campaign-x' });
  }

  for (const id of [a, b]) {
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });
  }
  await acme.manager.api('POST', `/api/erp/orders/${c}/call-start`, {});
  await acme.manager.api('POST', `/api/erp/orders/${c}/call`, { result: 'cancelled' });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

describe('the number this business is managed by', () => {
  test('the confirmation rate is finally computed, and it is right', async () => {
    const d = await analytics(acme.manager);
    assert.equal(d.headline.orders, 4);
    assert.equal(d.headline.confirmed, 2);
    assert.equal(d.headline.confirmationRate, '50.0');
    assert.equal(d.headline.cancelled, 1);
    assert.equal(d.headline.cancellationRate, '25.0');
  });

  test('the two revenue figures are both reported and are not the same question', async () => {
    // N19. Confirmed value is what customers agreed to on the phone; delivered
    // value is what the carrier actually paid. The legacy reports only the
    // first and the platform's dashboard only the second, so somebody comparing
    // them files a bug against the correct one.
    const d = await analytics(acme.manager);
    assert.equal(String(d.headline.confirmedValue), '10000');
    assert.equal(String(d.headline.averageOrderValue), '5000.00');
    assert.equal(d.headline.delivered, 0, 'nothing has been settled by a carrier yet');
    assert.equal(String(d.headline.deliveredValue), '0');
  });

  test('a rate with no denominator is 0.0, never a division by zero', async () => {
    const empty = await makeErpTenant(`analytics-empty-${uid()}`);
    const d = await analytics(empty.manager);
    assert.equal(d.headline.orders, 0);
    assert.equal(d.headline.confirmationRate, '0.0');
    assert.equal(d.headline.averageOrderValue, '0.00');
    assert.equal(d.headline.deliveryRate, '0.0');
  });

  test('never-called is not the same question as pending', async () => {
    // An order with three failed attempts is being WORKED; one with none is
    // being IGNORED. A status count cannot tell them apart, which is why the
    // legacy shows both and the platform's dashboard showed neither.
    const d = await analytics(acme.manager);
    assert.equal(d.headline.neverCalled, 1, 'exactly the one order nobody phoned');

    const withAttempts = (await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Tried Three Times', phone: phone(), price: 500, carrierCode,
    })).body.data.id;
    for (let i = 0; i < 3; i++) {
      await acme.manager.api('POST', `/api/erp/orders/${withAttempts}/call-start`, {});
      await acme.manager.api('POST', `/api/erp/orders/${withAttempts}/call`, { result: 'no_answer' });
    }

    const after = await analytics(acme.manager);
    assert.equal(after.headline.neverCalled, 1, 'three failed attempts is not "never called"');
    assert.ok(Number(after.headline.orders) > Number(d.headline.orders));
  });
});

describe('the seven breakdowns, each a groupBy rather than a browser', () => {
  test('every dimension the legacy has is answered', async () => {
    const d = await analytics(acme.manager);
    for (const dimension of [
      'status', 'salesChannelName', 'product', 'wilaya', 'agentUserId',
      'marketer', 'deliveryStatus',
    ]) {
      assert.ok(dimension in d.dimensions, `missing dimension ${dimension}`);
    }
  });

  test('a product bucket carries its own confirmation rate and confirmed value', async () => {
    const d = await analytics(acme.manager);
    const widgetB = d.dimensions.product.find((b) => b.key === 'Widget B');
    assert.ok(widgetB, 'the product dimension lost a product');
    assert.equal(widgetB.orders, 1);
    assert.equal(widgetB.confirmed, 1);
    assert.equal(widgetB.confirmationRate, '100.0');
    assert.equal(String(widgetB.confirmedValue), '6000');
  });

  test('N20 — ad attribution is computable at last', async () => {
    // `marketer` and `source` are written by the channel webhooks and were read
    // by NOTHING, so a business that buys its orders could not tell which
    // campaign paid for itself.
    const d = await analytics(acme.manager);
    const campaign = d.dimensions.marketer.find((b) => b.key === 'campaign-x');
    assert.ok(campaign, 'the marketer dimension is empty');
    assert.ok(campaign.orders >= 3);
    assert.equal(campaign.confirmationRate, String(((campaign.confirmed / campaign.orders) * 100).toFixed(1)));
  });

  test('a bucket with no value is keyed as empty rather than dropped', async () => {
    // An order with no wilaya is still an order, and a breakdown that silently
    // omits it makes the column not add up to the total — which is how somebody
    // stops trusting the whole screen.
    await acme.manager.api('POST', '/api/erp/orders', {
      client: 'No Wilaya', phone: phone(), price: 100, carrierCode,
    });
    const d = await analytics(acme.manager);
    const sum = d.dimensions.wilaya.reduce((n, b) => n + b.orders, 0);
    assert.equal(sum, d.headline.orders, 'the wilaya breakdown does not add up to the total');
  });
});

describe('orders are counted by creation and parcels by settlement', () => {
  test('a delivered parcel moves the delivery figures and not the order count', async () => {
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Settled', phone: phone(), price: 7000, carrierCode, product: 'Widget A',
    });
    const id = created.body.data.id;
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });
    for (let i = 0; i < 8; i++) {
      const r = await acme.manager.api('POST', `/api/erp/orders/${id}/shipment/refresh`, {});
      if ((r.body.data.events ?? []).some((e: { crmStatus: string }) => e.crmStatus === 'delivered')) break;
    }
    await waitFor(async () =>
      (await acme.manager.api('GET', `/api/erp/orders/${id}`)).body.data.deliveryOutcome === 'delivered'
        ? true : null,
      { label: 'settlement' },
    );

    const d = await analytics(acme.manager);
    assert.equal(d.headline.delivered, 1);
    assert.equal(String(d.headline.deliveredValue), '7000');
    assert.equal(d.headline.deliveryRate, '100.0', 'one delivered, none returned');
  });

  test('a returned parcel lowers the delivery rate without touching confirmation', async () => {
    const created = await acme.manager.api('POST', '/api/erp/orders', {
      client: 'Refused', phone: phone(), price: 3000, carrierCode,
    });
    const id = created.body.data.id;
    await acme.manager.api('POST', `/api/erp/orders/${id}/call-start`, {});
    await acme.manager.api('POST', `/api/erp/orders/${id}/call`, { result: 'confirmed' });
    const tracking = (await acme.manager.api('GET', `/api/erp/orders/${id}/shipment`))
      .body.data.shipment.trackingNumber;

    await fetch(`${BASE}/api/erp/webhooks/${await slugOf(acme.tenantId)}/delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackingNumber: tracking, status: 'Retour au vendeur' }),
    });
    await waitFor(async () =>
      (await acme.manager.api('GET', `/api/erp/orders/${id}`)).body.data.deliveryOutcome === 'returned'
        ? true : null,
      { label: 'the return to settle' },
    );

    const d = await analytics(acme.manager);
    assert.equal(d.headline.returned, 1);
    assert.equal(d.headline.deliveryRate, '50.0', 'one of two settled parcels arrived');
  });
});

describe('who sees whose numbers', () => {
  test('an agent gets the analytics of their own queue, not the company’s', async () => {
    const solo = await makeMember(acme.tenantId, {
      role: 'MEMBER', permissions: ['erp:orders:write'], jobRole: 'confirmation',
    });
    const mine = await analytics(solo);
    const all = await analytics(acme.manager);
    // The scope is the list's scope: own orders plus the unassigned queue. The
    // point is that it is NOT the whole book — the same reason the dashboard
    // scopes its tiles.
    assert.ok(
      Number(mine.headline.orders) <= Number(all.headline.orders),
      'an agent was shown more than the manager',
    );
  });

  test('the by-agent league table is withheld from somebody who cannot manage the roster', async () => {
    // Supervision data. `notifySuspiciousCall` withholds the same class of fact
    // from the agent it is about, and LP.6 gates its `agents` export the same way.
    const solo = await makeMember(acme.tenantId, {
      role: 'MEMBER', permissions: ['erp:orders:write'], jobRole: 'confirmation',
    });
    const mine = await analytics(solo);
    assert.ok(!mine.offered.includes('agentUserId'), 'an agent was handed the league table');
    assert.ok(!('agentUserId' in mine.dimensions));

    const boss = await analytics(acme.manager);
    assert.ok(boss.offered.includes('agentUserId'));
  });

  test('an anonymous caller gets nothing', async () => {
    const r = await fetch(`${BASE}/api/erp/analytics`);
    assert.equal(r.status, 401);
  });
});

describe('the window is the order list’s own vocabulary', () => {
  test('a range narrows it, using the same parameter the list takes', async () => {
    // D-LP.3: one filter vocabulary. "The confirmation rate for Alger last week"
    // has to mean the same thing on both screens or somebody will trust one.
    const all = await analytics(acme.manager);
    const today = await analytics(acme.manager, '?range=today');
    assert.ok(Number(today.headline.orders) > 0, 'everything here was created today');
    assert.equal(today.headline.orders, all.headline.orders);

    const wilaya = await analytics(acme.manager, '?wilaya=Oran');
    assert.equal(wilaya.headline.orders, 1, 'one order was placed in Oran');
    assert.equal(wilaya.headline.confirmationRate, '0.0', 'and it was cancelled');
  });
});

describe('the screens', () => {
  test('the analytics screen renders and leads with the rate', async () => {
    const r = await page('/console/erp/analytics', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="analytics-tiles"/);
    assert.match(r.body, /data-tile="confirmation-rate"/);
    assert.match(r.body, /data-tile="never-called"/);
    // And it says out loud that the two revenue figures are different questions.
    assert.match(r.body, /data-testid="analytics-revenue-note"/);
  });

  test('every dimension it was given has a table', async () => {
    const r = await page('/console/erp/analytics', acme.manager.token);
    for (const dimension of ['status', 'product', 'wilaya', 'marketer', 'agentUserId']) {
      assert.match(r.body, new RegExp(`data-dimension="${dimension}"`), `no table for ${dimension}`);
    }
  });

  test('an agent’s screen has no by-agent table — the gate is on the page too', async () => {
    // A screen reading the database directly must apply the permission its API
    // applies. A nav item is a hint; the URL is typeable.
    const solo = await makeMember(acme.tenantId, {
      role: 'MEMBER', permissions: ['erp:orders:write'], jobRole: 'confirmation',
    });
    const r = await page('/console/erp/analytics', solo.token);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body, /data-dimension="agentUserId"/);
  });

  test('the dashboard shows the confirmation rate beside the count it comes from', async () => {
    const r = await page('/console/erp', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-sub="confirmed"/);
    assert.match(r.body, /Confirmation rate/);
    assert.match(r.body, /data-tile="never-called"/);
  });

  test('the overdue banner appears only when there is something to act on', async () => {
    // A count of orders nobody has phoned within the company's own alertMinutes
    // is a queue that needs draining, not a tile that reads zero all day.
    const quiet = await makeErpTenant(`analytics-quiet-${uid()}`);
    const before = await page('/console/erp', quiet.manager.token);
    assert.doesNotMatch(before.body, /data-testid="erp-overdue-banner"/);

    // One minute is the floor `SETTINGS_SCHEMA` allows, so this is the tenant's
    // own threshold rather than a number the screen invented.
    await quiet.manager.api('PUT', '/api/erp/settings', { alertMinutes: 1 });
    await quiet.manager.api('POST', '/api/erp/orders', {
      client: 'Ignored', phone: phone(), price: 100,
    });
    const { backdateOrder } = await import('./helpers.ts');
    const listed = await quiet.manager.api('GET', '/api/erp/orders');
    await backdateOrder(quiet.tenantId, listed.body.data.items[0].id, 120);

    const after = await page('/console/erp', quiet.manager.token);
    assert.match(after.body, /data-testid="erp-overdue-banner"/);
    assert.match(after.body, /data-overdue="1"/);
  });
});
