import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import { buildMetaPayload } from '../src/lib/tracking/providers/meta.ts';
import { buildTiktokPayload, tiktokEventName } from '../src/lib/tracking/providers/tiktok.ts';
import { buildGa4Payload, ga4EventName } from '../src/lib/tracking/providers/ga4.ts';
import { phoneCandidates, type ServerTrackingEvent, type TrackingDestination } from '../src/lib/tracking/events.ts';

/* =============================================================================
 * The tracking pipeline (LB.5).
 *
 * Two halves, deliberately:
 *
 * PURE — the payload builders, imported directly (the calc.ts pattern). The
 * hashing and field mapping are what an ad platform silently drops events
 * over, so they are asserted without a server in the way.
 *
 * END-TO-END — a real checkout through the running server, with the provider
 * base URLs pointed at a local stub via META_GRAPH_BASE / TIKTOK_API_BASE /
 * GA4_API_BASE. Start the server with those set to
 * `http://127.0.0.1:${TRACKING_STUB_PORT}` (default 48790) or the E2E half
 * skips — the same convention delivery.test.ts uses for ZR, adapted to a
 * port the server has to know at startup.
 * ========================================================================== */

const sha = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

const EVENT: ServerTrackingEvent = {
  name: 'Purchase',
  eventId: 'order_123',
  eventTime: 1700000000,
  value: 5400,
  currency: 'DZD',
  contentId: 'page_1',
  contentName: 'Montre Pro',
  quantity: 2,
  customer: { name: 'Karim Ben Ali', phone: '+213 555-12-34-56' },
  context: {
    ip: '41.100.1.2',
    userAgent: 'UA/1.0',
    fbc: 'fb.1.1700.abc',
    fbp: 'fb.1.1700.999',
    ttclid: 'ttc_abc',
    url: 'https://shop.example/acme/montre',
  },
};

const DEST: TrackingDestination = {
  provider: 'meta',
  publicId: '1234567890',
  serverToken: 'tok',
  testCode: 'TEST123',
  settings: {},
};

describe('meta payload builder (pure)', () => {
  const payload = buildMetaPayload(EVENT, 'TEST123');
  const data = payload.data[0] as any;

  test('advanced matching hashes what must be hashed and passes what must not', () => {
    assert.deepEqual(data.user_data.ph, [sha('213555123456')], 'phone is digits-only then sha256');
    assert.deepEqual(data.user_data.fn, [sha('karim')]);
    assert.deepEqual(data.user_data.ln, [sha('ben ali')]);
    assert.deepEqual(data.user_data.country, [sha('dz')]);
    assert.equal(data.user_data.fbc, 'fb.1.1700.abc', 'click ids travel unhashed per spec');
    assert.equal(data.user_data.client_ip_address, '41.100.1.2');
  });

  test('the dedup key, source url and test code survive', () => {
    assert.equal(data.event_id, 'order_123');
    assert.equal(data.event_name, 'Purchase');
    assert.equal(data.event_source_url, 'https://shop.example/acme/montre');
    assert.equal(payload.test_event_code, 'TEST123');
    assert.equal(data.custom_data.value, '5400');
    assert.deepEqual(data.custom_data.content_ids, ['page_1']);
  });
});

describe('phone match candidates (pure)', () => {
  test('an Algerian local number gains its E.164 candidate; anything else stays raw', () => {
    // Meta and TikTok match on country-coded digits; a hash of `0555…` matches
    // nothing on either platform (readiness audit). The checkout is
    // wilaya-addressed Algeria, so the 213 candidate is a fact of the market.
    assert.deepEqual(phoneCandidates('0555 12-34-56'), ['0555123456', '213555123456']);
    assert.deepEqual(phoneCandidates('+213 555-12-34-56'), ['213555123456']);
    assert.deepEqual(phoneCandidates('12345'), ['12345'], 'a non-local shape is left alone');
    assert.deepEqual(phoneCandidates(''), []);
  });

  test('meta sends every candidate hash; tiktok sends the most specific one', () => {
    const local: ServerTrackingEvent = { ...EVENT, customer: { name: 'Karim Ben Ali', phone: '0555123456' } };
    const meta = buildMetaPayload(local, null) as any;
    assert.deepEqual(meta.data[0].user_data.ph, [sha('0555123456'), sha('213555123456')],
      'ph is an array — Meta accepts several candidates and matches on any');
    const tiktok = buildTiktokPayload(local, { ...DEST, provider: 'tiktok' }) as any;
    assert.equal(tiktok.data[0].user.phone, sha('213555123456'),
      'TikTok takes one value: the E.164 candidate');
  });
});

