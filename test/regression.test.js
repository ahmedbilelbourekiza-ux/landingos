/* =============================================================================
 * test/regression.test.js — locks in the behaviour that ALREADY works.
 *
 * These tests exist to prove the audit fixes do not break anything. They were
 * written against the pre-fix codebase and must keep passing through every
 * phase. Nothing here asserts on a bug being present — that belongs in the
 * per-fix test files.
 * ========================================================================== */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uid } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { if (srv) await srv.stop(); });

describe('health + reference data', () => {
  test('health endpoint responds', async () => {
    const { status, body } = await srv.api('GET', '/');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });

  test('status vocabulary is exposed', async () => {
    const { body } = await srv.api('GET', '/api/statuses');
    assert.ok(body.order.includes('confirmed'));
    assert.ok(body.results.includes('tentative1'));
    assert.ok(!body.results.includes('pending'), 'pending is not a call result');
  });

  test('delivery status labels are exposed', async () => {
    const { body } = await srv.api('GET', '/api/delivery/statuses');
    assert.ok(body.statuses.includes('delivered'));
    assert.equal(body.labels.delivered, 'Livré');
    assert.ok(body.terminal.includes('returned'));
  });
});

describe('orders lifecycle', () => {
  let orderId;

  test('create an order', async () => {
    const { status, body } = await srv.api('POST', '/api/orders', {
      client: 'Test Client', phone: '+213555123456',
      product: 'Widget', quantity: 2, price: 4000,
      wilaya: 'Alger', commune: 'Bab Ezzouar',
    });
    assert.equal(status, 200);
    assert.match(body.id, /^ORD-\d{4}$/);
    assert.equal(body.status, 'pending');
    assert.equal(body.phone, '0555123456', 'phone is normalised to local form');
    orderId = body.id;
  });

  test('reject an order with no client or phone', async () => {
    const { status } = await srv.api('POST', '/api/orders', { product: 'X' });
    assert.equal(status, 400);
  });

  test('list includes the new order', async () => {
    const { body } = await srv.api('GET', '/api/orders');
    assert.ok(body.some((o) => o.id === orderId));
  });

  test('call-start then a valid call result moves the status', async () => {
    await srv.api('POST', `/api/orders/${orderId}/call-start`);
    const { status, body } = await srv.api('POST', `/api/orders/${orderId}/call`, {
      result: 'confirmed', note: 'customer agreed',
    });
    assert.equal(status, 200);
    assert.equal(body.message, 'logged');
    const after = await srv.api('GET', '/api/orders');
    assert.equal(after.body.find((o) => o.id === orderId).status, 'confirmed');
  });

  test('an unknown call result is rejected', async () => {
    const { status, body } = await srv.api('POST', `/api/orders/${orderId}/call`, { result: 'bogus' });
    assert.equal(status, 400);
    assert.ok(Array.isArray(body.valid));
  });

  test('a short call is flagged suspicious in the audit trail', async () => {
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'Quick', phone: '0555000111' });
    await srv.api('POST', `/api/orders/${o.id}/call-start`);
    await srv.api('POST', `/api/orders/${o.id}/call`, { result: 'confirmed' });
    const { body: audit } = await srv.api('GET', `/api/orders/${o.id}/audit`);
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].suspicious, true, 'sub-threshold call is flagged');
  });

  test('a result logged with no call-start is also flagged', async () => {
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'NoStart', phone: '0555000222' });
    await srv.api('POST', `/api/orders/${o.id}/call`, { result: 'cancelled' });
    const { body: audit } = await srv.api('GET', `/api/orders/${o.id}/audit`);
    assert.equal(audit.calls[0].suspicious, true);
    assert.equal(audit.calls[0].noStart, true);
  });

  test('standalone notes never set a result', async () => {
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'Noted', phone: '0555000333' });
    const { status } = await srv.api('POST', `/api/orders/${o.id}/note`, {
      noteType: 'client_called_back', note: 'client rang us',
    });
    assert.equal(status, 200);
    const { body: audit } = await srv.api('GET', `/api/orders/${o.id}/audit`);
    assert.equal(audit.calls[0].result, null);
    assert.equal(audit.currentStatus, 'pending', 'a note must not change status');
  });

  test('an invalid note type is rejected', async () => {
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'N', phone: '0555000444' });
    const { status } = await srv.api('POST', `/api/orders/${o.id}/note`, { noteType: 'nope', note: 'x' });
    assert.equal(status, 400);
  });

  test('an invalid status on update is rejected', async () => {
    const { status } = await srv.api('PUT', `/api/orders/${orderId}`, { status: 'not-a-status' });
    assert.equal(status, 400);
  });

  test('the attempts matrix has nine slots', async () => {
    const { body } = await srv.api('GET', `/api/orders/${orderId}/attempts`);
    assert.equal(body.matrix.length, 9);
    assert.equal(body.totalCalls, 1);
  });

  test('fake classification is orthogonal to status', async () => {
    const { body } = await srv.api('POST', `/api/orders/${orderId}/classify`, {
      classification: 'fake', reason: 'duplicate', responsible: 'agent',
    });
    assert.equal(body.classification, 'fake');
    assert.equal(body.status, 'confirmed', 'classifying must not touch status');
  });
});

