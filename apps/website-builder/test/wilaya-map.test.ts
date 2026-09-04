import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, deleteTenant, disconnect } from '@landingos/db';
import { createSession, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import { WILAYA_MAP_VIEWBOX, WILAYA_SHAPES } from '../src/lib/builder/algeria-wilaya-map.ts';
import { buildWilayaMapData, rampStrength } from '../src/lib/builder/wilaya-map-data.ts';

/* =============================================================================
 * WM.1 — orders by wilaya.
 *
 * THE ASSET IS DATA, so it gets a contract: the vendored boundary module is
 * regenerated from OpenStreetMap by a script, and these assertions are what
 * stop a bad regeneration (a service hiccup, an upstream edit war, a broken
 * simplification) from shipping a map with holes or a shape the order data
 * cannot reach. The join and the ramp are pure arithmetic; the end-to-end
 * block proves the screen renders real counts onto real shapes.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;
const stamp = Date.now();

describe('the vendored boundary asset', () => {
  test('68 shapes: every wilaya 01–69 except the one OSM has not mapped (63)', () => {
    assert.equal(WILAYA_SHAPES.length, 68);
    const codes = WILAYA_SHAPES.map((s) => Number(s.code)).sort((a, b) => a - b);
    assert.equal(new Set(codes).size, 68, 'codes are unique');
    for (let i = 1; i <= 69; i += 1) {
      if (i === 63) {
        assert.ok(!codes.includes(i), 'El Aricha has no OSM boundary yet — its presence would mean the generator changed');
        continue;
      }
      assert.ok(codes.includes(i), `wilaya ${i} must be present — a hole in the map`);
    }
  });

  test('every shape joins the 58-code vocabulary the order data speaks', () => {
    for (const s of WILAYA_SHAPES) {
      const dc = Number(s.displayCode);
      assert.ok(dc >= 1 && dc <= 58, `${s.code} displays as ${s.displayCode}, outside the reference vocabulary`);
    }
    // The ten post-reform shapes point at their documented, geometry-verified
    // parents — pinned so a regeneration cannot silently reshuffle them.
    const parents = Object.fromEntries(
      WILAYA_SHAPES.filter((s) => Number(s.code) >= 59).map((s) => [s.code, s.displayCode]),
    );
    assert.deepEqual(parents, {
      '59': '03', '60': '05', '61': '07', '62': '12', '64': '14',
      '65': '17', '66': '17', '67': '26', '68': '28', '69': '32',
    });
  });

  test('path data is closed, integer, and inside the viewBox', () => {
    const m = WILAYA_MAP_VIEWBOX.match(/^0 0 (\d+) (\d+)$/);
    assert.ok(m, 'viewBox is origin-anchored');
    const w = Number(m![1]), h = Number(m![2]);
    for (const s of WILAYA_SHAPES) {
      assert.match(s.d, /^M[-\d ]/, `${s.code} starts with a move`);
      assert.match(s.d, /Z$/, `${s.code} is closed`);
      assert.ok(!/[.]/.test(s.d), `${s.code} carries only integer coordinates`);
      // Absolute coordinates appear only after M; check them against the box.
      for (const abs of s.d.matchAll(/M(-?\d+) (-?\d+)/g)) {
        const x = Number(abs[1]), y = Number(abs[2]);
        assert.ok(x >= -1 && x <= w + 1 && y >= -1 && y <= h + 1, `${s.code} M${x} ${y} outside viewBox`);
      }
    }
  });
});

describe('buildWilayaMapData (pure)', () => {
  const REF = [
    { code: '01', name: 'Adrar', nameAr: 'أدرار' },
    { code: '02', name: 'Chlef', nameAr: 'الشلف' },
    { code: '16', name: 'Alger', nameAr: 'الجزائر' },
  ];

  test('joins by exact snapshot name, ranks by count, shares sum from the total', () => {
    const d = buildWilayaMapData(
      [{ wilaya: 'Chlef', count: 1 }, { wilaya: 'Adrar', count: 3 }],
      REF, 'en',
    );
    assert.deepEqual(d.rows.map((r) => [r.code, r.label, r.count, r.sharePercent]), [
      ['01', 'Adrar', 3, 75],
      ['02', 'Chlef', 1, 25],
    ]);
    assert.equal(d.max, 3);
    assert.equal(d.total, 4);
    assert.equal(d.byCode.get('01'), 3);
    assert.deepEqual(d.unmatched, []);
  });

  test('an Arabic console reads Arabic names', () => {
    const d = buildWilayaMapData([{ wilaya: 'Adrar', count: 2 }], REF, 'ar');
    assert.equal(d.rows[0]!.label, 'أدرار');
  });

  test('a name the reference does not know is REPORTED, never guessed onto a shape', () => {
    const d = buildWilayaMapData(
      [{ wilaya: 'Adrar', count: 1 }, { wilaya: 'Aflou', count: 2 }],
      REF, 'en',
    );
    assert.deepEqual(d.unmatched, [{ wilaya: 'Aflou', count: 2 }]);
    assert.equal(d.byCode.has('03'), false, 'no shape colour for an unmatched name');
    // The unmatched orders still count toward the total the shares divide by:
    // hiding them would inflate every other wilaya's share.
    assert.equal(d.total, 3);
    assert.equal(d.rows[0]!.sharePercent, 33);
  });

  test('no orders at all is an empty, safe shape', () => {
    const d = buildWilayaMapData([], REF, 'en');
    assert.deepEqual(d.rows, []);
    assert.equal(d.max, 0);
    assert.equal(d.total, 0);
  });
});

describe('rampStrength', () => {
  test('zero is OFF the ramp, not its bottom', () => {
    assert.equal(rampStrength(0, 10), null);
    assert.equal(rampStrength(5, 0), null);
  });

  test('one order is clearly on the ramp; the max is the darkest', () => {
    assert.equal(rampStrength(1, 10), 29);
    assert.equal(rampStrength(10, 10), 90);
    assert.equal(rampStrength(1, 1), 90, 'a lone wilaya is the maximum of its own window');
  });
});

/* ---------------------------------------------------------------------------
 * END-TO-END
 * ------------------------------------------------------------------------ */

describe('the Traffic screen renders the map (end to end)', { skip }, () => {
  let tenantId = '';
  let pageId = '';
  let token = '';
  let userId = '';

  before(async () => {
    if (skip) return;
    const t = await asPlatform().tenant.create({ data: { slug: `wm1-${stamp}`, name: 'WM1 Map' } });
    tenantId = t.id;
    await withTenant(tenantId, async (tx) => {
      await (tx as any).subscription.create({
        data: { tenantId, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      });
      const page = await (tx as any).landingPage.create({
        data: { tenantId, title: 'خريطة', slug: 'wm1-page', status: 'PUBLISHED', published: true, price: 1000 },
        select: { id: true },
      });
      pageId = page.id;
      // Orders in two wilayas, snapshot names exactly as the checkout writes
      // them (the reference table's French names).
      const order = (wilaya: string, i: number) => ({
        tenantId, landingPageId: pageId,
        customerName: `WM ${i}`, phone: `05550000${i}`, wilaya, baladia: 'Centre',
        address: 'Rue 1', quantity: 1,
        productPrice: '1000', shippingPrice: '400', totalPrice: '1400',
      });
      await (tx as any).salesOrder.createMany({
        data: [order('Adrar', 1), order('Adrar', 2), order('Adrar', 3), order('Chlef', 4)],
      });
    });
    const email = `wm1-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email, name: email, passwordHash: await hashPassword('x') },
    });
    userId = u.id;
    await withTenant(tenantId, (tx) =>
      (tx as any).membership.create({ data: { tenantId, userId: u.id, role: 'OWNER', permissions: [] } }),
    );
    token = (await createSession(u.id, tenantId)).token;
  });

  after(async () => {
    if (skip) return;
    if (tenantId) await deleteTenant(tenantId);
    if (userId) await asPlatform().user.delete({ where: { id: userId } }).catch(() => {});
    await disconnect();
  });

  test('counts land on the right shapes, zero wilayas stay off the ramp, the list ranks', async () => {
    const res = await fetch(BASE + '/console/builder/analytics?range=month', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('data-testid="analytics-wilaya-map"'), 'the section renders');
    assert.ok(html.includes('data-testid="wilaya-map-svg"'));

    // Adrar (01) carries 3, Chlef (02) carries 1, Alger (16) carries none.
    assert.match(html, /data-wilaya="01"[^>]*data-count="3"/);
    assert.match(html, /data-wilaya="02"[^>]*data-count="1"/);
    const alger = html.match(/data-wilaya="16"[^>]*fill="([^"]+)"/);
    assert.ok(alger, 'Alger renders');
    assert.ok(alger![1].includes('--neutral-fg') && !alger![1].includes('--chart-3'), 'a zero wilaya is off the ramp: neutral grey, never the data hue');

    // A post-reform shape inherits its parent's count: Aflou (59) shows
    // Laghouat's zero here, and Barika (60) exists with Batna's code.
    assert.match(html, /data-wilaya="59"[^>]*data-display-code="03"/);
    assert.match(html, /data-wilaya="60"[^>]*data-display-code="05"/);

    // The ranked list: Adrar first with 75%, Chlef second with 25%.
    const rank = html.indexOf('data-testid="wilaya-map-rank"');
    assert.ok(rank > -1);
    const adrAt = html.indexOf('data-wilaya-row="01"');
    const chlAt = html.indexOf('data-wilaya-row="02"');
    assert.ok(adrAt > -1 && chlAt > -1 && adrAt < chlAt, 'largest first');
    assert.ok(html.includes('75%') && html.includes('25%'));

    // The licence credit the vendored boundaries require.
    assert.ok(html.includes('© OpenStreetMap contributors'));
  });
});
