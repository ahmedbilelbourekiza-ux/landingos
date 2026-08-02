import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  skip, phone, makeErpTenant, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/validation.test.ts
 *
 * Ported from apps/erp/test/validation.test.js (audit §4 — mass assignment and
 * input validation).
 *
 * PUT /api/orders/:id spread req.body straight into storage and PUT
 * /api/settings accepted arbitrary keys with arbitrary values. Both were
 * demonstrated against a running server before being fixed: one request
 * carrying {"deliveryOutcome":"delivered","price":999999} fabricated 999,999
 * of client lifetime revenue out of nothing.
 *
 * Prisma does not spread a request body the way `db.prepare(...).run(...)` did,
 * so the specific mechanism is gone. The field list is not: `deliveryOutcome`
 * is still settled only from carrier events, `phoneNormalized` is still the
 * dedup key, and a client that can write either can still fabricate revenue or
 * merge two customers. What changed is the mechanism; what must not change is
 * which fields a client may write.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('validation');
});

after(async () => {
  if (skip) return;
  await cleanup();
});

async function newOrder(extra: Record<string, unknown> = {}) {
  const r = await acme.manager.api('POST', '/api/erp/orders', {
    client: 'Val Client', phone: phone(), price: 1000, ...extra,
  });
  assert.equal(r.status, 201, `order creation failed: ${JSON.stringify(r.body)}`);
  return r.body.data;
}

const read = async (id: string) =>
  (await acme.manager.api('GET', `/api/erp/orders/${id}`)).body.data;

/* -----------------------------------------------------------------------------
 * Fields no client may write
 * -------------------------------------------------------------------------- */

describe('order fields that no client may write', () => {
  const FORBIDDEN: ReadonlyArray<readonly [string, unknown]> = [
    // Settled only from carrier events. Writable here means fabricated revenue.
    ['deliveryOutcome', 'delivered'],
    ['deliveryOutcomeAt', new Date().toISOString()],
    // The dedup key against Client. Writable here means merging two customers,
    // or splitting one, at will.
    ['phoneNormalized', 'tampered'],
    // Owned by the shipment pipeline.
    ['shipmentId', 'SHP-FAKE'],
    ['trackingNumber', 'TRK-FAKE'],
    // Owned by the overdue sweep and the call pipeline. Writable here means an
    // agent can clear their own missed-order clock.
    ['overdueFlaggedAt', null],
    ['pendingCallStart', new Date().toISOString()],
    // Provenance. An order that claims to have arrived from Shopify when it did
    // not corrupts every channel report downstream.
    ['externalId', 'FORGED'],
    ['source', 'forged'],
    ['tenantId', 'some-other-tenant'],
  ];

  for (const [field, value] of FORBIDDEN) {
    test(`${field} is not client-writable`, async () => {
      const order = await newOrder();
      const previous = order[field];

      const r = await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { [field]: value });
      assert.ok(r.status === 200 || r.status === 422,
        `${field} must be dropped or refused, not accepted (got ${r.status})`);

      const after = await read(order.id);
      assert.deepEqual(after[field], previous, `${field} must not be client-writable`);
    });
  }

  test('forging deliveryOutcome no longer fabricates revenue', async () => {
    // The demonstration that justified the original fix, kept intact.
    const number = phone();
    const order = await newOrder({ client: 'Revenue', phone: number, price: 999999 });
    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, {
      deliveryOutcome: 'delivered', deliveryOutcomeAt: new Date().toISOString(),
    });

    const r = await acme.manager.api('GET', `/api/erp/clients?search=${number}`);
    const client = r.body.data.items[0];
    assert.equal(client.deliveredOrders, 0, 'no delivery was fabricated');
    assert.equal(String(client.totalSpent), '0', 'no revenue was fabricated');
  });

  test('the order id itself cannot be changed', async () => {
    const order = await newOrder();
    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { id: 'HIJACKED' });
    assert.equal((await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).status, 200);
    assert.equal((await acme.manager.api('GET', '/api/erp/orders/HIJACKED')).status, 404);
  });

  test('a tenantId in the body cannot move a row to another tenant', async () => {
    // Layer 3 catches this even if layer 1 forgets: the RLS policy carries
    // WITH CHECK as well as USING, so an UPDATE that stamps another tenant's
    // id is refused by the database rather than merely invisible afterwards.
    const beta = await makeErpTenant('validation-beta');
    const order = await newOrder();
    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { tenantId: beta.tenantId });

    assert.equal((await acme.manager.api('GET', `/api/erp/orders/${order.id}`)).status, 200,
      'the order is still in the tenant that owns it');
    assert.equal((await beta.manager.api('GET', `/api/erp/orders/${order.id}`)).status, 404,
      'and did not appear in the other one');
  });

  test('prototype pollution attempts are dropped', async () => {
    const order = await newOrder();
    const r = await acme.manager.api(
      'PATCH', `/api/erp/orders/${order.id}`,
      JSON.parse('{"__proto__":{"polluted":true},"client":"Safe"}'),
    );
    assert.ok(r.status === 200 || r.status === 422);
    assert.equal(({} as Record<string, unknown>).polluted, undefined,
      'Object.prototype was not polluted');
    if (r.status === 200) {
      assert.equal((await read(order.id)).client, 'Safe', 'the legitimate field still applied');
    }
  });

  test('an unknown field does not silently become a column', async () => {
    const order = await newOrder();
    await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, { totallyMadeUp: 'yes' });
    const after = await read(order.id);
    assert.equal(after.totallyMadeUp, undefined);
  });
});

/* -----------------------------------------------------------------------------
 * Fields split by privilege
 * -------------------------------------------------------------------------- */