describe('tiktok payload builder (pure)', () => {
  test('names map onto TikTok vocabulary; custom names pass through', () => {
    assert.equal(tiktokEventName('Purchase'), 'PlaceAnOrder');
    assert.equal(tiktokEventName('Lead'), 'SubmitForm');
    assert.equal(tiktokEventName('MyCustomThing'), 'MyCustomThing');
  });

  test('the event carries the pixel code, hashed phone and dedup id', () => {
    const payload = buildTiktokPayload(EVENT, { ...DEST, provider: 'tiktok', publicId: 'PIXCODE1234' }) as any;
    assert.equal(payload.event_source_id, 'PIXCODE1234');
    assert.equal(payload.test_event_code, 'TEST123');
    const d = payload.data[0];
    assert.equal(d.event, 'PlaceAnOrder');
    assert.equal(d.event_id, 'order_123');
    assert.equal(d.user.phone, sha('213555123456'));
    assert.equal(d.user.ttclid, 'ttc_abc');
    assert.equal(d.properties.value, 5400);
  });
});

describe('ga4 payload builder (pure)', () => {
  test('names map to snake_case; a purchase carries its transaction_id', () => {
    assert.equal(ga4EventName('Purchase'), 'purchase');
    assert.equal(ga4EventName('InitiateCheckout'), 'begin_checkout');
    const payload = buildGa4Payload(EVENT) as any;
    assert.equal(payload.events[0].name, 'purchase');
    assert.equal(payload.events[0].params.transaction_id, 'order_123');
    assert.equal(payload.events[0].params.items[0].item_id, 'page_1');
  });

  test('a missing ga client id degrades to a stable derived one, never a drop', () => {
    const payload = buildGa4Payload({ ...EVENT, context: { ...EVENT.context, gaClientId: null } }) as any;
    assert.equal(payload.client_id, 'landingos.order_123');
    const withId = buildGa4Payload({ ...EVENT, context: { ...EVENT.context, gaClientId: '555.666' } }) as any;
    assert.equal(withId.client_id, '555.666');
  });
});

