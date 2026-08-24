import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

/* =============================================================================
 * LB.23 — the ad-account intake route and the "Refresh spend" trigger.
 *
 * The intake route is the ONLY way a token gets in, so the assertions that
 * matter are about what it refuses and what it never gives back:
 *   - the token is encrypted at rest and never appears in any response;
 *   - a plaintext token can never end up in the column;
 *   - a tenant cannot see, refresh, or overwrite another tenant's account;
 *   - a role without the permission is refused.
 *
 * The refresh trigger is asserted for its NAMED refusals, not for a successful
 * Meta pull: a green path here would mean either a real credential in a test
 * or a stub of the whole provider, and the pull itself is already pinned by
 * ads-spend.test.ts against the pure wire layer.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);

const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);

const skip = !HAS_DB || !serverUp;

const stamp = Date.now();
const userIds: string[] = [];
const tokens: Record<string, string> = {};
let tenantA = '';
let tenantB = '';
let tenantB2 = '';
let accountA = '';
let accountB = '';

const ACCOUNT_ID = '730934849575452';
const FAKE_TOKEN = 'EAAtestonly' + 'y'.repeat(60);

async function api(path: string, token?: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, raw: text };
}

async function makeTenant(slug: string) {
  const t = await asPlatform().tenant.create({ data: { slug, name: slug } });
  await withTenant(t.id, (tx) =>
    (tx as any).subscription.create({
      data: { tenantId: t.id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
    }),
  );
  return t.id;
}

async function makeUser(tenantId: string, role: string, label: string) {
  const email = `ads-${label}-${stamp}@landingos.test`;
  const u = await asPlatform().user.create({
    data: { email, name: email, passwordHash: await hashPassword('x') },
  });
  userIds.push(u.id);
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({ data: { tenantId, userId: u.id, role } }),
  );
  const { token } = await createSession(u.id, tenantId);
  tokens[label] = token;
}

before(async () => {
  if (skip) return;
  tenantA = await makeTenant(`ads-a-${stamp}`);
  tenantB = await makeTenant(`ads-b-${stamp}`);
  await makeUser(tenantA, 'OWNER', 'ownerA');
  await makeUser(tenantA, 'VIEWER', 'viewerA');
  await makeUser(tenantA, 'MANAGER', 'managerA');
  await makeUser(tenantB, 'OWNER', 'ownerB');
  tenantB2 = await makeTenant(`ads-c-${stamp}`);
  await makeUser(tenantB2, 'OWNER', 'ownerB2');
});

after(async () => {
  if (skip) return;
  for (const id of userIds) {
    await destroySessionsForUser(id);
    for (const t of [tenantA, tenantB, tenantB2]) {
      await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId: id } }));
    }
    await asPlatform().user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [tenantA, tenantB, tenantB2].filter(Boolean)) await deleteTenant(id).catch(() => {});
  await disconnect();
});

describe('ad-account intake — the token goes in and never comes back', { skip }, () => {
  test('creating an account with a token returns it MASKED, never in the clear', async () => {
    const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: ACCOUNT_ID, name: 'Atlas Accounts 6',
        currency: 'USD', accessToken: FAKE_TOKEN,
      }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    accountA = r.body.data.id;
    assert.equal(r.body.data.accessToken, '••••••••');
    assert.ok(!r.raw.includes(FAKE_TOKEN), 'the token must not appear anywhere in the response');
  });

  test('it is ENCRYPTED at rest — not the plaintext token', async () => {
    const row = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: accountA }, select: { accessToken: true } }),
    );
    assert.notEqual(row.accessToken, FAKE_TOKEN, 'not plaintext at rest');
    assert.match(row.accessToken, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
  });

  test('the list masks it too, and the key never reaches the wire', async () => {
    const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerA);
    assert.equal(r.status, 200);
    const mine = r.body.data.items.find((i: any) => i.id === accountA);
    assert.equal(mine.accessToken, '••••••••');
    assert.ok(!r.raw.includes(FAKE_TOKEN));
  });

  test('re-saving WITHOUT a token keeps the stored one — an edit must not disconnect', async () => {
    const before = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: accountA }, select: { accessToken: true } }),
    );
    const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: ACCOUNT_ID, name: 'Renamed', currency: 'USD',
      }),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: accountA }, select: { accessToken: true, name: true } }),
    );
    assert.equal(after.accessToken, before.accessToken, 'token untouched by a label edit');
    assert.equal(after.name, 'Renamed');
  });

  test('the act_ prefix is REFUSED, not silently stripped', async () => {
    // Accepting both shapes would make the unique key stop meaning one account.
    const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: `act_${ACCOUNT_ID}`, name: 'x', currency: 'USD',
      }),
    });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
  });

  test('a non-currency-code and a too-short token are refused', async () => {
    for (const body of [
      { provider: 'meta', accountId: '999999999', name: 'x', currency: 'dollars' },
      { provider: 'meta', accountId: '999999999', name: 'x', currency: 'USD', accessToken: 'short' },
    ]) {
      const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerA, {
        method: 'POST', body: JSON.stringify(body),
      });
      assert.equal(r.status, 422, JSON.stringify(body));
    }
  });

  test('SEC.9 — token edge shapes are refused, and NO refusal echoes the credential', async () => {
    /* The three edges the review names: empty (must not silently clear or
     * store), whitespace-only (trims to empty), and over the 500-char cap.
     * Whatever the refusal, the submitted secret must not ride back out in
     * the error envelope — a validator that quotes its input would put a
     * mistyped-but-real token into logs and screens. */
    const tokenBefore = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: accountA }, select: { accessToken: true } }),
    );
    for (const accessToken of ['', ' '.repeat(40), 'E'.repeat(501)]) {
      const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerA, {
        method: 'POST',
        body: JSON.stringify({
          provider: 'meta', accountId: ACCOUNT_ID, name: 'Renamed', currency: 'USD', accessToken,
        }),
      });
      assert.equal(r.status, 422, `len ${accessToken.length}: ${JSON.stringify(r.body).slice(0, 200)}`);
      if (accessToken.trim()) {
        assert.ok(!r.raw.includes(accessToken), 'the refusal must not reflect the credential');
      }
    }
    const tokenAfter = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: accountA }, select: { accessToken: true } }),
    );
    assert.equal(tokenAfter.accessToken, tokenBefore.accessToken, 'a refused submit changes nothing at rest');
  });
});