describe('clients registry', () => {
  test('an order creates a permanent client keyed on the normalised phone', async () => {
    const phone = '0555' + Math.floor(100000 + Math.random() * 899999);
    await srv.api('POST', '/api/orders', { client: 'Registry Test', phone, price: 1000 });
    const { body } = await srv.api('GET', '/api/clients?search=' + phone);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].totalOrders, 1);
  });

  test('deleting an order does not delete the client', async () => {
    const phone = '0666' + Math.floor(100000 + Math.random() * 899999);
    const { body: o } = await srv.api('POST', '/api/orders', { client: 'Survivor', phone });
    await srv.api('DELETE', `/api/orders/${o.id}`);
    const { body } = await srv.api('GET', '/api/clients?search=' + phone);
    assert.equal(body.items.length, 1, 'client history survives order deletion');
  });

  test('filter options are exposed', async () => {
    const { status, body } = await srv.api('GET', '/api/clients/filter-options');
    assert.equal(status, 200);
    assert.ok(body && typeof body === 'object');
  });
});

describe('products and inventory', () => {
  let productId;

  test('create a product with variants', async () => {
    const { status, body } = await srv.api('POST', '/api/products', {
      name: 'Test Shoe ' + uid(), sku: 'TS-1', price: 5000,
      costPrice: 2000, packagingCost: 100, threshold: 10,
      variants: [{ name: 'Black/42', stock: 20, threshold: 5, sku: 'TS-1-B42' }],
    });
    assert.equal(status, 200);
    assert.equal(body.costPrice, 2000, 'costPrice must survive create');
    assert.equal(body.packagingCost, 100);
    assert.equal(body.variants[0].sku, 'TS-1-B42', 'variant sku must survive create');
    productId = body.id;
  });

  test('inventory reflects per-variant stock', async () => {
    const { body } = await srv.api('GET', `/api/products/${productId}/inventory`);
    assert.equal(body.variants[0].stock, 20);
    assert.equal(body.variants[0].threshold, 5);
  });

  test('a purchase lot raises stock and records cost', async () => {
    const { status, body } = await srv.api('POST', `/api/products/${productId}/stock-lots`, {
      variantName: 'Black/42', mode: 'purchase', qty: 10, unitCost: 2500, packagingCost: 120,
    });
    assert.equal(status, 200);
    assert.equal(body.inventory.variants[0].stock, 30);
    const lots = await srv.api('GET', `/api/products/${productId}/stock-lots?variantName=Black/42`);
    assert.ok(lots.body.active.length >= 1);
    assert.equal(lots.body.active.find((l) => l.unitCost === 2500).qtyRemaining, 10);
  });

  test('a manual adjustment appends to the ledger', async () => {
    await srv.api('POST', `/api/products/${productId}/inventory/adjust`, {
      variantName: 'Black/42', delta: -5, reason: 'damaged',
    });
    const { body } = await srv.api('GET', `/api/products/${productId}/inventory/history?variant=all`);
    assert.ok(body.items.some((m) => m.reason === 'damaged' && m.delta === -5));
  });

  test('archive hides the product from the active list but keeps it', async () => {
    await srv.api('DELETE', `/api/products/${productId}`);
    const active = await srv.api('GET', '/api/products');
    assert.ok(!active.body.some((p) => p.id === productId));
    const archived = await srv.api('GET', '/api/products?archived=true');
    assert.ok(archived.body.some((p) => p.id === productId), 'archived, not deleted');
    await srv.api('POST', `/api/products/${productId}/unarchive`);
    const back = await srv.api('GET', '/api/products');
    assert.ok(back.body.some((p) => p.id === productId));
  });

  test('product history records the lifecycle', async () => {
    const { body } = await srv.api('GET', `/api/products/${productId}/history`);
    assert.ok(Array.isArray(body.events));
    assert.ok(body.events.some((e) => e.eventType === 'archived'));
  });

  test('low-stock listing responds', async () => {
    const { status, body } = await srv.api('GET', '/api/inventory/low-stock');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
  });
});