/* ========================================================================== */
/* End-to-end through the running server.                                     */
/* ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const STUB_PORT = Number(process.env.TRACKING_STUB_PORT ?? 48790);
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();
const slug = `track-${stamp}`;
let tenantId = '';
let ownerId = '';
let ownerToken = '';
let pageId = '';
let wilayaId = 0;
let stub: Server | null = null;

interface Hit { path: string; headers: Record<string, string | string[] | undefined>; body: any }
const hits: Hit[] = [];

async function waitFor<T>(probe: () => T | undefined, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for tracking delivery');
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

before(async () => {
  if (skip) return;

  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body: any = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      hits.push({ path: req.url ?? '', headers: req.headers, body });
      res.statusCode = 200;
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    stub!.once('error', reject);
    stub!.listen(STUB_PORT, '127.0.0.1', resolve);
  }).catch(() => { stub = null; });

  const t = await asPlatform().tenant.create({ data: { slug, name: 'Tracked Shop' } });
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
      data: { tenantId, title: 'Tracked Product', slug: 'tracked-product', price: 2500, published: true, status: 'PUBLISHED' },
      select: { id: true },
    });
    pageId = page.id;
  });

  const email = `track-${stamp}@landingos.test`;
  const u = await asPlatform().user.create({ data: { email, name: email, passwordHash: await hashPassword('x') } });
  ownerId = u.id;
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } }),
  );
  ownerToken = (await createSession(u.id, tenantId)).token;
});

after(async () => {
  if (skip) return;
  if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()));
  await destroySessionsForUser(ownerId).catch(() => {});
  await withTenant(tenantId, (tx) => (tx as any).membership.deleteMany({ where: { userId: ownerId } })).catch(() => {});
  await asPlatform().user.delete({ where: { id: ownerId } }).catch(() => {});
  await deleteTenant(tenantId).catch(() => {});
  await disconnect();
});

describe('the tracking configuration surface', { skip }, () => {
  test('a created integration stores its credential encrypted and masks it in every response', async () => {
    const r = await api('/api/platform/integrations/tracking', ownerToken, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', label: 'Main pixel', publicId: '111222333444',
        serverToken: 'EAAB-secret-token', testCode: 'TEST99',
      }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.serverToken, '••••••••');

    const row = await withTenant(tenantId, (tx) =>
      (tx as any).trackingIntegration.findFirst({ where: { label: 'Main pixel' }, select: { serverToken: true } }),
    );
    assert.notEqual(row.serverToken, 'EAAB-secret-token', 'not plaintext at rest');
    assert.match(row.serverToken, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);

    const list = await api('/api/platform/integrations/tracking', ownerToken);
    assert.ok(!JSON.stringify(list.body).includes('EAAB-secret-token'), 'the list never echoes a credential');
  });

  test('a public id is validated for ITS provider, refused by name otherwise', async () => {
    const bad = await api('/api/platform/integrations/tracking', ownerToken, {
      method: 'POST',
      body: JSON.stringify({ provider: 'ga4', label: 'Bad', publicId: '123456' }),
    });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.code, 'INVALID_PUBLIC_ID');

    const ads = await api('/api/platform/integrations/tracking', ownerToken, {
      method: 'POST',
      body: JSON.stringify({ provider: 'google-ads', label: 'Ads', publicId: 'AW-12345678' }),
    });
    assert.equal(ads.status, 422);
    assert.equal(ads.body.error.code, 'MISSING_SETTING', 'google-ads needs its conversion label');
  });

  test('the storefront config exposes public ids and NEVER server credentials', async () => {
    await api('/api/platform/integrations/tracking', ownerToken, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'gtm', label: 'Container', publicId: 'GTM-ABC1234',
      }),
    });

    const r = await fetch(`${BASE}/api/storefront/${slug}/tracking`).then((x) => x.json());
    assert.ok(Array.isArray(r.data.items));
    assert.ok(r.data.items.some((i: any) => i.provider === 'gtm' && i.publicId === 'GTM-ABC1234'));
    const raw = JSON.stringify(r);
    assert.ok(!raw.includes('serverToken'), 'the key itself never appears');
    assert.ok(!raw.includes('testCode'));
  });

  test('the storefront page renders the loader for a configured store', async () => {
    const html = await fetch(`${BASE}/${slug}/tracked-product`).then((x) => x.text());
    // The loader is a client component rendering null, so the proof it was
    // mounted is its PROPS in the flight payload: the public container id the
    // layout read server-side. Secrets must be absent from the same payload.
    assert.match(html, /GTM-ABC1234/, 'the layout mounted TrackingScripts with the integration list');
    assert.ok(!/serverToken/.test(html), 'no credential key reaches the page');
  });
});

describe('server-side conversion events reach every configured platform', { skip: skip || !stub }, () => {
  test('a checkout fans Purchase out to Meta, TikTok and GA4 with one dedup id', async () => {
    // Point three integrations at the stub through the env-overridable bases.
    // If the server was not started with the overrides, nothing arrives and
    // this test reports that clearly rather than hanging.
    for (const [provider, publicId, token] of [
      ['meta', '999888777666', 'meta-tok'],
      ['tiktok', 'TTPIXCODE99', 'tiktok-tok'],
      ['ga4', 'G-TESTID99', 'ga4-secret'],
    ] as const) {
      const r = await api('/api/platform/integrations/tracking', ownerToken, {
        method: 'POST',
        body: JSON.stringify({ provider, label: `${provider} e2e`, publicId, serverToken: token }),
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }

    const checkout = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'TrackTest/1.0' },
      body: JSON.stringify({
        landingPageId: pageId, customerName: 'Tracked Buyer', phone: '0555987654',
        wilayaId, baladiaName: 'Centre', quantity: 1, shippingMethod: 'HOME',
        fbc: 'fb.1.1700.clickid', ttclid: 'ttclid_e2e', ttp: 'ttp_e2e', gaClientId: '555.666',
      }),
    }).then((r) => r.json());
    assert.ok(checkout.success, JSON.stringify(checkout));
    const orderId = checkout.data.id;

    let meta: Hit, tiktok: Hit, ga4: Hit;
    try {
      meta = await waitFor(() => hits.find((h) => h.path.includes('/999888777666/events')));
      tiktok = await waitFor(() => hits.find((h) => h.path.includes('/event/track')));
      ga4 = await waitFor(() => hits.find((h) => h.path.includes('/mp/collect')));
    } catch (err) {
      throw new Error(
        'No conversion event arrived. The server must be started with META_GRAPH_BASE, ' +
        `TIKTOK_API_BASE and GA4_API_BASE set to http://127.0.0.1:${STUB_PORT} for this suite. (${err})`,
      );
    }

    // One dedup key everywhere — the property that stops double counting.
    assert.equal(meta.body.data[0].event_id, orderId);
    assert.equal(meta.body.data[0].user_data.fbc, 'fb.1.1700.clickid');
    assert.equal(meta.body.data[0].user_data.client_user_agent, 'TrackTest/1.0');
    assert.ok(meta.path.includes('access_token=meta-tok'));

    // The page URL, rebuilt server-side from the vetted origin + page slug —
    // Meta requires event_source_url for website events (LB.43), and the
    // same value fans out to every provider's own field for it.
    const pageUrl = `${BASE}/${slug}/tracked-product`;
    assert.equal(meta.body.data[0].event_source_url, pageUrl);
    assert.equal(tiktok.body.data[0].page.url, pageUrl);
    assert.equal(ga4.body.events[0].params.page_location, pageUrl);

    assert.equal(tiktok.body.data[0].event_id, orderId);
    assert.equal(tiktok.body.data[0].event, 'PlaceAnOrder');
    assert.equal(tiktok.headers['access-token'], 'tiktok-tok');
    assert.equal(tiktok.body.data[0].user.ttclid, 'ttclid_e2e');
    assert.equal(tiktok.body.data[0].user.ttp, 'ttp_e2e',
      'the _ttp browser id survives the server hop');

    assert.equal(ga4.body.events[0].params.transaction_id, orderId);
    assert.equal(ga4.body.client_id, '555.666',
      'the GA4 event joins the browsing session that produced it');
    assert.ok(ga4.path.includes('measurement_id=G-TESTID99'));
    assert.ok(ga4.path.includes('api_secret=ga4-secret'));
  });

  test('a captured lead fans out as Lead', async () => {
    const token = `tok-${stamp}-tracklead`;
    await fetch(`${BASE}/api/storefront/${slug}/draft-orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, landingPageId: pageId, customerName: 'Lead P', phone: '0555111000' }),
    });

    const meta = await waitFor(() =>
      hits.find((h) => h.path.includes('/999888777666/events') && h.body?.data?.[0]?.event_name === 'Lead'));
    assert.ok(meta, 'the Lead reached Meta');
    assert.equal(meta.body.data[0].event_source_url, `${BASE}/${slug}/tracked-product`,
      'the Lead carries the page URL too — the draft route rebuilds it the same way');
    const tiktok = await waitFor(() =>
      hits.find((h) => h.path.includes('/event/track') && h.body?.data?.[0]?.event === 'SubmitForm'));
    assert.ok(tiktok, 'the Lead reached TikTok as SubmitForm');
  });

  test('the Lead fires on the capture that FIRST carries a phone — usually not the first capture', async () => {
    // The real sequence: the 2s debounce fires after the name field, and the
    // phone arrives in a LATER capture. The old rule (Lead only on
    // draft_order.created) lost every such lead (readiness audit).
    const token = `tok-${stamp}-latephone`;
    const capture = (body: Record<string, unknown>) =>
      fetch(`${BASE}/api/storefront/${slug}/draft-orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, landingPageId: pageId, ...body }),
      });

    const isThisLead = (h: Hit) =>
      h.path.includes('/999888777666/events') &&
      h.body?.data?.[0]?.event_name === 'Lead' &&
      h.body?.data?.[0]?.user_data?.fbc === 'fb.1.1700.leadclick';

    // Capture 1: name only — a draft, not yet a lead.
    await capture({ customerName: 'Late Phone' });
    // Capture 2: the phone arrives, with the click id that produced the visit.
    await capture({ customerName: 'Late Phone', phone: '0555222333', fbc: 'fb.1.1700.leadclick' });

    const lead = await waitFor(() => hits.find(isThisLead));
    assert.ok(lead, 'the phone-carrying capture became a Lead');
    assert.deepEqual(
      lead.body.data[0].user_data.ph,
      [sha('0555222333'), sha('213555222333')],
      'the Lead carries both phone match candidates',
    );

    // Capture 3: the same phone again — an update, never a second Lead.
    await capture({ customerName: 'Late Phone', phone: '0555222333', wilaya: 'Adrar', fbc: 'fb.1.1700.leadclick' });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(hits.filter(isThisLead).length, 1, 'exactly one Lead per visitor');
  });
});
