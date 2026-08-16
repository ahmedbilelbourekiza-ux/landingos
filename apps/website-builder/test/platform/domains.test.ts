import { test, describe, before, after } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
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
  for (const id of [tenantA, tenantB].filter(Boolean)) {
    await deleteTenant(id).catch(() => {});
  }
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
    // LB.14c — a code per CAUSE, not one code for two. "keep waiting, DNS has
    // not propagated" and "you published the wrong string" are the opposite
    // instruction to the person mid-setup, and the route's own comment calls
    // that distinction essential. It used to arrive as one code, which
    // `action-errors.ts` then had no entry for at all.
    assert.equal(r.body.error.code, 'DNS_NO_RECORD');
    const row = await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.findUnique({ where: { id: domainId }, select: { verifiedAt: true } }),
    );
    assert.equal((row as any).verifiedAt, null, 'a failed lookup must never verify');
  });

  test("every refusal this screen can produce has a message in the reader's language", async () => {
    /* B5 shipped five refusal codes and mapped NONE of them, so a screen where
     * every refusal names something the merchant must go and change in their
     * own DNS zone answered "that didn't work" to all five — measured in the
     * running console before this was fixed. It is the second time this exact
     * shape has been caught; `action-errors.ts` records the first
     * (`UNKNOWN_ADAPTER`, LP.2) directly above the entries added here.
     *
     * Asserted against the module rather than by clicking, so it fails when a
     * SIXTH code is added to these routes and not mapped. */
    const { actionErrors, FALLBACK } = await import('../../src/lib/console/action-errors.ts');
    const messages = actionErrors((key: string) => `T:${key}`);
    for (const code of [
      'DNS_NO_RECORD', 'DNS_TOKEN_MISMATCH', 'INVALID_DOMAIN',
      'DOMAIN_TAKEN', 'DOMAIN_LIMIT', 'NOT_VERIFIED',
    ]) {
      assert.ok(messages[code], `${code} has no message and falls back to "that didn't work"`);
      assert.notEqual(messages[code], messages[FALLBACK], `${code} still shows the generic refusal`);
    }
    // And the two DNS causes must not collapse back into one wording.
    assert.notEqual(messages.DNS_NO_RECORD, messages.DNS_TOKEN_MISMATCH);
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

describe('a verified domain resolves, and only the edge decides which', { skip }, () => {
  /* Host-header control needs node:http — fetch() forbids setting `Host`,
   * which is what made the first manual probe of this silently invalid. */
  function rawGet(path: string, headers: Record<string, string>) {
    return new Promise<{ status: number; location: string; body: string }>((resolve, reject) => {
      const url = new URL(BASE);
      const req = http.request(
        { host: url.hostname, port: url.port || 80, path, method: 'GET', headers },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? '', body }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  let hostname = '';

  before(async () => {
    if (skip) return;
    hostname = `resolve-${stamp}.example.com`;
    const created = await post('/api/platform/domains', tokens.a, { domain: hostname });
    assert.equal(created.status, 201);
  });

  /* THE TWO ASSERTIONS BELOW WERE RE-PINNED AFTER LB.45 (found 16 Aug 2026).
   * They pinned the PRE-rewrite shapes — the root 307ing everything to
   * /console or /<slug> — and were never re-run when LB.45 landed (its deploy
   * record's suite list does not include this file). LB.45's own live
   * verification on selliora1.com recorded the new shapes: a verified
   * domain's root serves the store home DIRECTLY (307 → 200), and an
   * unverified hostname resolves no tenant, so its root is a fail-closed 404
   * — the same answer any unknown tenant gets, and safer than bouncing a
   * half-configured merchant domain to the platform's console door. */
  test('an unverified domain serves nothing, whichever header carries it', async () => {
    // Routed BY the edge (Host): the rewrite makes `/` the domain's own root;
    // no verified row means no tenant, and no tenant is a 404 — never another
    // tenant's storefront, never a platform redirect on a merchant hostname.
    const viaHost = await rawGet('/', { Host: hostname });
    assert.equal(viaHost.status, 404, 'unverified via Host: fail-closed 404');
    // Merely CLAIMED in a forwarded header on a platform request: the claim
    // is ignored and the platform root behaves as itself.
    const viaForwarded = await rawGet('/', { 'X-Forwarded-Host': hostname });
    assert.match(viaForwarded.location, /\/console$/, 'spoofed forward: the platform door');
  });

  test('a verified domain resolves when the EDGE routed by that hostname', async () => {
    // Land verification the way the DNS route's one write would.
    await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.updateMany({
        where: { domain: hostname }, data: { verifiedAt: new Date() },
      }),
    );
    // `Host` is the header the edge validates — an unconfigured hostname never
    // reaches the app (production answers 403 x-render-routing). This is the
    // legitimate custom-domain shape. Since LB.45 the root SERVES the store
    // home directly (200, the domain's own bare shape) rather than 307ing to
    // the platform's /<slug> path — the shape verified live on the first real
    // custom domain the day LB.45 deployed.
    const r = await rawGet('/', { Host: hostname });
    assert.equal(r.status, 200, 'verified + edge-routed: served, not redirected');
    assert.match(
      r.body,
      new RegExp(`data-tenant="dom-a-${stamp}"`),
      'verified + edge-routed: the tenant\'s own storefront',
    );
  });

  test('a CLIENT-supplied X-Forwarded-Host cannot redirect a platform request', async () => {
    /* THE SPOOF, pinned. Measured before the fix: `GET /demo` carrying a
     * victim's verified hostname in X-Forwarded-Host rendered the VICTIM's
     * storefront — one header re-pointed any URL at any tenant. The request
     * arrives AT the platform's own address, so the claim is ignored now. */
    const root = await rawGet('/', { Host: '127.0.0.1:3000', 'X-Forwarded-Host': hostname });
    assert.match(root.location, /\/console$/, 'the platform door, not the tenant');

    // And the sharper half: a real storefront path must keep serving ITS OWN
    // tenant rather than being swapped for the header's.
    const swapped = await rawGet(`/dom-b-${stamp}`, {
      Host: '127.0.0.1:3000',
      'X-Forwarded-Host': hostname,
    });
    assert.equal(swapped.status, 200, "the path's own tenant still resolves");

    // A list-valued header must not let an attacker prepend a hostname.
    const listed = await rawGet('/', {
      Host: '127.0.0.1:3000',
      'X-Forwarded-Host': `${hostname}, 127.0.0.1:3000`,
    });
    assert.match(listed.location, /\/console$/, 'the nearest hop wins, not the injected first entry');
  });
});

describe('the resolution policy does not widen tenant-bound reads', { skip }, () => {
  test("a tenant's own domain list contains only its own rows", async () => {
    /* THE DEFECT THIS PINS, measured on 10 Aug 2026: the first version of
     * `tenant_isolation_verified` was `USING ("verifiedAt" IS NOT NULL)` with
     * no binding guard. Postgres ORs permissive policies, so every verified
     * row joined what EVERY tenant-bound read returned — a tenant owning
     * nothing saw another tenant's hostname, and the console's own domains
     * screen would have listed other companies'. The guard
     * (`app.domain_lookup`, set only by withVerifiedDomains) is what keeps
     * the pre-tenant lookup from being a cross-tenant window. */
    const mine = `owned-${stamp}.example.com`;
    const created = await post('/api/platform/domains', tokens.a, { domain: mine });
    assert.equal(created.status, 201);
    await withTenant(tenantA, (tx) =>
      (tx as any).tenantDomain.updateMany({ where: { domain: mine }, data: { verifiedAt: new Date() } }),
    );

    // Tenant B owns no verified domain. Bound to itself, it must see none of A's.
    const seenByB = await withTenant(tenantB, (tx) =>
      (tx as any).tenantDomain.findMany({ select: { domain: true } }),
    );
    const leaked = (seenByB as any[]).filter((d) => d.domain === mine);
    assert.deepEqual(leaked, [], "another tenant's verified domain must not appear in a bound read");

    // And through the API the console uses, which is the same read.
    const listB = await api('/api/platform/domains', tokens.b);
    assert.equal(listB.status, 200);
    assert.ok(
      !listB.body.data.items.some((d: any) => d.domain === mine),
      "the console's domain list must not show another tenant's hostname",
    );

    // The owner still sees its own — the policy narrowed nothing legitimate.
    const listA = await api('/api/platform/domains', tokens.a);
    assert.ok(listA.body.data.items.some((d: any) => d.domain === mine), 'the owner still sees its own row');
  });
});