describe('order fields by privilege', () => {
  test('an agent can correct the details they legitimately fix', async () => {
    const order = await newOrder({ agentUserId: acme.agent.userId });
    const r = await acme.agent.api('PATCH', `/api/erp/orders/${order.id}`, {
      wilaya: 'Oran', commune: 'Es Senia', quantity: 3, note: 'customer wants three',
    });
    assert.equal(r.status, 200);

    const after = await read(order.id);
    assert.equal(after.wilaya, 'Oran');
    assert.equal(after.quantity, 3);
  });

  test('an agent cannot write manager-only fields', async () => {
    const order = await newOrder({ agentUserId: acme.agent.userId });
    await acme.agent.api('PATCH', `/api/erp/orders/${order.id}`, {
      managerNote: 'sneaky', marketer: 'me',
    });
    const after = await read(order.id);
    assert.ok(!after.managerNote, 'managerNote is manager-only');
    assert.ok(!after.marketer, 'marketer is manager-only');
  });

  test('a manager can write them', async () => {
    const order = await newOrder();
    const r = await acme.manager.api('PATCH', `/api/erp/orders/${order.id}`, {
      managerNote: 'checked', marketer: 'Sara',
    });
    assert.equal(r.status, 200);
    const after = await read(order.id);
    assert.equal(after.managerNote, 'checked');
    assert.equal(after.marketer, 'Sara');
  });

  test('an agent cannot rewrite the price of their own order', async () => {
    // The price is what the payroll and the profit calculator are computed
    // from. Editing the address on your own order is the job; editing the money
    // on it is not.
    const order = await newOrder({ agentUserId: acme.agent.userId, price: 1000 });
    await acme.agent.api('PATCH', `/api/erp/orders/${order.id}`, { price: 999999 });
    assert.equal(String((await read(order.id)).price), '1000');
  });
});

/* -----------------------------------------------------------------------------
 * Settings
 *
 * The ERP's `settings` table became the platform's ProductSetting, keyed by
 * product, so a tenth product needs no new table. The validation rules travel
 * with the settings themselves.
 * -------------------------------------------------------------------------- */

describe('settings validation', () => {
  const settings = () => acme.manager.api('GET', '/api/erp/settings');
  const put = (body: Record<string, unknown>) => acme.manager.api('PUT', '/api/erp/settings', body);

  test('an unknown key is refused, not stored', async () => {
    const r = await put({ totallyMadeUpKey: 'yes' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_SETTINGS');
    assert.equal((await settings()).body.data.totallyMadeUpKey, undefined);
  });

  test('a string where a boolean belongs is refused', async () => {
    // This one mattered in production: `if (s.autoSuspend)` is TRUE for the
    // STRING "false", so a typo would silently switch on automatic account
    // suspension for the whole company.
    assert.equal((await put({ autoSuspend: 'not-a-boolean' })).status, 422);
    assert.equal(typeof (await settings()).body.data.autoSuspend, 'boolean');
  });

  test('out-of-range numbers are refused', async () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['suspendThreshold', -5],
      ['workHoursStart', 99],
      ['minCallSeconds', -1],
      ['trackingPollMinutes', 0],
    ];
    for (const [key, value] of cases) {
      assert.equal((await put({ [key]: value })).status, 422, `${key}=${value} must be refused`);
    }
  });

  test('an impossible working-hours window is refused', async () => {
    const r = await put({ workHoursStart: 20, workHoursEnd: 9 });
    assert.equal(r.status, 422);
    assert.match(String(r.body.error.message), /workHoursEnd/);
  });

  test('an invalid reservation mode is refused and a valid one accepted', async () => {
    assert.equal((await put({ reservationMode: 'whenever' })).status, 422);
    assert.equal((await put({ reservationMode: 'on_confirm' })).status, 200);
  });

  test('valid settings round-trip and coerce numerically', async () => {
    const r = await put({ minCallSeconds: '45', autoAssign: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.minCallSeconds, 45, 'a numeric string is coerced to a number');
    assert.equal(r.body.data.autoAssign, true);
    assert.equal(r.body.data.autoCreateShipment, true, 'unrelated settings are preserved');
  });

  test('a rejected batch changes nothing at all', async () => {
    // Half-applying an invalid request is worse than refusing it: the caller
    // is told it failed and half of it happened anyway.
    const before = (await settings()).body.data.minCallSeconds;
    await put({ minCallSeconds: 33, bogusKey: 1 });
    assert.equal((await settings()).body.data.minCallSeconds, before,
      'the valid half of an invalid request must not be applied');
  });

  test('settings changes are recorded in the audit trail', async () => {
    await put({ alertMinutes: 77 });
    const r = await acme.manager.api('GET', '/api/erp/audit?entity=settings&pageSize=1');
    assert.equal(r.status, 200);
    const event = r.body.data.items[0];
    assert.ok(event, 'a settings change is auditable');
    assert.ok(JSON.stringify(event.payload ?? event.metadata ?? {}).includes('alertMinutes'));
  });

  test('an agent cannot read another tenant’s settings, and settings are per tenant', async () => {
    // ProductSetting is keyed by (tenant, product). Two tenants configuring the
    // same product must not share one row — the ERP had exactly one settings
    // table and no concept of a second company.
    const beta = await makeErpTenant('settings-beta');
    await acme.manager.api('PUT', '/api/erp/settings', { minCallSeconds: 61 });
    await beta.manager.api('PUT', '/api/erp/settings', { minCallSeconds: 62 });

    assert.equal((await settings()).body.data.minCallSeconds, 61);
    assert.equal((await beta.manager.api('GET', '/api/erp/settings')).body.data.minCallSeconds, 62);
  });

  test('an agent cannot write settings at all', async () => {
    const r = await acme.agent.api('PUT', '/api/erp/settings', { minCallSeconds: 1 });
    assert.equal(r.status, 403);
  });
});
