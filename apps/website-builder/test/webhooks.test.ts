import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { asPlatform, withTenant, disconnect } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

/* =============================================================================
 * Outbound webhooks — DELIVERY, not CRUD (LB.3).
 *
 * The CRUD suite existed and nothing ever received a webhook in a test, which
 * is how three independent kills shipped in one pipeline: subscribesTo
 * JSON.parse-ing a Json array (every endpoint "subscribed to nothing"),
 * secrets stored in plaintext while delivery decrypted them, and the draft
 * trigger firing inside the transaction its own read could not see. Every test
 * here stands up a REAL receiver on an ephemeral port and asserts on what
 * actually arrived — the stub-server pattern delivery.test.ts proved for ZR.
 *
 * The stub endpoints are seeded straight into the database with PLAINTEXT
 * secrets — deliberately, because rows written by the first platform port look
 * exactly like that and revealSecret must keep signing for them. The
 * encrypted-at-rest path is proven separately through the real create API.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();
const slug = `hooks-${stamp}`;
const SECRET = `whsec-test-${stamp}`;
let tenantId = '';
let ownerId = '';
let ownerToken = '';
let pageId = '';
let wilayaId = 0;

// ---------------------------------------------------------------------------
// The receiver. One HTTP server; each logical endpoint is a PATH on it, and
// the response status is keyed by path so one test's receiver can be broken
// while another's answers 200.
// ---------------------------------------------------------------------------
interface Received {
  path: string;
  topic: string | undefined;
  signature: string | undefined;
  attempt: string | undefined;
  resourceId: string | undefined;
  rawBody: string;
}
const received: Received[] = [];
const statusByPath: Record<string, number> = {};
let stub: Server;
let stubPort = 0;

function stubUrl(path: string): string {
  return `http://127.0.0.1:${stubPort}${path}`;
}

async function waitFor<T>(probe: () => T | undefined, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for webhook delivery');
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE}=${token}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

const post = (p: string, data: unknown) =>
  fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

async function seedEndpoint(path: string, events: string[]): Promise<string> {
  const row = await withTenant(tenantId, (tx) =>
    (tx as any).webhookEndpoint.create({
      data: {
        tenantId, label: path, url: stubUrl(path), secret: SECRET, events, isActive: true,
      },
      select: { id: true },
    }),
  );
  return row.id;
}

before(async () => {
  if (skip) return;

  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        topic: req.headers['x-landingos-topic'] as string | undefined,
        signature: req.headers['x-landingos-hmac-sha256'] as string | undefined,
        attempt: req.headers['x-landingos-delivery-attempt'] as string | undefined,
        resourceId: req.headers['x-landingos-resource-id'] as string | undefined,
        rawBody: raw,
      });
      res.statusCode = statusByPath[req.url ?? ''] ?? 200;
      // A 3xx answer carries a Location on the same stub, so a delivery layer
      // that FOLLOWED it would show up as a hit on /redirect-target.
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.setHeader('location', stubUrl('/redirect-target'));
      }
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubPort = (stub.address() as AddressInfo).port;

  const t = await asPlatform().tenant.create({ data: { slug, name: 'Hooks Shop' } });
  tenantId = t.id;
  await withTenant(tenantId, async (tx) => {
    await (tx as any).subscription.create({
      data: { tenantId, status: 'ACTIVE', entitlements: ['product.website-builder'] },
    });
    const w = await (tx as any).wilaya.findFirst({ orderBy: { code: 'asc' }, select: { id: true } });
    wilayaId = w.id;
    await (tx as any).tenantDeliveryPrice.create({
      data: { tenantId, wilayaId: w.id, homePrice: 400, deskPrice: 250 },
    });
    const page = await (tx as any).landingPage.create({
      data: { tenantId, title: 'Hooked Product', slug: 'hooked-product', price: 2500, published: true, status: 'PUBLISHED' },
      select: { id: true },
    });
    pageId = page.id;
  });

  const email = `hooks-${stamp}@landingos.test`;
  const u = await asPlatform().user.create({
    data: { email, name: email, passwordHash: await hashPassword('x') },
  });
  ownerId = u.id;
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } }),
  );
  ownerToken = (await createSession(u.id, tenantId)).token;
});

after(async () => {
  if (skip) return;
  await new Promise<void>((resolve) => stub.close(() => resolve()));
  await destroySessionsForUser(ownerId).catch(() => {});
  await withTenant(tenantId, (tx) => (tx as any).membership.deleteMany({ where: { userId: ownerId } })).catch(() => {});
  await asPlatform().user.delete({ where: { id: ownerId } }).catch(() => {});
  await asPlatform().tenant.deleteMany({ where: { id: tenantId } });
  await disconnect();
});

describe('secrets are handled like secrets', { skip }, () => {
  test('a created endpoint stores its secret encrypted and never returns it', async () => {
    const r = await api('/api/platform/integrations/webhooks', ownerToken, {
      method: 'POST',
      body: JSON.stringify({
        label: 'Encrypted', url: 'https://example.invalid/hook',
        secret: 'super-secret-value', events: ['order.created'],
      }),
    });
    assert.equal(r.status, 201);
    assert.notEqual(r.body.data.secret, 'super-secret-value', 'the response masks the secret');

    const row = await withTenant(tenantId, (tx) =>
      (tx as any).webhookEndpoint.findFirst({ where: { label: 'Encrypted' }, select: { id: true, secret: true } }),
    );
    assert.notEqual(row.secret, 'super-secret-value', 'not plaintext at rest');
    assert.match(row.secret, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i, 'iv:tag:ciphertext');

    // Clean up so this unreachable endpoint does not absorb later events.
    await api(`/api/platform/integrations/webhooks/${row.id}`, ownerToken, { method: 'DELETE' });
  });
});

describe('events are delivered, signed, to subscribers only', { skip }, () => {
  test('a checkout delivers order.created with a verifiable HMAC over the raw body', async () => {
    await seedEndpoint('/orders-hook', ['order.created', 'order.updated', 'order.cancelled']);
    const unrelated = await seedEndpoint('/products-only', ['product.deleted']);

    const r = await post(`/api/storefront/${slug}/orders`, {
      landingPageId: pageId, customerName: 'Webhook Buyer', phone: '0555121212',
      wilayaId, baladiaName: 'Centre', quantity: 2, shippingMethod: 'HOME',
    });
    assert.equal(r.status, 201);

    const hit = await waitFor(() => received.find((x) => x.path === '/orders-hook'));
    assert.equal(hit.topic, 'order.created');

    // The signature must verify over the EXACT raw body with the endpoint's
    // own secret — this is the property a receiver depends on.
    const expected = createHmac('sha256', SECRET).update(hit.rawBody, 'utf8').digest('base64');
    assert.equal(hit.signature, expected, 'HMAC verifies');

    const payload = JSON.parse(hit.rawBody);
    assert.equal(payload.event, 'order.created');
    assert.equal(payload.data.total_price, '5400.00', '2 × 2500 + 400 shipping');
    assert.equal(payload.data.shipping_address.country_code, 'DZ');

    // The unsubscribed endpoint saw nothing — subscription filters, it does
    // not merely label.
    assert.equal(received.filter((x) => x.path === '/products-only').length, 0);
    await withTenant(tenantId, (tx) => (tx as any).webhookEndpoint.deleteMany({ where: { id: unrelated } }));
  });

  test('a lead fires draft_order.created once, then draft_order.updated', async () => {
    await seedEndpoint('/leads-hook', ['draft_order.created', 'draft_order.updated']);
    const token = `tok-${stamp}-hooklead`;

    await post(`/api/storefront/${slug}/draft-orders`, {
      token, landingPageId: pageId, customerName: 'Warm Lead', phone: '0555343434',
    });
    const first = await waitFor(() =>
      received.find((x) => x.path === '/leads-hook' && x.topic === 'draft_order.created'));
    assert.ok(first, 'the lead reached the receiver');
    const firstPayload = JSON.parse(first.rawBody);
    assert.equal(firstPayload.data.landingos.abandoned, true);

    await post(`/api/storefront/${slug}/draft-orders`, {
      token, landingPageId: pageId, customerName: 'Warm Lead', phone: '0555343434', wilaya: 'Adrar',
    });
    const second = await waitFor(() =>
      received.find((x) => x.path === '/leads-hook' && x.topic === 'draft_order.updated'));
    assert.ok(second, 'a later capture is an update, not a duplicate lead');
  });

  test('publish and unpublish fire the page lifecycle events', async () => {
    await seedEndpoint('/pages-hook', ['page.published', 'page.unpublished']);

    const down = await api(`/api/builder/landings/${pageId}/publish`, ownerToken, {
      method: 'POST', body: JSON.stringify({ published: false }),
    });
    assert.equal(down.status, 200);
    await waitFor(() => received.find((x) => x.path === '/pages-hook' && x.topic === 'page.unpublished'));

    const up = await api(`/api/builder/landings/${pageId}/publish`, ownerToken, {
      method: 'POST', body: JSON.stringify({ published: true }),
    });
    assert.equal(up.status, 200);
    const hit = await waitFor(() => received.find((x) => x.path === '/pages-hook' && x.topic === 'page.published'));
    const payload = JSON.parse(hit.rawBody);
    assert.equal(payload.data.status, 'active', 'the payload reflects the committed state');
  });

  test('creating and deleting a page fire product.created and product.deleted', async () => {
    await seedEndpoint('/catalog-hook', ['product.created', 'product.deleted']);

    const create = await api('/api/builder/landings', ownerToken, {
      method: 'POST',
      body: JSON.stringify({ title: 'Ephemeral', slug: `ephemeral-${stamp}`, price: 900 }),
    });
    assert.equal(create.status, 201);
    const created = await waitFor(() =>
      received.find((x) => x.path === '/catalog-hook' && x.topic === 'product.created'));
    assert.equal(JSON.parse(created.rawBody).data.title, 'Ephemeral');

    const del = await api(`/api/builder/landings/${create.body.data.id}`, ownerToken, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const deleted = await waitFor(() =>
      received.find((x) => x.path === '/catalog-hook' && x.topic === 'product.deleted'));
    assert.equal(JSON.parse(deleted.rawBody).data.id, create.body.data.id,
      'the payload is the pre-delete snapshot — there is no row left to read');
  });

  test('an order status change fires order.updated; cancellation fires order.cancelled', async () => {
    const orderId = (await withTenant(tenantId, (tx) =>
      (tx as any).salesOrder.create({
        data: {
          tenantId, landingPageId: pageId, customerName: 'Status Buyer', phone: '0555565656',
          wilaya: 'Alger', baladia: 'Centre', address: '', quantity: 1,
          productPrice: 2500, shippingPrice: 400, totalPrice: 2900,
        },
        select: { id: true },
      }),
    )).id;

    const confirm = await api(`/api/builder/orders/${orderId}/status`, ownerToken, {
      method: 'PATCH', body: JSON.stringify({ toStatus: 'CONFIRMED' }),
    });
    assert.equal(confirm.status, 200);
    const updated = await waitFor(() =>
      received.find((x) => x.path === '/orders-hook' && x.topic === 'order.updated'));
    assert.equal(JSON.parse(updated.rawBody).data.landingos.status, 'CONFIRMED',
      'the trigger read the COMMITTED status, not the one it raced');

    const cancel = await api(`/api/builder/orders/${orderId}/status`, ownerToken, {
      method: 'PATCH', body: JSON.stringify({ toStatus: 'CANCELLED' }),
    });
    assert.equal(cancel.status, 200);
    const cancelled = await waitFor(() =>
      received.find((x) => x.path === '/orders-hook' && x.topic === 'order.cancelled'));
    assert.equal(JSON.parse(cancelled.rawBody).data.financial_status, 'voided');
  });
});

describe('failure handling and the operator surface', { skip }, () => {
  test('a 4xx receiver is not retried; the log says one attempt, failed', async () => {
    statusByPath['/rejects'] = 422;
    // Subscribed to an event ONLY this test fires (a pricing change), so hits
    // here cannot be another test's page lifecycle events.
    const endpointId = await seedEndpoint('/rejects', ['product.updated']);

    await api(`/api/builder/landings/${pageId}/pricing`, ownerToken, {
      method: 'PATCH', body: JSON.stringify({ price: 2600 }),
    });

    await waitFor(() => {
      const hits = received.filter((x) => x.path === '/rejects');
      return hits.length >= 1 ? hits : undefined;
    });
    // Give a would-be retry time to happen, then assert it did not.
    await new Promise((r) => setTimeout(r, 1500));
    const rejectHits = received.filter((x) => x.path === '/rejects');
    assert.equal(rejectHits.length, 1,
      'a receiver that understood and refused is not hammered with the same body — got ' +
      JSON.stringify(rejectHits.map((x) => ({ topic: x.topic, attempt: x.attempt, rid: x.resourceId }))));

    const deliveries = await api(
      `/api/platform/integrations/webhooks/${endpointId}/deliveries`, ownerToken);
    assert.equal(deliveries.status, 200);
    const entry = deliveries.body.data.items.find((d: any) => d.event === 'product.updated');
    assert.ok(entry, 'the failure is in the log');
    assert.equal(entry.success, false);
    assert.equal(entry.attempts, 1);
    assert.equal(entry.statusCode, 422);
  });

  test('a 5xx receiver is retried to three attempts, and the log records them', async () => {
    statusByPath['/flaky'] = 503;
    const endpointId = await seedEndpoint('/flaky', ['page.unpublished']);

    await api(`/api/builder/landings/${pageId}/publish`, ownerToken, {
      method: 'POST', body: JSON.stringify({ published: false }),
    });

    // Attempts land at ~0s, ~1s, ~5s.
    await waitFor(() => {
      const hits = received.filter((x) => x.path === '/flaky');
      return hits.length >= 3 ? hits : undefined;
    }, 12000);
    const attempts = received.filter((x) => x.path === '/flaky').map((x) => x.attempt);
    assert.deepEqual(attempts, ['1', '2', '3']);

    // The final log row is written just after the last attempt; give it a beat.
    await new Promise((r) => setTimeout(r, 800));
    const log = await api(`/api/platform/integrations/webhooks/${endpointId}/deliveries`, ownerToken);
    const entry = log.body.data.items.find((d: any) => d.event === 'page.unpublished');
    assert.ok(entry);
    assert.equal(entry.attempts, 3);
    assert.equal(entry.success, false);

    // Restore the page to published for any later test.
    await api(`/api/builder/landings/${pageId}/publish`, ownerToken, {
      method: 'POST', body: JSON.stringify({ published: true }),
    });
  });

  test('a redirecting receiver is refused, never followed (SSRF hardening)', async () => {
    // url-guard checks the URL as WRITTEN; following a 302 afterwards would
    // walk the signed payload to an address that never passed the guard. The
    // delivery layer therefore treats every 3xx as a terminal failure.
    statusByPath['/redirects'] = 302;
    const endpointId = await seedEndpoint('/redirects', ['product.updated']);

    await api(`/api/builder/landings/${pageId}/pricing`, ownerToken, {
      method: 'PATCH', body: JSON.stringify({ price: 2700 }),
    });

    await waitFor(() => received.find((x) => x.path === '/redirects'));
    // Give a would-be follow or retry time to happen, then assert neither did.
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(received.filter((x) => x.path === '/redirect-target').length, 0,
      'the Location target was never contacted');
    assert.equal(received.filter((x) => x.path === '/redirects').length, 1,
      'a 3xx is terminal — not retried with the same body');

    const log = await api(`/api/platform/integrations/webhooks/${endpointId}/deliveries`, ownerToken);
    const entry = log.body.data.items.find((d: any) => d.event === 'product.updated');
    assert.ok(entry, 'the refusal is in the delivery log');
    assert.equal(entry.success, false);
    assert.equal(entry.statusCode, 302);
    assert.equal(entry.attempts, 1);

    await withTenant(tenantId, (tx) =>
      (tx as any).webhookEndpoint.deleteMany({ where: { id: endpointId } }));
  });

  test("the console's send-test reports the receiver's answer and logs it", async () => {
    const endpointId = await seedEndpoint('/test-target', []);
    const r = await api(`/api/platform/integrations/webhooks/${endpointId}/test`, ownerToken, {
      method: 'POST',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.ok, true, JSON.stringify(r.body));
    assert.equal(r.body.data.statusCode, 200);

    const hit = received.find((x) => x.path === '/test-target');
    assert.ok(hit, 'the test ping arrived');
    assert.equal(hit.topic, 'test');
    const expected = createHmac('sha256', SECRET).update(hit.rawBody, 'utf8').digest('base64');
    assert.equal(hit.signature, expected, 'even the test ping is signed');

    const log = await api(`/api/platform/integrations/webhooks/${endpointId}/deliveries`, ownerToken);
    assert.ok(log.body.data.items.some((d: any) => d.event === 'test' && d.success));
  });
});
