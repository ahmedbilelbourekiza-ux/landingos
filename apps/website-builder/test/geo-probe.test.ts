import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, deleteTenant, disconnect } from '@landingos/db';

import {
  snapshotGeoHeaders,
  probeKey,
  mergeProbe,
  GEO_PROBE_MAX_KEYS,
  GEO_PROBE_PRODUCT,
  GEO_PROBE_KEY,
} from '../src/lib/storefront/geo-probe.ts';

/* =============================================================================
 * GEO.0 — the Cloudflare geo-header measurement.
 *
 * The probe writes to production, so its discipline is tested like a
 * feature's: it must never store an IP, never store city/postal/coordinate
 * VALUES, never grow without bound, never record an unattested request, and
 * never break a beacon. The e2e half needs the server started with
 * TRUST_CLOUDFLARE_CLIENT_IP=1 (as production runs) — without it the trust
 * gate correctly refuses everything and the recording tests self-skip.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;
const stamp = Date.now();

const bag = (h: Record<string, string>) => ({
  headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
});

describe('snapshotGeoHeaders (pure)', () => {
  test('captures the three decision fields and presence-only for the rest', () => {
    const s = snapshotGeoHeaders(bag({
      'cf-ipcountry': 'DZ',
      'cf-region-code': '16',
      'cf-region': 'Algiers',
      'cf-ipcity': 'Algiers',
      'cf-postal-code': '16000',
      'cf-iplatitude': '36.75',
      'cf-iplongitude': '3.04',
      'cf-timezone': 'Africa/Algiers',
    }));
    assert.deepEqual(s, {
      country: 'DZ', regionCode: '16', region: 'Algiers',
      hasCity: true, hasPostal: true, hasLatLon: true, hasTimezone: true,
    });
    // The VALUES of city, postal and coordinates appear nowhere in the
    // snapshot — presence booleans are all the decision needs.
    assert.equal(JSON.stringify(s).includes('16000'), false);
    assert.equal(JSON.stringify(s).includes('36.75'), false);
  });

  test('absent headers are null and false, never empty strings', () => {
    const s = snapshotGeoHeaders(bag({}));
    assert.deepEqual(s, {
      country: null, regionCode: null, region: null,
      hasCity: false, hasPostal: false, hasLatLon: false, hasTimezone: false,
    });
    assert.equal(probeKey(s), '-|-|-');
  });

  test('hostile values are bounded and cannot smuggle the key separator', () => {
    const s = snapshotGeoHeaders(bag({
      'cf-ipcountry': 'DZ|evil',
      'cf-region': 'x'.repeat(500),
    }));
    assert.equal(s.country, 'DZ_evil');
    assert.equal(s.region!.length <= 40, true);
    assert.equal(probeKey(s).split('|').length, 3, 'exactly two separators, always');
  });

  test('latitude without longitude does not count as a coordinate pair', () => {
    const s = snapshotGeoHeaders(bag({ 'cf-iplatitude': '36.75' }));
    assert.equal(s.hasLatLon, false);
  });
});

describe('mergeProbe (pure)', () => {
  const dz16 = snapshotGeoHeaders(bag({ 'cf-ipcountry': 'DZ', 'cf-region-code': '16', 'cf-region': 'Algiers', 'cf-ipcity': 'Algiers' }));

  test('first observation initialises; repeats increment the same key', () => {
    const t0 = '2026-09-05T00:00:00.000Z';
    const one = mergeProbe(null, dz16, t0);
    assert.equal(one.total, 1);
    assert.deepEqual(one.counts, { 'DZ|16|Algiers': 1 });
    assert.equal(one.presence.city, 1);
    assert.equal(one.firstAt, t0);

    const two = mergeProbe(one, dz16, '2026-09-05T01:00:00.000Z');
    assert.equal(two.total, 2);
    assert.equal(two.counts['DZ|16|Algiers'], 2);
    assert.equal(two.firstAt, t0, 'firstAt never moves');
    assert.equal(two.lastAt, '2026-09-05T01:00:00.000Z');
  });

  test('a garbage stored value degrades to a fresh counter, never a throw', () => {
    const v = mergeProbe('junk', dz16, '2026-09-05T00:00:00.000Z');
    assert.equal(v.total, 1);
  });

  test(`the row is bounded: past ${GEO_PROBE_MAX_KEYS} distinct keys, overflow counts instead`, () => {
    let v: unknown = null;
    for (let i = 0; i < GEO_PROBE_MAX_KEYS + 5; i += 1) {
      v = mergeProbe(v, snapshotGeoHeaders(bag({ 'cf-ipcountry': `C${i}` })), '2026-09-05T00:00:00.000Z');
    }
    const out = v as ReturnType<typeof mergeProbe>;
    assert.equal(Object.keys(out.counts).length, GEO_PROBE_MAX_KEYS);
    assert.equal(out.overflow, 5);
    assert.equal(out.total, GEO_PROBE_MAX_KEYS + 5);
  });
});

/* ---------------------------------------------------------------------------
 * END-TO-END — the beacon route records attested requests, and only those.
 * ------------------------------------------------------------------------ */