describe('ad-account intake — the boundaries', { skip }, () => {
  test('a VIEWER cannot manage integrations', async () => {
    const r = await api('/api/platform/integrations/ad-accounts', tokens.viewerA, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: '111111111', name: 'x', currency: 'USD', accessToken: FAKE_TOKEN,
      }),
    });
    assert.equal(r.status, 403, JSON.stringify(r.body));
  });

  test('SEC.9 — a MANAGER cannot either: manage is not in the write glob', async () => {
    /* `platform:integrations:manage` matches neither `*:*:write` nor
     * `*:*:publish`, so the day-to-day tier stops short of the credential —
     * pinned here because the ROLE that most plausibly gets handed around is
     * exactly the one that must not be able to swap where ad spend reads
     * from. The read half (the masked list) is deliberately still theirs. */
    const write = await api('/api/platform/integrations/ad-accounts', tokens.managerA, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: '111111112', name: 'x', currency: 'USD', accessToken: FAKE_TOKEN,
      }),
    });
    assert.equal(write.status, 403, JSON.stringify(write.body));
    const refresh = await api(`/api/platform/integrations/ad-accounts/${accountA}/refresh`, tokens.managerA, {
      method: 'POST', body: JSON.stringify({ days: 7 }),
    });
    assert.equal(refresh.status, 403, JSON.stringify(refresh.body));
    const read = await api('/api/platform/integrations/ad-accounts', tokens.managerA);
    assert.equal(read.status, 200);
  });

  test('signed out is 401, not 403 — different questions, different answers', async () => {
    const r = await api('/api/platform/integrations/ad-accounts', undefined);
    assert.equal(r.status, 401);
  });

  test('another tenant cannot SEE this account', async () => {
    const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerB);
    assert.equal(r.status, 200);
    assert.ok(!r.body.data.items.some((i: any) => i.id === accountA), 'tenant B must not see A');
  });

  test('the SAME provider+accountId in another tenant is a SEPARATE row, not an overwrite', async () => {
    // The cross-tenant hazard this design exists to avoid: one operator's
    // credential must never be reachable by another tenant's owner.
    const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerB, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: ACCOUNT_ID, name: 'B copy', currency: 'USD', accessToken: FAKE_TOKEN,
      }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    accountB = r.body.data.id;
    assert.notEqual(accountB, accountA, 'must be its own row');
    const stillA = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: accountA }, select: { name: true } }),
    );
    assert.equal(stillA.name, 'Renamed', "tenant A's row untouched by tenant B");
  });
});

