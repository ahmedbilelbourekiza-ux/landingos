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
});
