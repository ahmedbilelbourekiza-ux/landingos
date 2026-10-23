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
import {
  phoneCandidates,
  normalizeLocation,
  normalizeName,
  type ServerTrackingEvent,
  type TrackingDestination,
} from '../src/lib/tracking/events.ts';

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

describe('CAPI.1 — city, state and name normalisation (pure)', () => {
  test('locations lose case, spaces, punctuation and accents before hashing', () => {
    assert.equal(normalizeLocation('Bordj Bou Arreridj'), 'bordjbouarreridj');
    assert.equal(normalizeLocation("M'Chedallah"), 'mchedallah');
    assert.equal(normalizeLocation('  Béjaïa '), 'bejaia');
    assert.equal(normalizeLocation('Alger Centre'), 'algercentre');
    assert.equal(normalizeLocation('الجزائر'), 'الجزائر', 'a non-Latin name is kept, never emptied');
  });

  test('names lose punctuation but keep their letters and inner spaces', () => {
    assert.equal(normalizeName("  Karim  O'Brien-Ali "), 'karim obrienali');
    assert.equal(normalizeName('Ben Ali'), 'ben ali');
    assert.equal(normalizeName('محمد أمين'), 'محمد أمين');
  });

  test('the Meta payload carries ct and st as hashes of the normalised values', () => {
    const withPlace: ServerTrackingEvent = {
      ...EVENT,
      customer: { ...EVENT.customer, city: 'Ras El Oued', state: 'Bordj Bou Arreridj' },
    };
    const user = (buildMetaPayload(withPlace, null) as any).data[0].user_data;
    assert.deepEqual(user.ct, [sha('raseloued')]);
    assert.deepEqual(user.st, [sha('bordjbouarreridj')]);
    assert.deepEqual(user.country, [sha('dz')]);
    const without = (buildMetaPayload(EVENT, null) as any).data[0].user_data;
    assert.equal(without.ct, undefined, 'no city → no ct key at all, never a hash of ""');
    assert.equal(without.st, undefined);
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

  test('a number typed on an ARABIC keyboard produces the same candidates', () => {
    // `\d` is ASCII-only, so before digits.ts these stripped to the empty string
    // and phoneCandidates returned [] — the Purchase shipped to Meta with no
    // `ph` match key at all, which is delivered-and-unmatched rather than a
    // visible failure. This platform's customers type on Arabic keyboards.
    assert.deepEqual(
      phoneCandidates('٠٥٥٥١٢٣٤٥٦'),
      ['0555123456', '213555123456'],
      'Arabic-Indic ٠٥٥٥١٢٣٤٥٦ is the same number as 0555123456',
    );
    assert.deepEqual(
      phoneCandidates('۰۵۵۵۱۲۳۴۵۶'),
      ['0555123456', '213555123456'],
      'Eastern Arabic-Indic ۰۵۵۵۱۲۳۴۵۶ too',
    );
    assert.deepEqual(
      phoneCandidates('‏0555123456'),
      ['0555123456', '213555123456'],
      'a leading RTL mark from a paste is not part of the number',
    );
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

/** PX.1 — a page reports ONLY to the pixels ticked on it, so the suite ticks
 * them explicitly: every integration the tenant has (`'all'`), an exact list,
 * or the column's raw value (`null` / `[]`, both meaning NONE). */
async function linkPage(selection: 'all' | string[] | null) {
  await withTenant(tenantId, async (tx) => {
    const ids = selection === 'all'
      ? (await (tx as any).trackingIntegration.findMany({ select: { id: true } })).map((r: any) => r.id)
      : selection;
    await (tx as any).landingPage.update({ where: { id: pageId }, data: { trackingIntegrationIds: ids } });
  });
}

async function integrationId(publicId: string): Promise<string> {
  const row = (await withTenant(tenantId, (tx) =>
    (tx as any).trackingIntegration.findFirst({ where: { publicId }, select: { id: true } }),
  )) as any;
  return row.id;
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
    await linkPage('all'); // PX.1 — only ticked pixels reach the page
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
    // PX.1 — tick them on the page, or the Purchase goes to nobody.
    await linkPage('all');

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

  /* SEC.10 — end to end, through the real route, on the real chain shape.
   *
   * Between 21 and 23 Aug every Purchase reaching Meta carried `10.203.4.17`-
   * shaped junk as `client_ip_address`, because the route read the LAST
   * forwarded hop and that hop is Render's own router. This drives the actual
   * three-hop production shape at the HTTP boundary and reads what the stub
   * was handed.
   *
   * The suite mirrors the SERVER's `TRUST_CLOUDFLARE_CLIENT_IP`, the same way
   * outbound-guard mirrors `OUTBOUND_PRIVATE_ALLOWLIST`: run the server and
   * the runner with the same value, and both branches below are real. */
  test('SEC.10 — the ad platforms get the CUSTOMER address or none, never a proxy', async () => {
    const flag = process.env.TRUST_CLOUDFLARE_CLIENT_IP;
    const serverTrustsCloudflare = flag === '1' || flag?.toLowerCase() === 'true';
    const customer = '41.100.77.42';

    // (a) The production shape: customer, Cloudflare egress, Render router.
    const viaCloudflare = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'TrackTest/1.0',
        'cf-connecting-ip': customer,
        'x-forwarded-for': `${customer}, 172.71.150.22, 10.203.4.17`,
      },
      body: JSON.stringify({
        landingPageId: pageId, customerName: 'Chain Buyer', phone: '0555987001',
        wilayaId, baladiaName: 'Centre', quantity: 1, shippingMethod: 'HOME',
      }),
    }).then((r) => r.json());
    assert.ok(viaCloudflare.success, JSON.stringify(viaCloudflare));

    const chained = await waitFor(() =>
      hits.find((h) => h.body?.data?.[0]?.event_id === viaCloudflare.data.id && h.path.includes('/999888777666/events')));
    const chainedIp = chained.body.data[0].user_data.client_ip_address;

    assert.notEqual(chainedIp, '10.203.4.17', 'THE BUG: our own router must never be reported as the customer');
    assert.notEqual(chainedIp, '172.71.150.22', "and neither may Cloudflare's egress");
    if (serverTrustsCloudflare) {
      assert.equal(chainedIp, customer, 'behind Cloudflare the real customer is known and sent');
    } else {
      assert.equal(chainedIp, undefined, 'unconfigured, the field is omitted rather than guessed');
    }

    // (b) The single-proxy shape: whoever the edge saw IS the end user, and
    //     that address must reach the platforms under either configuration.
    const direct = '41.100.88.51';
    const single = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': direct },
      body: JSON.stringify({
        landingPageId: pageId, customerName: 'Direct Buyer', phone: '0555987002',
        wilayaId, baladiaName: 'Centre', quantity: 1, shippingMethod: 'HOME',
      }),
    }).then((r) => r.json());
    assert.ok(single.success, JSON.stringify(single));

    const solo = await waitFor(() =>
      hits.find((h) => h.body?.data?.[0]?.event_id === single.data.id && h.path.includes('/999888777666/events')));
    assert.equal(solo.body.data[0].user_data.client_ip_address, direct);

    // TikTok reads the same context through its own field name, so a fix that
    // only reached Meta would show up here.
    const tt = await waitFor(() =>
      hits.find((h) => h.body?.data?.[0]?.event_id === single.data.id && h.path.includes('/event/track')));
    assert.equal(tt.body.data[0].user.ip, direct);
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

/* ========================================================================== */
/* CAPI.1 — the funnel relay, city/state on Purchase, and test events.        */
/* ========================================================================== */

describe('CAPI.1 — server copies of the funnel and the test-events button', { skip: skip || !stub }, () => {
  const relay = (body: Record<string, unknown>) =>
    fetch(`${BASE}/api/storefront/${slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'RelayTest/1.0' },
      body: JSON.stringify(body),
    });

  test('Purchase carries the commune and wilaya as hashed ct / st', async () => {
    const w = (await withTenant(tenantId, (tx) =>
      (tx as any).wilaya.findUnique({ where: { id: wilayaId }, select: { name: true } }),
    )) as any;
    const checkout = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        landingPageId: pageId, customerName: 'Place Buyer', phone: '0555444333',
        wilayaId, baladiaName: "Sidi M'Hamed", quantity: 1, shippingMethod: 'HOME',
      }),
    }).then((r) => r.json());
    assert.ok(checkout.success, JSON.stringify(checkout));
    const meta = await waitFor(() =>
      hits.find((h) => h.path.includes('/999888777666/events') && h.body?.data?.[0]?.event_id === checkout.data.id));
    assert.deepEqual(meta.body.data[0].user_data.ct, [sha('sidimhamed')]);
    assert.deepEqual(meta.body.data[0].user_data.st, [sha(normalizeLocation(w.name))]);
  });

  test('a relayed AddToCart reaches Meta and TikTok with the browser id, priced from the page row', async () => {
    const eventId = `atc-${stamp}-relay01`;
    const res = await relay({
      name: 'AddToCart', eventId, landingPageId: pageId, quantity: 2,
      fbp: 'fb.1.1700.browser', fbc: 'fb.1.1700.relayclick',
      // Not in the contract: a client cannot price its own event.
      value: 1, currency: 'USD',
    });
    assert.equal(res.status, 204);

    const meta = await waitFor(() =>
      hits.find((h) => h.path.includes('/999888777666/events') && h.body?.data?.[0]?.event_id === eventId));
    const d = meta.body.data[0];
    assert.equal(d.event_name, 'AddToCart');
    assert.equal(d.custom_data.value, '5000', '2 x the page price 2500, from the database');
    assert.equal(d.custom_data.currency, 'DZD');
    assert.equal(d.custom_data.num_items, 2);
    assert.equal(d.user_data.fbp, 'fb.1.1700.browser');
    assert.equal(d.user_data.fbc, 'fb.1.1700.relayclick');
    assert.equal(d.user_data.client_user_agent, 'RelayTest/1.0');
    assert.equal(d.event_source_url, `${BASE}/${slug}/tracked-product`);

    const tiktok = await waitFor(() =>
      hits.find((h) => h.path.includes('/event/track') && h.body?.data?.[0]?.event_id === eventId));
    assert.equal(tiktok.body.data[0].event, 'AddToCart');

    // GA4 has no dedup key for this event: the relay must not send it there.
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(
      !hits.some((h) => h.path.includes('/mp/collect') && h.body?.events?.[0]?.name === 'add_to_cart'),
      'no add_to_cart reached GA4 — the browser already counted it once',
    );
  });

  test('the relay refuses Purchase, junk ids and unknown pages — silently', async () => {
    const ids = [`pur-${stamp}-relay02`, 'short', `unk-${stamp}-relay03`];
    assert.equal((await relay({ name: 'Purchase', eventId: ids[0], landingPageId: pageId })).status, 204);
    assert.equal((await relay({ name: 'ViewContent', eventId: ids[1], landingPageId: pageId })).status, 204);
    assert.equal((await relay({ name: 'ViewContent', eventId: ids[2], landingPageId: 'no-such-page' })).status, 204);
    await new Promise((r) => setTimeout(r, 1500));
    for (const id of ids) {
      assert.ok(
        !hits.some((h) => h.body?.data?.[0]?.event_id === id),
        `${id} was not dispatched`,
      );
    }
  });

  test('a page pixel selection decides who gets the server copy — per brand', async () => {
    const metaRow = (await withTenant(tenantId, (tx) =>
      (tx as any).trackingIntegration.findFirst({ where: { publicId: '999888777666' }, select: { id: true } }),
    )) as any;
    await withTenant(tenantId, (tx) =>
      (tx as any).landingPage.update({ where: { id: pageId }, data: { trackingIntegrationIds: [metaRow.id] } }),
    );
    try {
      const eventId = `vc-${stamp}-scoped01`;
      assert.equal((await relay({ name: 'ViewContent', eventId, landingPageId: pageId })).status, 204);
      await waitFor(() =>
        hits.find((h) => h.path.includes('/999888777666/events') && h.body?.data?.[0]?.event_id === eventId));
      await new Promise((r) => setTimeout(r, 1500));
      const others = hits.filter((h) =>
        h.body?.data?.[0]?.event_id === eventId && !h.path.includes('/999888777666/events'));
      assert.equal(others.length, 0, 'the unselected Meta pixel and TikTok got nothing');
    } finally {
      await withTenant(tenantId, (tx) =>
        (tx as any).landingPage.update({ where: { id: pageId }, data: { trackingIntegrationIds: null } }),
      );
      await linkPage('all');
    }
  });

  test('Send test event goes out with the saved test code and answers with the Meta reply', async () => {
    const main = (await withTenant(tenantId, (tx) =>
      (tx as any).trackingIntegration.findFirst({ where: { publicId: '111222333444' }, select: { id: true } }),
    )) as any;
    const r = await api(`/api/platform/integrations/tracking/${main.id}/test`, ownerToken, {
      method: 'POST',
      body: JSON.stringify({ eventName: 'InitiateCheckout' }),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.testCode, 'TEST99');
    const hit = await waitFor(() =>
      hits.find((h) => h.path.includes('/111222333444/events') && h.body?.data?.[0]?.event_id === r.body.data.eventId));
    assert.equal(hit.body.test_event_code, 'TEST99');
    assert.equal(hit.body.data[0].event_name, 'InitiateCheckout');
    assert.deepEqual(hit.body.data[0].user_data.st, [sha('alger')], 'test data exercises the location keys');
    assert.ok(hit.path.includes('access_token=EAAB-secret-token'), 'the stored token is decrypted for the call');
    assert.ok(!JSON.stringify(r.body).includes('EAAB-secret-token'), 'the reply never echoes the token');
  });

  test('without a test code, or for a non-Meta row, the test send refuses by name', async () => {
    const rows = (await withTenant(tenantId, (tx) =>
      (tx as any).trackingIntegration.findMany({
        where: { publicId: { in: ['999888777666', 'TTPIXCODE99'] } },
        select: { id: true, provider: true },
      }),
    )) as any[];
    const meta = rows.find((x) => x.provider === 'meta');
    const tiktok = rows.find((x) => x.provider === 'tiktok');
    const noCode = await api(`/api/platform/integrations/tracking/${meta.id}/test`, ownerToken, {
      method: 'POST', body: '{}',
    });
    assert.equal(noCode.status, 422);
    assert.equal(noCode.body.error.code, 'NO_TEST_CODE');
    const tt = await api(`/api/platform/integrations/tracking/${tiktok.id}/test`, ownerToken, {
      method: 'POST', body: '{}',
    });
    assert.equal(tt.status, 422);
    assert.equal(tt.body.error.code, 'TEST_UNSUPPORTED');
  });
});

/* ========================================================================== */
/* PX.1 — Purchase and Lead reach ONLY the pixels ticked on the page.          */
/* ========================================================================== */

describe('PX.1 — Purchase and Lead go only to the page\u2019s own pixels', { skip: skip || !stub }, () => {
  const checkoutOnce = async (phone: string) => {
    const r = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        landingPageId: pageId, customerName: 'Scoped Buyer', phone,
        wilayaId, baladiaName: 'Centre', quantity: 1, shippingMethod: 'HOME',
      }),
    }).then((x) => x.json());
    assert.ok(r.success, JSON.stringify(r));
    return r.data.id as string;
  };
  const leadOnce = async (tag: string, phone: string) => {
    const token = `tok-${stamp}-${tag}`;
    await fetch(`${BASE}/api/storefront/${slug}/draft-orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, landingPageId: pageId, customerName: `Lead ${tag}`, phone }),
    });
    // The Lead's event id is the draft row's id; find it to match hits.
    const row = (await withTenant(tenantId, (tx) =>
      (tx as any).draftOrder.findUnique({ where: { token }, select: { id: true } }),
    )) as any;
    return row.id as string;
  };
  const hitsFor = (eventId: string) => hits.filter((h) =>
    h.body?.data?.[0]?.event_id === eventId ||
    h.body?.events?.[0]?.params?.transaction_id === eventId ||
    // GA4 carries a Lead's id only inside its derived client id.
    h.body?.client_id === `landingos.${eventId}`);
  const settle = () => new Promise((r) => setTimeout(r, 2000));

  after(async () => { if (!skip) await linkPage('all'); });

  test('a page with ONE ticked pixel sends Purchase and Lead to that pixel only', async () => {
    const chosen = await integrationId('999888777666');
    await linkPage([chosen]);

    const orderId = await checkoutOnce('0555700001');
    await waitFor(() =>
      hits.find((h) => h.path.includes('/999888777666/events') && h.body?.data?.[0]?.event_id === orderId));
    const leadId = await leadOnce('px1-one', '0555700002');
    await waitFor(() =>
      hits.find((h) => h.path.includes('/999888777666/events') && h.body?.data?.[0]?.event_id === leadId));
    await settle();

    for (const id of [orderId, leadId]) {
      const elsewhere = hitsFor(id).filter((h) => !h.path.includes('/999888777666/events'));
      assert.equal(elsewhere.length, 0,
        `${id} also reached ${elsewhere.map((h) => h.path.split('?')[0]).join(', ')} — another pixel in the store`);
    }
  });

  for (const [label, selection] of [['no selection (NULL)', null], ['an empty selection', []]] as const) {
    test(`a page with ${label} sends Purchase and Lead to NO pixel`, async () => {
      await linkPage(selection as null | string[]);
      const tag = selection === null ? 'null' : 'empty';
      const orderId = await checkoutOnce(selection === null ? '0555700003' : '0555700005');
      const leadId = await leadOnce(`px1-${tag}`, selection === null ? '0555700004' : '0555700006');
      await settle();
      assert.equal(hitsFor(orderId).length, 0, 'the Purchase reached a pixel the page did not tick');
      assert.equal(hitsFor(leadId).length, 0, 'the Lead reached a pixel the page did not tick');
    });
  }

  test('the thank-you page fires only the ordered page\u2019s pixels; the store home fires none', async () => {
    const chosen = await integrationId('999888777666');
    await linkPage([chosen]);
    const orderId = await checkoutOnce('0555700007');

    const thanks = await fetch(`${BASE}/${slug}/thank-you/${orderId}`).then((x) => x.text());
    assert.match(thanks, /999888777666/, 'the ticked pixel is missing from the thank-you page');
    assert.ok(!thanks.includes('111222333444'), 'an unticked Meta pixel fires the browser Purchase');
    assert.ok(!thanks.includes('TTPIXCODE99'), 'an unticked TikTok pixel fires the browser Purchase');

    await linkPage(null);
    const none = await fetch(`${BASE}/${slug}/thank-you/${orderId}`).then((x) => x.text());
    for (const id of ['999888777666', '111222333444', 'TTPIXCODE99', 'G-TESTID99']) {
      assert.ok(!none.includes(id), `${id} fires on the thank-you page of a page with nothing ticked`);
    }

    const home = await fetch(`${BASE}/${slug}`).then((x) => x.text());
    for (const id of ['999888777666', '111222333444', 'TTPIXCODE99', 'G-TESTID99', 'GTM-ABC1234']) {
      assert.ok(!home.includes(id), `${id} fires on the store home — no page selected it`);
    }
  });
});