describe('refresh spend — named refusals', { skip }, () => {
  test('an account with NO token answers 409 NO_CREDENTIAL, not a 500 and not a silent zero', async () => {
    const bare = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.create({
        data: {
          tenantId: tenantA, provider: 'meta', accountId: '222222222',
          name: 'no token', currency: 'USD',
        },
        select: { id: true },
      }),
    );
    const r = await api(`/api/platform/integrations/ad-accounts/${bare.id}/refresh`, tokens.ownerA, {
      method: 'POST', body: JSON.stringify({ days: 7 }),
    });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'NO_CREDENTIAL');
  });

  test('another tenant cannot refresh this account — 404, not someone else\'s data', async () => {
    const r = await api(`/api/platform/integrations/ad-accounts/${accountA}/refresh`, tokens.ownerB, {
      method: 'POST', body: JSON.stringify({ days: 7 }),
    });
    assert.equal(r.status, 404, JSON.stringify(r.body));
  });

  test('a VIEWER cannot trigger a refresh', async () => {
    const r = await api(`/api/platform/integrations/ad-accounts/${accountA}/refresh`, tokens.viewerA, {
      method: 'POST', body: JSON.stringify({ days: 7 }),
    });
    assert.equal(r.status, 403);
  });

  test('the window is BOUNDED — an unbounded pull is refused', async () => {
    for (const days of [0, 365, -5]) {
      const r = await api(`/api/platform/integrations/ad-accounts/${accountA}/refresh`, tokens.ownerA, {
        method: 'POST', body: JSON.stringify({ days }),
      });
      assert.equal(r.status, 422, `days=${days}`);
    }
  });
});

/* -----------------------------------------------------------------------------
 * LB.23c — THE GAP THAT SHIPPED, now pinned.
 *
 * LB.23b built the intake route and verified it with direct API calls, and
 * called that "end to end". It was not: no form anywhere in the console called
 * the route, so the panel could say "no advertising account is connected" and
 * offer nothing to fix it. Every route test passed the whole time, because a
 * route test cannot see that nothing reaches the route.
 *
 * These assert REACHABILITY from the rendered screen, which is the property
 * that was actually missing.
 * -------------------------------------------------------------------------- */