describe('the visits beacon feeds the probe (end to end)', { skip }, () => {
  let tenantId = '';
  let slug = '';

  const beacon = (headers: Record<string, string>, body?: Record<string, unknown>) =>
    fetch(`${BASE}/api/storefront/${slug}/visits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        token: `geo-tok-${stamp}-${Math.floor(Math.random() * 1e9)}`,
        pageKind: 'home',
        viewId: `geo-view-${stamp}-${Math.floor(Math.random() * 1e9)}`,
        deviceClass: 'mobile',
        ...body,
      }),
    });

  const probeRow = (): Promise<{ value: unknown } | null> =>
    withTenant(tenantId, (tx) =>
      (tx as any).productSetting.findFirst({
        where: { product: GEO_PROBE_PRODUCT, key: GEO_PROBE_KEY },
        select: { value: true },
      }),
    );

  const settle = () => new Promise((r) => setTimeout(r, 1200)); // fire-and-forget lands

  before(async () => {
    if (skip) return;
    slug = `geo0-${stamp}`;
    const t = await asPlatform().tenant.create({ data: { slug, name: 'GEO0 probe' } });
    tenantId = t.id;
    await withTenant(tenantId, (tx) =>
      (tx as any).subscription.create({
        data: { tenantId, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      }),
    );
  });

  after(async () => {
    if (skip) return;
    if (tenantId) await deleteTenant(tenantId);
    await disconnect();
  });

  test('an unattested beacon (no cf-connecting-ip) is counted as a visit but never probed', async () => {
    const res = await beacon({});
    assert.equal(res.status, 204);
    await settle();
    assert.equal(await probeRow(), null, 'no trust, no observation');
    const visits = await withTenant(tenantId, (tx) => (tx as any).storefrontVisit.count());
    assert.equal(visits, 1, 'the beacon itself is untouched by the probe');
  });

  test('a Cloudflare-attested beacon records the header snapshot — and no IP', async function (t) {
    const trusted = String(process.env.TRUST_CLOUDFLARE_CLIENT_IP ?? '') === '1';
    if (!trusted) {
      // The suite cannot see the SERVER's env; probe a request and skip
      // honestly if the trust gate is closed on this harness.
      await beacon({ 'cf-connecting-ip': '41.111.5.9', 'cf-ipcountry': 'DZ' });
      await settle();
      if ((await probeRow()) === null) {
        t.skip('server not started with TRUST_CLOUDFLARE_CLIENT_IP=1');
        return;
      }
    }
    const res = await beacon({
      'cf-connecting-ip': '41.111.5.9',
      'cf-ipcountry': 'DZ',
      'cf-region-code': '16',
      'cf-region': 'Algiers',
      'cf-ipcity': 'Algiers',
      'cf-iplatitude': '36.75',
      'cf-iplongitude': '3.04',
    });
    assert.equal(res.status, 204);
    await settle();
    const row = await probeRow();
    assert.ok(row, 'the probe row exists');
    const value = row.value as any;
    assert.ok(value.counts['DZ|16|Algiers'] >= 1, JSON.stringify(value));
    assert.ok(value.presence.city >= 1);
    assert.ok(value.presence.latlon >= 1);
    // The discipline the whole design rests on: the IP is nowhere in the row.
    assert.equal(JSON.stringify(value).includes('41.111'), false, 'no IP, ever');
    assert.equal(JSON.stringify(value).includes('36.75'), false, 'no coordinates, ever');
  });

  test('repeat observations increment; a header-less attested request lands in the dash bucket', async function (t) {
    const before = await probeRow();
    if (!before) {
      t.skip('trust gate closed on this harness');
      return;
    }
    const total0 = (before.value as any).total as number;
    await beacon({ 'cf-connecting-ip': '41.111.5.9' });
    await settle();
    const after1 = (await probeRow())!.value as any;
    assert.equal(after1.total, total0 + 1);
    assert.ok(after1.counts['-|-|-'] >= 1, 'absence is a countable answer, not a dropped one');
  });
});