describe('agents', () => {
  const name = 'Agent ' + uid();

  test('create an agent with payment configuration', async () => {
    const { status } = await srv.api('POST', '/api/agents', {
      name, pass: 'secret123', role: 'confirmation',
      baseSalaryMonthly: 30000, payPerConfirmedOrder: 50, payPerDeliveredOrder: 100,
    });
    assert.equal(status, 200);
    const { body } = await srv.api('GET', '/api/agents');
    const a = body.find((x) => x.name === name);
    assert.equal(a.baseSalaryMonthly, 30000, 'payment config must survive create');
    assert.equal(a.role, 'confirmation');
  });

  test('duplicate names are rejected', async () => {
    const { status } = await srv.api('POST', '/api/agents', { name });
    assert.equal(status, 400);
  });

  test('role can be changed, invalid roles rejected', async () => {
    assert.equal((await srv.api('PUT', `/api/agents/${encodeURIComponent(name)}/role`, { role: 'both' })).status, 200);
    assert.equal((await srv.api('PUT', `/api/agents/${encodeURIComponent(name)}/role`, { role: 'wizard' })).status, 400);
  });

  test('suspend and reactivate', async () => {
    await srv.api('POST', `/api/agents/${encodeURIComponent(name)}/suspend`);
    let { body } = await srv.api('GET', '/api/agents');
    assert.equal(body.find((x) => x.name === name).suspended, true);
    await srv.api('POST', `/api/agents/${encodeURIComponent(name)}/reactivate`);
    ({ body } = await srv.api('GET', '/api/agents'));
    assert.equal(body.find((x) => x.name === name).suspended, false);
  });

  test('weekly days off are stored and validated', async () => {
    const { body } = await srv.api('PUT', `/api/agents/${encodeURIComponent(name)}/days-off`, {
      weeklyDaysOff: [5, 99, 'x'],
    });
    assert.deepEqual(body.agent.weeklyDaysOff, [5], 'out-of-range values are dropped');
  });

  test('payroll computes for all agents', async () => {
    const { status, body } = await srv.api('GET', '/api/agents/payroll?since=0&until=' + Date.now());
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
  });
});

describe('settings', () => {
  test('settings round-trip and preserve defaults', async () => {
    const { body: before } = await srv.api('GET', '/api/settings');
    assert.equal(before.autoCreateShipment, true);
    const { body: after } = await srv.api('PUT', '/api/settings', { minCallSeconds: 55 });
    assert.equal(after.minCallSeconds, 55);
    assert.equal(after.autoCreateShipment, true, 'unrelated settings are preserved');
    await srv.api('PUT', '/api/settings', { minCallSeconds: before.minCallSeconds });
  });
});

describe('providers and stores', () => {
  let providerId;

  test('adapters are listed', async () => {
    const { body } = await srv.api('GET', '/api/providers/adapters');
    assert.ok(body.some((a) => a.key === 'zr'));
  });

  test('create a provider and mask its secrets on read', async () => {
    const code = 'p' + uid();
    const { status, body } = await srv.api('POST', '/api/providers', {
      name: 'Test Carrier', code, adapter: 'mock',
      apiKey: 'super-secret-key-value', secretKey: 'another-secret',
    });
    assert.equal(status, 200);
    providerId = body.id;
    assert.ok(!body.apiKey.includes('super-secret'), 'apiKey must be masked on read');
    assert.equal(body.secretKey, '••••');
    assert.equal(body._hasCredentials, true);
  });

  test('re-saving with the masked value does not destroy the stored secret', async () => {
    const { body: read } = await srv.api('GET', '/api/providers');
    const p = read.find((x) => x.id === providerId);
    await srv.api('PUT', `/api/providers/${providerId}`, { ...p, name: 'Renamed Carrier' });
    const { body: after } = await srv.api('GET', '/api/providers');
    const q = after.find((x) => x.id === providerId);
    assert.equal(q.name, 'Renamed Carrier');
    assert.equal(q._hasCredentials, true, 'the real secret must still be there');
  });

  test('status mappings round-trip', async () => {
    await srv.api('POST', `/api/providers/${providerId}/status-mappings`, {
      originalStatus: 'Livré au client', crmStatus: 'delivered',
    });
    const { body } = await srv.api('GET', `/api/providers/${providerId}/status-mappings`);
    assert.ok(body.some((m) => m.crmStatus === 'delivered'));
  });

  test('platforms are listed and a store can be created', async () => {
    const { body: plats } = await srv.api('GET', '/api/platforms');
    assert.ok(plats.length > 0);
    const { status, body } = await srv.api('POST', '/api/stores', {
      name: 'Test Store', platform: 'shopify', apiKey: 'store-secret',
    });
    assert.equal(status, 200);
    assert.match(body.webhookEndpoint, /^\/webhook\/store\/STR-/);
    assert.ok(!String(body.apiKey).includes('store-secret'), 'store apiKey must be masked');
  });
});