describe('the token field is reachable from the screen', { skip }, () => {
  const screen = async (tok: string) => {
    const r = await fetch(BASE + '/console/builder/analytics', {
      headers: { cookie: `${SESSION_COOKIE}=${tok}` },
    });
    return await r.text();
  };

  test('with NO account connected, the screen still offers a way to connect one', async () => {
    // The dead end: "not connected" with no remedy on the page.
    const html = await screen(tokens.ownerB2);
    assert.ok(html.includes('connect-ad-account'), 'the connect form must be on the page');
    assert.ok(html.includes('ad-account-token'), 'the token input must be on the page');
    // And no exit where there is nothing to leave: a disconnect control in the
    // unconfigured state would be a button whose route can only answer 404.
    assert.ok(!html.includes('disconnect-ad-account'), 'nothing to disconnect, no disconnect control');
  });

  test('SEC.9 — a role the intake route refuses is not offered the field at all', async () => {
    /* The reachability rule cuts both ways. The intake and refresh routes are
     * gated on platform:integrations:manage (OWNER/ADMIN by role); the screen
     * is reachable on orders:read. Before this fix a VIEWER was rendered the
     * whole credential form — a token field whose save could only answer 403,
     * LB.23c's dead-control defect with a permission where the form was. */
    const html = await screen(tokens.viewerA);
    assert.ok(!html.includes('connect-ad-account'), 'no credential form for a viewer');
    assert.ok(!html.includes('ad-account-token'), 'no token field for a viewer');
    assert.ok(!html.includes('data-testid="refresh-spend"'), 'no refresh trigger for a viewer');
    // tenantA HAS an account here, so the exit exists — but not for this role.
    assert.ok(!html.includes('disconnect-ad-account'), 'no disconnect control for a viewer');
    // TS.4 — and no empty manage disclosure either: the wrapper is gated
    // with the controls it wraps.
    assert.ok(!html.includes('ad-account-manage'), 'no manage disclosure for a viewer');
  });

  test('a MANAGER is likewise offered none of the manage controls', async () => {
    /* MANAGER holds *:*:write and still fails platform:integrations:manage —
     * exactly the role most likely to be handed this screen day to day, and
     * exactly the one whose disconnect DELETE answers 403 (pinned below). A
     * rendered control here would be the dead-control defect for the third
     * time on one panel. */
    const html = await screen(tokens.managerA);
    assert.ok(!html.includes('connect-ad-account'), 'no credential form for a manager');
    assert.ok(!html.includes('data-testid="refresh-spend"'), 'no refresh trigger for a manager');
    assert.ok(!html.includes('disconnect-ad-account'), 'no disconnect control for a manager');
  });

  test('the token input is a password field, not plain text', async () => {
    const html = await screen(tokens.ownerB2);
    const near = html.slice(Math.max(0, html.indexOf('ad-account-token') - 400),
                            html.indexOf('ad-account-token') + 400);
    assert.match(near, /type="password"/, 'a pasted credential must not be shoulder-surfable');
  });

  test('a stored token is NEVER rendered into the page', async () => {
    await api('/api/platform/integrations/ad-accounts', tokens.ownerB2, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: '333333333', name: 'reachable',
        currency: 'USD', accessToken: FAKE_TOKEN,
      }),
    });
    const html = await screen(tokens.ownerB2);
    assert.ok(!html.includes(FAKE_TOKEN), 'the secret must not reach the HTML');
    assert.ok(html.includes('connect-ad-account'), 'and the form stays available for rotation');
  });

  test('once an account exists, the DISCONNECT control is on the screen for whoever the route admits', async () => {
    /* The deploy pass's finding, pinned the way LB.23c pinned the entrance:
     * SEC.9 shipped `DELETE /ad-accounts/[id]` route-tested and UI-unreachable
     * — a grep for `ad-accounts` found the connect POST and the refresh POST,
     * nothing else. Revoking a credential was still an API act. This asserts
     * the exit is a rendered control, not documentation. */
    const html = await screen(tokens.ownerB2);
    assert.ok(html.includes('data-testid="disconnect-ad-account"'), 'the disconnect button must be on the page');
  });
});

describe('SEC.9 — disconnecting an account (the documented act, now real)', { skip }, () => {
  let doomedId = '';

  test('setup: a connected account with spend history', async () => {
    const r = await api('/api/platform/integrations/ad-accounts', tokens.ownerA, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'meta', accountId: '444444444', name: 'doomed',
        currency: 'USD', accessToken: FAKE_TOKEN,
      }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    doomedId = r.body.data.id;
    await withTenant(tenantA, (tx) =>
      (tx as any).adSpendDaily.create({
        data: {
          tenantId: tenantA, adAccountId: doomedId, date: new Date('2026-08-01T00:00:00Z'),
          spend: '12.34', currency: 'USD', impressions: 10, clicks: 2,
        },
      }),
    );
  });

  test('a VIEWER and a MANAGER cannot disconnect', async () => {
    for (const tok of [tokens.viewerA, tokens.managerA]) {
      const r = await api(`/api/platform/integrations/ad-accounts/${doomedId}`, tok, { method: 'DELETE' });
      assert.equal(r.status, 403, JSON.stringify(r.body));
    }
  });

  test("another tenant's owner gets 404 — the same answer as a nonexistent id, no oracle", async () => {
    const r = await api(`/api/platform/integrations/ad-accounts/${doomedId}`, tokens.ownerB, { method: 'DELETE' });
    assert.equal(r.status, 404, JSON.stringify(r.body));
    const still = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: doomedId }, select: { id: true } }),
    );
    assert.ok(still, 'the row must survive a cross-tenant delete attempt');
  });

  test('the owner disconnects: the credential AND its spend rows are gone', async () => {
    const r = await api(`/api/platform/integrations/ad-accounts/${doomedId}`, tokens.ownerA, { method: 'DELETE' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.findUnique({ where: { id: doomedId }, select: { id: true } }),
    );
    assert.equal(row, null, 'no stored credential survives the disconnect');
    const spend = await withTenant(tenantA, (tx) =>
      (tx as any).adSpendDaily.count({ where: { adAccountId: doomedId } }),
    );
    assert.equal(spend, 0, 'the cascade takes the history with the account, as documented');
  });

  test('deleting it twice is 404, not a second success', async () => {
    const r = await api(`/api/platform/integrations/ad-accounts/${doomedId}`, tokens.ownerA, { method: 'DELETE' });
    assert.equal(r.status, 404);
  });
});

