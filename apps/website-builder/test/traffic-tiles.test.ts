import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, deleteTenant, disconnect } from '@landingos/db';
import { createSession, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import {
  TILE_KEYS,
  COLOURABLE,
  DEFAULT_TILE_PREFERENCES,
  parseTilePreferences,
  validateTilePreferences,
  mergeTilePreferences,
  clearedThresholdKeys,
  isColourable,
} from '../src/lib/builder/traffic-tiles.ts';

/* =============================================================================
 * TR.2 — configurable tiles.
 *
 * PURE — the catalogue is closed, the read path degrades, the write path
 * refuses. END-TO-END — the route is gated on settings:write, persists one
 * ProductSetting row, and the Traffic screen honours a hidden tile.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;
const stamp = Date.now();

describe('the catalogue (pure)', () => {
  test('every colourable tile is in the catalogue and carries a direction', () => {
    for (const key of Object.keys(COLOURABLE)) {
      assert.ok((TILE_KEYS as readonly string[]).includes(key), `${key} must be a real tile`);
    }
    assert.equal(isColourable('adCostPerOrder'), true);
    assert.equal(isColourable('adSpend'), false, 'a money total has no "good"');
    assert.equal(isColourable('views'), false, 'a count has no "good"');
    assert.equal(COLOURABLE.adCpc?.higherIsBetter, false, 'a cost reads downwards');
    assert.equal(COLOURABLE.conversion?.higherIsBetter, true);
  });
});

describe('parseTilePreferences (the READ path degrades)', () => {
  test('garbage becomes the defaults, never a throw', () => {
    assert.deepEqual(parseTilePreferences(null), DEFAULT_TILE_PREFERENCES);
    assert.deepEqual(parseTilePreferences('x'), DEFAULT_TILE_PREFERENCES);
    assert.deepEqual(parseTilePreferences({ hidden: 'views' }), { hidden: [], thresholds: {} });
  });

  test('unknown tiles and non-colourable thresholds are DROPPED on read', () => {
    const p = parseTilePreferences({
      hidden: ['views', 'gone-tile', 'views'],
      thresholds: {
        adCpc: { bad: 30, almostBad: 20, almostGood: 10 },
        adSpend: { bad: 1, almostBad: 2, almostGood: 3 },   // not colourable
        adCtr: { bad: 3, almostBad: 2, almostGood: 1 },     // wrong direction
      },
    });
    assert.deepEqual(p.hidden, ['views'], 'deduplicated and filtered');
    assert.deepEqual(Object.keys(p.thresholds), ['adCpc']);
  });
});

describe('validateTilePreferences (the WRITE path refuses)', () => {
  test('a clean body passes whole', () => {
    const { clean, errors } = validateTilePreferences({
      hidden: ['adImpressions'],
      thresholds: { adCostPerOrder: { bad: 1500, almostBad: 1200, almostGood: 900 } },
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(clean?.hidden, ['adImpressions']);
    assert.deepEqual(clean?.thresholds.adCostPerOrder, { bad: 1500, almostBad: 1200, almostGood: 900 });
  });

  test('an unknown tile is a 422, not a silent drop', () => {
    const { clean, errors } = validateTilePreferences({ hidden: ['views', 'nope'] });
    assert.equal(clean, null);
    assert.match(errors[0]!, /unknown tile: nope/);
  });

  test('a threshold on a count is refused with the reason', () => {
    const { errors } = validateTilePreferences({ thresholds: { views: { bad: 1, almostBad: 2, almostGood: 3 } } });
    assert.match(errors[0]!, /no benchmark direction/);
  });

  test('cut points in the wrong direction are refused with the direction named', () => {
    const up = validateTilePreferences({ thresholds: { adCtr: { bad: 3, almostBad: 2, almostGood: 1 } } });
    assert.match(up.errors[0]!, /must rise/);
    const down = validateTilePreferences({ thresholds: { adCpc: { bad: 1, almostBad: 2, almostGood: 3 } } });
    assert.match(down.errors[0]!, /must fall/);
  });

  test('one bad key refuses the WHOLE batch', () => {
    const { clean } = validateTilePreferences({
      hidden: ['views'],
      thresholds: { adCpc: { bad: 'x', almostBad: 2, almostGood: 1 } },
    });
    assert.equal(clean, null, 'the good hidden list must not be applied either');
  });

  test('null clears a threshold', () => {
    const body = { thresholds: { adCpc: null } };
    const { clean, errors } = validateTilePreferences(body);
    assert.deepEqual(errors, []);
    assert.deepEqual(clean?.thresholds, {});
    assert.deepEqual(clearedThresholdKeys(body), ['adCpc']);
  });
});

describe('mergeTilePreferences', () => {
  test('hidden replaces, thresholds merge, null clears', () => {
    const stored = {
      hidden: ['views' as const],
      thresholds: {
        adCpc: { bad: 30, almostBad: 20, almostGood: 10 },
        adCpm: { bad: 5, almostBad: 4, almostGood: 3 },
      },
    };
    const merged = mergeTilePreferences(
      stored,
      { hidden: ['orders'], thresholds: { adCtr: { bad: 1, almostBad: 2, almostGood: 3 } } },
      ['adCpm'],
    );
    assert.deepEqual(merged.hidden, ['orders'], 'the form sends the whole list');
    assert.deepEqual(Object.keys(merged.thresholds).sort(), ['adCpc', 'adCtr']);
  });
});

/* ---------------------------------------------------------------------------
 * END-TO-END
 * ------------------------------------------------------------------------ */

describe('PUT /api/builder/analytics/tiles (end to end)', { skip }, () => {
  let tenantId = '';
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};

  async function makeUser(role: string, label: string) {
    const email = `tr2-${label}-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email, name: email, passwordHash: await hashPassword('x') },
    });
    userIds.push(u.id);
    await withTenant(tenantId, (tx) =>
      (tx as any).membership.create({ data: { tenantId, userId: u.id, role, permissions: [] } }),
    );
    const { token } = await createSession(u.id, tenantId);
    tokens[label] = token;
  }

  async function api(method: string, token: string | undefined, body?: unknown) {
    const res = await fetch(BASE + '/api/builder/analytics/tiles', {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }

  async function screen(token: string) {
    const res = await fetch(BASE + '/console/builder/analytics?range=month', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    return res.text();
  }

  before(async () => {
    if (skip) return;
    const t = await asPlatform().tenant.create({ data: { slug: `tr2-${stamp}`, name: 'TR2 Tiles' } });
    tenantId = t.id;
    await withTenant(tenantId, async (tx) => {
      await (tx as any).subscription.create({
        data: { tenantId, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      });
      // A little traffic, so the KPI band and page cards render.
      await (tx as any).storefrontVisit.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          tenantId, landingPageId: null, pageKind: 'home',
          visitorToken: `tr2-v-${stamp}-${i}`, isReturning: false,
          sourceChannel: 'facebook', deviceClass: 'mobile', viewId: `tr2-view-${stamp}-${i}`,
        })),
      });
    });
    await makeUser('OWNER', 'owner');
    await makeUser('VIEWER', 'viewer');
  });

  after(async () => {
    if (skip) return;
    if (tenantId) await deleteTenant(tenantId);
    for (const id of userIds) await asPlatform().user.delete({ where: { id } }).catch(() => {});
    await disconnect();
  });

  test('anonymous is 401; a VIEWER is 403 on the write and may read', async () => {
    assert.equal((await api('PUT', undefined, { hidden: [] })).status, 401);
    assert.equal((await api('PUT', tokens.viewer, { hidden: [] })).status, 403);
    const read = await api('GET', tokens.viewer);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.data, DEFAULT_TILE_PREFERENCES, 'nothing stored yet reads as the defaults');
  });

  test('a bad body is 422 and stores nothing', async () => {
    const res = await api('PUT', tokens.owner, { hidden: ['nope'] });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVALID_TILES');
    const read = await api('GET', tokens.owner);
    assert.deepEqual(read.body.data, DEFAULT_TILE_PREFERENCES);
  });

  test('the owner hides a tile and sets a cost threshold; one ProductSetting row persists it', async () => {
    const res = await api('PUT', tokens.owner, {
      hidden: ['visitors'],
      thresholds: { adCostPerOrder: { bad: 1500, almostBad: 1200, almostGood: 900 } },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.hidden, ['visitors']);
    assert.deepEqual(res.body.data.thresholds.adCostPerOrder, { bad: 1500, almostBad: 1200, almostGood: 900 });

    const rows: any[] = await withTenant(tenantId, (tx) =>
      (tx as any).productSetting.findMany({ where: { product: 'website-builder', key: 'trafficTiles' } }),
    );
    assert.equal(rows.length, 1, 'exactly one row, upserted');

    // The audit trail carries the KEYS, never the values.
    const audit: any = await withTenant(tenantId, (tx) =>
      (tx as any).auditEvent.findFirst({ where: { entity: 'trafficTiles' }, orderBy: { createdAt: 'desc' } }),
    );
    assert.ok(audit, 'an audit row is written');
    assert.deepEqual(audit.payload.hidden, ['visitors']);
    assert.equal(JSON.stringify(audit.payload).includes('1500'), false, 'threshold VALUES stay out of the audit log');
  });

  test('the Traffic screen honours the hidden tile', async () => {
    const html = await screen(tokens.owner);
    assert.ok(html.includes('data-kpi="traffic-views"'), 'views still renders');
    assert.ok(!html.includes('data-kpi="traffic-visitors"'), 'visitors is hidden');
    assert.ok(html.includes('data-testid="tiles-customize"'), 'the customize control is offered to settings:write');
  });

  test('a VIEWER sees the same hidden tiles but no customize control', async () => {
    const html = await screen(tokens.viewer);
    assert.ok(!html.includes('data-kpi="traffic-visitors"'));
    assert.ok(!html.includes('data-testid="tiles-customize"'), 'a control that can only 403 is the dead-control defect');
  });

  test('null clears the threshold; the hidden list is replaced whole', async () => {
    const res = await api('PUT', tokens.owner, { hidden: [], thresholds: { adCostPerOrder: null } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, DEFAULT_TILE_PREFERENCES);
    const html = await screen(tokens.owner);
    assert.ok(html.includes('data-kpi="traffic-visitors"'), 'visitors is back');
  });
});