describe('shipments', () => {
  test('a confirmed order can have a shipment created and tracked', async () => {
    const code = 'm' + uid();
    const { body: prov } = await srv.api('POST', '/api/providers', {
      name: 'Mock Co', code, adapter: 'mock', apiEnabled: true,
    });
    await srv.api('POST', `/api/providers/${prov.id}/default`);

    const { body: o } = await srv.api('POST', '/api/orders', {
      client: 'Ship Me', phone: '0777' + Math.floor(100000 + Math.random() * 899999),
      price: 3000, delivery: code,
    });
    const { status, body } = await srv.api('POST', `/api/orders/${o.id}/shipment`, { actor: 'test' });
    assert.equal(status, 200);
    assert.ok(body.shipment.id.startsWith('SHP-'));
    assert.equal(body.shipment.crmStatus, 'created', 'a new shipment starts at created');
    assert.ok(body.shipment.trackingNumber, 'the carrier returned a tracking number');

    const { body: read } = await srv.api('GET', `/api/orders/${o.id}/shipment`);
    assert.equal(read.shipment.id, body.shipment.id);
    assert.ok(Array.isArray(read.events));
    assert.equal(read.events.length, 1, 'creation is recorded as the first event');
  });

  test('every registered adapter key answers the full contract', async () => {
    // Regression guard for the mock.mapStatus gap: getAdapter() falls back to
    // the generic adapter for unimplemented keys, so a missing contract member
    // broke shipment creation for every carrier in the dropdown that has no
    // implementation yet.
    const providers = require('../lib/providers');
    for (const { key } of providers.listAdapterKeys()) {
      const a = providers.getAdapter(key);
      for (const m of ['createShipment', 'getTracking', 'parseWebhook', 'mapStatus']) {
        assert.equal(typeof a[m], 'function', `adapter "${key}" is missing ${m}()`);
      }
      assert.equal(typeof a.mapStatus('anything'), 'string', `adapter "${key}" mapStatus must return a status`);
    }
  });
});

describe('follow-up and bulk operations', () => {
  test('the follow-up dashboard returns all five buckets', async () => {
    const { body } = await srv.api('GET', '/api/followup/dashboard');
    for (const k of ['waitingFollowup', 'inDelivery', 'needsContact', 'problems', 'escalation']) {
      assert.ok(k in body.counts, `bucket ${k} missing`);
    }
  });

  test('bulk status change reports per-id results', async () => {
    const { body: a } = await srv.api('POST', '/api/orders', { client: 'B1', phone: '0555900001' });
    const { body: b } = await srv.api('POST', '/api/orders', { client: 'B2', phone: '0555900002' });
    const { body } = await srv.api('POST', '/api/orders/bulk', {
      ids: [a.id, b.id, 'ORD-9999'], action: 'status', value: 'no_answer',
    });
    assert.equal(body.processed, 3);
    assert.equal(body.succeeded, 2);
    assert.equal(body.results.find((r) => r.id === 'ORD-9999').ok, false);
  });

  test('bulk rejects a missing ids array', async () => {
    const { status } = await srv.api('POST', '/api/orders/bulk', { action: 'status', value: 'pending' });
    assert.equal(status, 400);
  });
});

describe('financial records', () => {
  test('a record can be saved and read back', async () => {
    const start = Date.now() - 7 * 86400000;
    const end = Date.now();
    const { status } = await srv.api('POST', '/api/financial-records', {
      periodType: 'week', startDate: start, endDate: end,
      revenue: 100000, productCosts: 40000, shippingCosts: 5000,
      advertisingCosts: 10000, fixedExpenses: 8000, unexpectedExpenses: 0,
    });
    assert.equal(status, 200);
    const { body } = await srv.api('GET', '/api/financial-records?periodType=week');
    const rec = body.items.find((r) => r.startDate === start);
    assert.ok(rec);
    assert.equal(rec.netProfit, 37000, 'netProfit is derived, not stored blindly');
  });

  test('unexpected charges round-trip', async () => {
    const { body } = await srv.api('POST', '/api/unexpected-charges', { label: 'Van repair', amount: 12000 });
    assert.ok(body.id);
    const { body: list } = await srv.api('GET', '/api/unexpected-charges');
    assert.ok(list.items.some((c) => c.label === 'Van repair'));
    await srv.api('DELETE', `/api/unexpected-charges/${body.id}`);
    const { body: after } = await srv.api('GET', '/api/unexpected-charges');
    assert.ok(!after.items.some((c) => c.id === body.id));
  });

  test('fixed-cost proration responds', async () => {
    const { status, body } = await srv.api('GET', '/api/financial-records/prorate-fixed?periodType=month');
    assert.equal(status, 200);
    assert.equal(typeof body.prorated, 'number');
  });
});