/* -----------------------------------------------------------------------------
 * ME.A — the derived trio (CTR / CPC / CPM) on the rendered screen.
 *
 * Reachability both directions, per the standing lesson: the numbers render in
 * the READY state with exact values from known sums, and none of them render
 * when the window cannot answer (no synced spend).
 * -------------------------------------------------------------------------- */
describe('ME.A — derived ad metrics on the Traffic screen', { skip }, () => {
  const screen = async (tok: string) => {
    const r = await fetch(BASE + '/console/builder/analytics', {
      headers: { cookie: `${SESSION_COOKIE}=${tok}` },
    });
    return await r.text();
  };

  test('a synced window renders CTR, cost per click and CPM with the spend currency', async () => {
    // Make accountA READY: synced, one in-window day with round numbers.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const day = new Date(`${yesterday.toISOString().slice(0, 10)}T00:00:00.000Z`);
    await withTenant(tenantA, async (tx) => {
      await (tx as any).adSpendDaily.create({
        data: {
          tenantId: tenantA, adAccountId: accountA, date: day,
          spend: '12.00', currency: 'USD', impressions: 4000, clicks: 80,
          linkClicks: 60, metaPurchases: 3, metaPurchaseValue: '54.00',
        },
      });
      await (tx as any).adAccount.update({
        where: { id: accountA },
        data: {
          lastSyncedAt: new Date(),
          // ME.B — the window-level reach pair, as the reach call stores it.
          reach: 812, frequency: '1.58', reachDays: 7, reachSyncedAt: new Date(),
        },
      });
    });
    try {
      const html = await screen(tokens.ownerA);
      assert.ok(html.includes('data-testid="analytics-ad-ctr"'), 'CTR must render in the ready state');
      assert.ok(html.includes('2.00%'), 'CTR is 80 of 4000, exactly');
      assert.ok(html.includes('data-testid="analytics-ad-cpc"'));
      assert.ok(html.includes('0.15'), 'CPC is 12.00 / 80, exactly');
      assert.ok(html.includes('data-testid="analytics-ad-cpm"'));
      assert.ok(html.includes('3.00'), 'CPM is 12.00 per 4 thousand, exactly');
      // ME.B — the link pair, exact.
      assert.ok(html.includes('data-testid="analytics-ad-link-clicks"'));
      assert.ok(html.includes('1.50%'), 'link CTR is 60 of 4000, exactly');
      assert.ok(html.includes('0.20'), 'cost per link click is 12.00 / 60, exactly');
      // ME.B — the Meta-reported pair carries its label (D4), and the ROAS is
      // Meta's value over the spend: 54 / 12.
      assert.ok(html.includes('data-testid="analytics-ad-meta-reported"'));
      assert.ok(html.includes('4.50'), 'Meta-reported ROAS is 54.00 / 12.00, exactly');
      // ME.B — reach with its OWN window label, never this view's (D5).
      assert.ok(html.includes('data-testid="analytics-ad-reach"'));
      assert.ok(html.includes('812'));
      assert.ok(html.includes('1.58'));
      // TS.4 — the manage disclosure carries rotate+disconnect for a role
      // the routes admit; the numbers stay outside it.
      assert.ok(html.includes('data-testid="ad-account-manage"'), 'the manage disclosure must render for an owner');
    } finally {
      // Leave the fixture as the earlier describes shaped it: unsynced, no rows.
      await withTenant(tenantA, async (tx) => {
        await (tx as any).adSpendDaily.deleteMany({ where: { adAccountId: accountA } });
        await (tx as any).adAccount.update({
          where: { id: accountA },
          data: { lastSyncedAt: null, reach: null, frequency: null, reachDays: null, reachSyncedAt: null },
        });
      });
    }
  });

  test('with nothing synced, none of the derived figures renders — no 0.00 for an unanswerable ratio', async () => {
    const html = await screen(tokens.ownerA);
    assert.ok(!html.includes('data-testid="analytics-ad-ctr"'));
    assert.ok(!html.includes('data-testid="analytics-ad-cpc"'));
    assert.ok(!html.includes('data-testid="analytics-ad-cpm"'));
    assert.ok(!html.includes('data-testid="analytics-ad-link-clicks"'));
    assert.ok(!html.includes('data-testid="analytics-ad-meta-reported"'));
    assert.ok(!html.includes('data-testid="analytics-ad-reach"'));
  });
});

