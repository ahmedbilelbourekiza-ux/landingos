import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

/* =============================================================================
 * Custom domains — B5 (CAPABILITY_AUDIT), over HTTP.
 *
 * The property under test is the one the schema comment states: ownership is
 * proven by publishing the token in DNS BEFORE the domain serves anything.
 * Nothing in these tests can publish real DNS, so the POSITIVE verification
 * path is untestable here by construction (the same honest class as real
 * carrier endpoints); what IS pinned is everything that must refuse —
 * invalid hostnames, the platform's own surfaces, another tenant's claim,
 * verification without the record, primary before verification, and the
 * SENSITIVE permission gate.
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
const post = (p: string, t: string, data?: unknown) =>
  api(p, t, { method: 'POST', body: JSON.stringify(data ?? {}) });

async function makeUser(email: string, tenantId: string, role: string) {
  const u = await asPlatform().user.create({
    data: { email, name: email, passwordHash: await hashPassword('x') },
  });
  userIds.push(u.id);
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({ data: { tenantId, userId: u.id, role } }),
  );
  return (await createSession(u.id, tenantId)).token;
}

before(async () => {
  if (skip) return;
  for (const [key, slug] of [['a', `dom-a-${stamp}`], ['b', `dom-b-${stamp}`]] as const) {
    const t = await asPlatform().tenant.create({ data: { slug, name: slug } });
    await withTenant(t.id, (tx) =>
      (tx as any).subscription.create({
        data: { tenantId: t.id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      }),
    );
    if (key === 'a') tenantA = t.id; else tenantB = t.id;
    tokens[key] = await makeUser(`dom-${key}-${stamp}@landingos.test`, t.id, 'OWNER');
  }
  tokens.manager = await makeUser(`dom-mgr-${stamp}@landingos.test`, tenantA, 'MANAGER');
});

after(async () => {
  if (skip) return;
  for (const id of userIds) {
    await destroySessionsForUser(id);
    for (const t of [tenantA, tenantB].filter(Boolean)) {
      await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId: id } }));
    }
    await asPlatform().user.delete({ where: { id } }).catch(() => {});
  }
  await asPlatform().tenant.deleteMany({ where: { id: { in: [tenantA, tenantB].filter(Boolean) } } });
  await disconnect();
});

describe('claiming a hostname', { skip }, () => {
  test('an owner links a domain and receives an unguessable token', async () => {
    const r = await post('/api/platform/domains', tokens.a, { domain: `Shop.Example-${stamp}.com.` });
    assert.equal(r.status, 201);
    // Normalised: lowercased, trailing dot gone.
    assert.equal(r.body.data.domain, `shop.example-${stamp}.com`);
    assert.match(r.body.data.verificationToken, /^landingos-verify=[0-9a-f]{32}$/);
  });

  test("the platform's own surfaces and junk are never claimable", async () => {
    for (const bad of ['landingos.onrender.com', 'anything.onrender.com', 'localhost',
      'x.localhost', 'no-dots', 'ex ample.com', 'http://example.com/path']) {
      const r = await post('/api/platform/domains', tokens.a, { domain: bad });
      assert.equal(r.status, 422, `${bad} must be refused`);
      assert.equal(r.body.error.code, 'INVALID_DOMAIN');
    }
  });

  test("a hostname one tenant holds cannot be claimed by another", async () => {
    const r = await post('/api/platform/domains', tokens.b, { domain: `shop.example-${stamp}.com` });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'DOMAIN_TAKEN');
  });

  test('a MANAGER reaches neither the API (403) nor the screen (404)', async () => {
    const viaApi = await api('/api/platform/domains', tokens.manager);
    assert.equal(viaApi.status, 403);
    const viaScreen = await fetch(`${BASE}/console/settings/domains`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.manager}` },
      redirect: 'manual',
    });
    assert.equal(viaScreen.status, 404);
  });
});

describe('verification is the gate', { skip }, () => {
  let domainId = '';

  before(async () => {
    if (skip) return;
    const rows = await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.findMany({ select: { id: true } }),
    );
    domainId = (rows as any)[0].id;
  });

  test('verifying without the DNS record fails and writes nothing', async () => {
    const r = await post(`/api/platform/domains/${domainId}/verify`, tokens.a);
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'VERIFICATION_FAILED');
    const row = await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.findUnique({ where: { id: domainId }, select: { verifiedAt: true } }),
    );
    assert.equal((row as any).verifiedAt, null, 'a failed lookup must never verify');
  });

  test('an unverified domain cannot become primary', async () => {
    const r = await api(`/api/platform/domains/${domainId}`, tokens.a, { method: 'PATCH' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'NOT_VERIFIED');
  });

  test("another tenant's domain id answers 404 for verify and delete", async () => {
    for (const attempt of [
      post(`/api/platform/domains/${domainId}/verify`, tokens.b),
      api(`/api/platform/domains/${domainId}`, tokens.b, { method: 'DELETE' }),
    ]) {
      assert.equal((await attempt).status, 404);
    }
  });

  test('once verified (arranged as the DNS path would land it), primary works and is exclusive', async () => {
    // The positive DNS lookup is untestable here; land its one write the way
    // the route would, then prove what follows it.
    await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.updateMany({ where: { id: domainId }, data: { verifiedAt: new Date() } }),
    );
    const second = await post('/api/platform/domains', tokens.a, { domain: `alt.example-${stamp}.com` });
    assert.equal(second.status, 201);
    await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.updateMany({
        where: { id: second.body.data.id }, data: { verifiedAt: new Date(), isPrimary: true },
      }),
    );

    const r = await api(`/api/platform/domains/${domainId}`, tokens.a, { method: 'PATCH' });
    assert.equal(r.status, 200);
    const rows = await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.findMany({ select: { id: true, isPrimary: true } }),
    );
    const primaries = (rows as any).filter((x: any) => x.isPrimary);
    assert.equal(primaries.length, 1, 'primary is exclusive');
    assert.equal(primaries[0].id, domainId);
  });

  test('the screen renders the manager UI for an owner', async () => {
    const r = await fetch(`${BASE}/console/settings/domains`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.a}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="domains-manager"/);
  });
});

describe('a verified domain resolves; an unverified one serves nothing', { skip }, () => {
  test('resolution over real HTTP flips on verifiedAt and nothing else', async () => {
    // The defect this pins: TenantDomain's plain tenant policy blanked the
    // UNBOUND read tenantByDomain performs, so even a VERIFIED domain fell
    // through to the platform door. The `tenant_isolation_verified` policy
    // (apply-rls) opens exactly the rows whose facts are public anyway.
    const hostname = `resolve-${stamp}.example.com`;
    const created = await post('/api/platform/domains', tokens.a, { domain: hostname });
    assert.equal(created.status, 201);

    // `x-forwarded-host` is currentHost()'s FIRST branch — the header the
    // production proxy sets. (fetch refuses to send a bare `Host`.)
    const probe = async () => {
      const r = await fetch(`${BASE}/`, {
        headers: { 'x-forwarded-host': hostname },
        redirect: 'manual',
      });
      return r.headers.get('location') ?? '';
    };

    assert.match(await probe(), /\/console$/, 'unverified: the platform door, never a storefront');

    // Land verification the way the DNS route's one write would.
    await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.updateMany({
        where: { domain: hostname }, data: { verifiedAt: new Date() },
      }),
    );
    assert.match(
      await probe(),
      new RegExp(`/dom-a-${stamp}$`),
      'verified: the same request now lands on the tenant storefront',
    );
  });
});
