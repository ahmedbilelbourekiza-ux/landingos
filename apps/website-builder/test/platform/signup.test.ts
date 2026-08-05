import assert from 'node:assert/strict';
import { after, describe } from 'node:test';

import { asPlatform, withTenant } from '@landingos/db';
import { SESSION_COOKIE } from '@landingos/auth';

import {
  BASE,
  anon,
  cleanup,
  contractTest,
  uid,
} from '../erp/helpers.ts';

/* =============================================================================
 * Self-serve signup — Phase 7.3. The contract for `POST /api/platform/signup`.
 *
 * This is the FIRST public, unauthenticated write path on the platform. Every
 * prior write is session-gated; this one creates a Tenant, a User, a Membership
 * and a Subscription from a signed-out visitor, because that is what "sign up"
 * means. The token/cookie it returns lands the new owner in their console.
 *
 * The hard part is R-08: `Tenant.slug` is a public-namespace unique that appears
 * in every storefront URL. A reserved-word list already guards the READ path
 * (`isReservedSlug` in resolve-tenant.ts); this slice enforces it at CREATION,
 * so a customer cannot claim `api`, `console`, `login`, `_next`, … and shadow
 * the platform for everybody.
 *
 * The tests attack every boundary in NEXT_STEPS §7.3: reserved slug, bad shape,
 * slug collision, email collision, weak password, and the happy path that
 * creates four rows and lands the caller signed in.
 * ========================================================================== */

after(cleanup);