/* -----------------------------------------------------------------------------
 * ME.B — the sync loop itself, against a local stub standing in for Meta
 * (`cfg.apiBase`, the module's own test seam): the daily upsert carries the
 * new fields, the SECOND (un-incremented) call stores window reach on the
 * ACCOUNT, and a reach failure never fails the spend sync that already
 * happened.
 * -------------------------------------------------------------------------- */
describe('ME.B — syncDailySpend writes the new fields, and reach is best-effort', { skip }, () => {
  test('daily fields land on the row, reach lands on the account, reach failure stays quiet', async () => {
    const { createServer } = await import('node:http');
    const { syncDailySpend } = await import('../src/lib/ads/meta-ads.ts');
    const behaviour = { reachStatus: 200 };
    const stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const url = req.url ?? '';
      if (url.includes('time_increment')) {
        res.end(JSON.stringify({ data: [{
          date_start: '2026-08-20', spend: '9.00', account_currency: 'USD',
          impressions: '3000', clicks: '90', inline_link_clicks: '70',
          actions: [{ action_type: 'purchase', value: '2' }],
          action_values: [{ action_type: 'purchase', value: '31.50' }],
        }] }));
      } else {
        res.statusCode = behaviour.reachStatus;
        res.end(behaviour.reachStatus === 200
          ? JSON.stringify({ data: [{ reach: '640', frequency: '1.31' }] })
          : JSON.stringify({ error: { message: 'stub says no' } }));
      }
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    const apiBase = `http://127.0.0.1:${(stub.address() as any).port}`;

    const acc: any = await withTenant(tenantA, (tx) =>
      (tx as any).adAccount.create({
        data: { tenantId: tenantA, provider: 'meta', accountId: '777777777', name: 'sync stub', currency: 'USD' },
        select: { id: true },
      }),
    );
    try {
      const first = await syncDailySpend(tenantA, acc.id, { token: 'tkn', accountId: '777777777', apiBase }, { since: '2026-08-14', until: '2026-08-20' });
      assert.equal(first.ok, true, JSON.stringify(first));
      const row: any = await withTenant(tenantA, (tx) =>
        (tx as any).adSpendDaily.findFirst({ where: { adAccountId: acc.id } }),
      );
      assert.equal(row.linkClicks, 70);
      assert.equal(row.metaPurchases, 2);
      assert.equal(row.metaPurchaseValue.toString(), '31.5');
      const account: any = await withTenant(tenantA, (tx) =>
        (tx as any).adAccount.findUnique({ where: { id: acc.id }, select: { reach: true, frequency: true, reachDays: true, reachSyncedAt: true } }),
      );
      assert.equal(account.reach, 640);
      assert.equal(account.frequency.toString(), '1.31');
      assert.equal(account.reachDays, 7, 'the reach window carries ITS OWN length');
      assert.ok(account.reachSyncedAt);

      // A reach failure must not fail the sync, and must not clobber the
      // last honest reach.
      behaviour.reachStatus = 500;
      const second = await syncDailySpend(tenantA, acc.id, { token: 'tkn', accountId: '777777777', apiBase }, { since: '2026-08-14', until: '2026-08-20' });
      assert.equal(second.ok, true, 'the spend sync succeeded; reach is best-effort');
      const after: any = await withTenant(tenantA, (tx) =>
        (tx as any).adAccount.findUnique({ where: { id: acc.id }, select: { reach: true } }),
      );
      assert.equal(after.reach, 640, 'the previous window\'s reach survives a failed refresh');
    } finally {
      await withTenant(tenantA, async (tx) => {
        await (tx as any).adSpendDaily.deleteMany({ where: { adAccountId: acc.id } });
        await (tx as any).adAccount.delete({ where: { id: acc.id } });
      });
      await new Promise<void>((r) => stub.close(() => r()));
    }
  });
});