/** POST a signup body. Returns the parsed envelope. */
async function signup(body: unknown) {
  const res = await fetch(`${BASE}/api/platform/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}

const slug = () => `signup-${uid()}`;
const email = (s: string) => `owner-${s}@landingos.test`;

describe('self-serve signup', () => {
  contractTest('a valid signup creates a tenant, an owner, a membership and a trial subscription', async () => {
    const s = slug();
    const res = await signup({
      slug: s,
      companyName: 'Signup Co',
      name: 'Test Owner',
      email: email(s),
      password: 'devpassword123',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.tenantSlug, s);
    assert.equal(res.body.data.role, 'OWNER');

    // The four rows exist.
    const tenant = await asPlatform().tenant.findUnique({ where: { slug: s } });
    assert.ok(tenant, 'tenant created');
    const user = await asPlatform().user.findUnique({ where: { email: email(s) } });
    assert.ok(user, 'user created');

    const membership = await withTenant(tenant!.id, (tx) =>
      (tx as any).membership.findFirst({ where: { userId: user!.id } }),
    );
    assert.equal(membership?.role, 'OWNER');

    const subscription = await withTenant(tenant!.id, (tx) =>
      (tx as any).subscription.findFirst(),
    );
    assert.equal(subscription?.status, 'TRIALING');
    // Both products on trial — a trial that shows an empty console teaches nothing.
    assert.ok(subscription?.entitlements.includes('product.erp'));
    assert.ok(subscription?.entitlements.includes('product.website-builder'));
  });

  contractTest('the new owner is signed in — the response sets a session cookie', async () => {
    const s = slug();
    const res = await signup({
      slug: s,
      companyName: 'Cookie Co',
      name: 'Cookie Owner',
      email: email(s),
      password: 'devpassword123',
    });
    assert.equal(res.status, 201);
    // A session cookie is set; using it reaches the console's API.
    const setCookie = res.headers.get('set-cookie') ?? '';
    const token = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    assert.ok(token, 'a session cookie was set');

    const me = await fetch(`${BASE}/api/platform/team/members`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    assert.equal(me.status, 200);
    const body = await me.json();
    // The owner is the sole member.
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].role, 'OWNER');
  });

  contractTest('a reserved slug is refused — a customer cannot shadow the platform (R-08)', async () => {
    // Only slugs that would ALSO pass the kebab shape reach the reserved check
    // (`_next` fails the pattern first, which is still a refusal — just with
    // INVALID_INPUT). Each here is a valid-shape slug the platform must keep.
    for (const reserved of ['api', 'console', 'login', 'signup', 'uploads']) {
      const res = await signup({
        slug: reserved,
        companyName: 'Reserved',
        name: 'Reserved',
        email: email(reserved + uid()),
        password: 'devpassword123',
      });
      assert.equal(res.status, 422, `${reserved} should be refused`);
      assert.equal(res.body.error.code, 'RESERVED_SLUG', `${reserved}: RESERVED_SLUG`);
    }
  });

  contractTest('a slug that is not kebab-case is refused', async () => {
    // UPPER lowercases to a valid slug — so it is NOT refused; test the ones
    // that are genuinely invalid shapes.
    for (const bad of ['with spaces', 'under_score', '1starts-digit', '_next', 'a', '']) {
      const res = await signup({
        slug: bad,
        companyName: 'Bad Slug',
        name: 'Bad',
        email: email(bad || uid()),
        password: 'devpassword123',
      });
      assert.equal(res.status, 422, `${JSON.stringify(bad)} should be refused`);
    }
  });

  contractTest('a slug already taken is a 409, not a 404', async () => {
    const s = slug();
    const first = await signup({
      slug: s,
      companyName: 'First',
      name: 'First',
      email: email(s + '-1'),
      password: 'devpassword123',
    });
    assert.equal(first.status, 201);

    // Same slug, different email — the second attempt must name the collision.
    const second = await signup({
      slug: s,
      companyName: 'Second',
      name: 'Second',
      email: email(s + '-2'),
      password: 'devpassword123',
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'SLUG_TAKEN');
  });

  contractTest('an email already registered is a 409', async () => {
    const s1 = slug();
    const sharedEmail = email(uid());
    const first = await signup({
      slug: s1,
      companyName: 'First',
      name: 'First',
      email: sharedEmail,
      password: 'devpassword123',
    });
    assert.equal(first.status, 201);

    // Same email, different slug — one account per email. The consultant case
    // is one person in many companies via Membership, not many accounts.
    const second = await signup({
      slug: slug(),
      companyName: 'Second',
      name: 'Second',
      email: sharedEmail,
      password: 'devpassword123',
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'EMAIL_TAKEN');
  });

  contractTest('a weak password is refused', async () => {
    const s = slug();
    const res = await signup({
      slug: s,
      companyName: 'Weak',
      name: 'Weak',
      email: email(s),
      password: '123',
    });
    assert.equal(res.status, 422);
  });

  contractTest('a missing field is refused', async () => {
    const res = await signup({ slug: slug(), email: email(uid()) });
    assert.equal(res.status, 422);
  });

  contractTest('the slug is lowercased before store', async () => {
    const s = slug().toUpperCase();
    const res = await signup({
      slug: s,
      companyName: 'Case Co',
      name: 'Case',
      email: email(s.toLowerCase()),
      password: 'devpassword123',
    });
    assert.equal(res.status, 201);
    // The storefront resolves by lowercase; the stored slug must match.
    assert.equal(res.body.data.tenantSlug, s.toLowerCase());
  });

  contractTest('a signed-in visitor is not blocked — signup creates a second company', async () => {
    // A signed-in owner can sign up ANOTHER tenant. The new session replaces
    // the old cookie; the person lands in the new company.
    const s1 = slug();
    const first = await signup({
      slug: s1,
      companyName: 'First Co',
      name: 'Dual Owner',
      email: email(s1),
      password: 'devpassword123',
    });
    const token1 = first.headers.get('set-cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];

    const s2 = slug();
    // Use a different email (EMAIL_TAKEN is real), but carry the first cookie.
    const second = await fetch(`${BASE}/api/platform/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token1}` },
      body: JSON.stringify({
        slug: s2,
        companyName: 'Second Co',
        name: 'Dual Owner',
        email: email(s2),
        password: 'devpassword123',
      }),
    });
    assert.equal(second.status, 201);
    // The first company still exists.
    assert.ok(await asPlatform().tenant.findUnique({ where: { slug: s1 } }));
  });
});
