import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, withUser, disconnect } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';
import { productRegistry } from '@landingos/product-registry';

/* =============================================================================
 * The console shell, end to end over HTTP.
 *
 * Asserts the claim Phase 4 exists to make: one shell, and what it shows is
 * decided entirely by what the tenant is entitled to. Nothing here names a
 * route per product — the same request path serves both, and a tenth product
 * would need no new test, only a new manifest.
 *
 * Runs against a server already listening on CONSOLE_URL (default :3000).
 * Skips rather than fails when there is none, so the suite stays runnable
 * without a running app.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);

/* Probed at module load, not in before().
 *
 * Node evaluates a describe's options when the describe is DEFINED, which
 * happens before any before() hook runs — so a `skip` computed from a hook
 * always reads its initial value, and every test silently skips while
 * reporting success. Top-level await is what makes the flag true in time. */
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);

const stamp = Date.now();
const emails = {
  bundle: `shell-bundle-${stamp}@landingos.test`,
  erpOnly: `shell-erp-${stamp}@landingos.test`,
  none: `shell-none-${stamp}@landingos.test`,
};
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
let tenantBundle = '';
let tenantErp = '';
let tenantBare = '';

/** GET a path carrying a session cookie, following no redirects. */
async function get(path: string, token?: string) {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

async function makeTenant(slug: string, name: string, entitlements: string[]) {
  const t = await asPlatform().tenant.create({ data: { slug, name } });
  await withTenant(t.id, async (tx) => {
    await (tx as any).subscription.create({
      data: { tenantId: t.id, status: 'ACTIVE', entitlements },
    });
  });
  return t.id;
}

async function makeUser(email: string, tenantId: string, role: string) {
  const u = await asPlatform().user.create({
    data: { email, name: email, passwordHash: await hashPassword('x') },
  });
  ids[email] = u.id;
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({ data: { tenantId, userId: u.id, role } }),
  );
  const { token } = await createSession(u.id, tenantId);
  tokens[email] = token;
}

before(async () => {
  if (!HAS_DB || !serverUp) return;

  tenantBundle = await makeTenant(`shell-bundle-${stamp}`, 'Bundle Co', [
    'product.website-builder',
    'product.erp',
  ]);
  tenantErp = await makeTenant(`shell-erp-${stamp}`, 'ERP Only Co', ['product.erp']);
  tenantBare = await makeTenant(`shell-bare-${stamp}`, 'Unsubscribed Co', []);

  await makeUser(emails.bundle, tenantBundle, 'OWNER');
  await makeUser(emails.erpOnly, tenantErp, 'ADMIN');
  await makeUser(emails.none, tenantBare, 'OWNER');
});

after(async () => {
  if (!HAS_DB || !serverUp) return;
  for (const id of Object.values(ids)) {
    await destroySessionsForUser(id);
    for (const t of [tenantBundle, tenantErp, tenantBare]) {
      await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId: id } }));
    }
    await asPlatform().user.delete({ where: { id } }).catch(() => {});
  }
  await asPlatform().tenant.deleteMany({
    where: { id: { in: [tenantBundle, tenantErp, tenantBare].filter(Boolean) } },
  });
  await disconnect();
});

const skip = () => !HAS_DB || !serverUp;

describe('the console requires a session', () => {
  test('an anonymous request to a product is sent to sign in', { skip: skip() }, async () => {
    const r = await get('/console/builder');
    assert.equal(r.status, 307);
    assert.match(r.location ?? '', /\/console\/login/);
    // And it remembers where they were going.
    assert.match(r.location ?? '', /next=/);
  });

  test('an anonymous request to the console root is sent to sign in', { skip: skip() }, async () => {
    const r = await get('/console');
    assert.equal(r.status, 307);
    assert.match(r.location ?? '', /\/console\/login/);
  });

  test('a forged session token is not a session', { skip: skip() }, async () => {
    const r = await get('/console', 'clearly-not-a-real-token');
    assert.equal(r.status, 307);
    assert.match(r.location ?? '', /\/console\/login/);
  });

  test('the login "next" parameter never leaves this origin (open redirect)', { skip: skip() }, async () => {
    // A signed-in person following /console/login?next=<absolute URL> was
    // bounced to that URL — a link the platform vouched for landing on an
    // attacker's page (readiness audit). Only a same-origin path survives.
    for (const evil of [
      'https://attacker.example/phish',
      '//attacker.example/phish',
      '/\\attacker.example/phish',
    ]) {
      const r = await get(`/console/login?next=${encodeURIComponent(evil)}`, tokens[emails.bundle]);
      assert.equal(r.status, 307, `still redirects for ${evil}`);
      assert.match(r.location ?? '', /^\/console(?:[/?].*)?$/,
        `${evil} must fall back to /console, got ${r.location}`);
    }

    // The legitimate case keeps working: an internal path passes through.
    const ok = await get('/console/login?next=%2Fconsole%2Fbuilder', tokens[emails.bundle]);
    assert.equal(ok.status, 307);
    assert.equal(ok.location, '/console/builder');
  });
});

describe('the shell shows exactly what the tenant bought', () => {
  test('a bundle tenant sees both products', { skip: skip() }, async () => {
    const r = await get('/console', tokens[emails.bundle]);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-product="website-builder"/);
    assert.match(r.body, /data-product="erp"/);
  });

  test('an ERP-only tenant sees only the ERP', { skip: skip() }, async () => {
    const r = await get('/console/erp', tokens[emails.erpOnly]);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-product="erp"/);
    assert.ok(
      !/data-product="website-builder"/.test(r.body),
      'a product the tenant never bought must not appear in the switcher',
    );
  });

  test('typing the URL of an unbought product gets nothing', { skip: skip() }, async () => {
    // Not seeing the link and not being able to reach it have to be the same
    // decision, or the switcher is decoration.
    const r = await get('/console/builder', tokens[emails.erpOnly]);
    assert.equal(r.status, 404);
  });

  test('a tenant with no subscription reaches no product at all', { skip: skip() }, async () => {
    const console_ = await get('/console', tokens[emails.none]);
    assert.equal(console_.status, 200);
    assert.ok(!/data-product=/.test(console_.body), 'no products should be offered');

    for (const path of ['/console/builder', '/console/erp']) {
      assert.equal((await get(path, tokens[emails.none])).status, 404, `${path} must 404`);
    }
  });

  test('an unregistered product segment is not a page', { skip: skip() }, async () => {
    assert.equal((await get('/console/not-a-product', tokens[emails.bundle])).status, 404);
  });
});

describe('navigation comes from the manifest', () => {
  test("the ERP's nav items render for a permitted user", { skip: skip() }, async () => {
    const r = await get('/console/erp', tokens[emails.bundle]);
    assert.equal(r.status, 200);
    for (const id of ['orders', 'clients', 'products']) {
      assert.match(r.body, new RegExp(`data-nav="${id}"`), `${id} should be in the ERP nav`);
    }
  });

  test('a permission-gated item is absent without the grant', { skip: skip() }, async () => {
    // The ERP-only tenant's user is ADMIN, so they DO get agents; the bundle
    // OWNER does too. Use a VIEWER to prove the filter bites.
    const viewer = `shell-viewer-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email: viewer, name: viewer, passwordHash: await hashPassword('x') },
    });
    ids[viewer] = u.id;
    await withTenant(tenantErp, (tx) =>
      (tx as any).membership.create({ data: { tenantId: tenantErp, userId: u.id, role: 'VIEWER' } }),
    );
    const { token } = await createSession(u.id, tenantErp);

    const r = await get('/console/erp', token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-nav="orders"/, 'a viewer still reads orders');
    assert.ok(!/data-nav="agents"/.test(r.body), 'a viewer must not see team administration');
  });
});

describe('the same request path serves every product', () => {
  test("a product's navigation comes from its manifest, not from its screens", { skip: skip() }, async () => {
    // This used to read "a product with no page of its own is still fully
    // served", with the ERP as its example — it shipped a manifest and nothing
    // else. Phase 6.1 gave it real screens, so that example is gone.
    //
    // The property underneath is unchanged and is the one that matters: the
    // navigation is rendered from the registry, so a tenth product's menu costs
    // a manifest and no platform change. It is asserted on the ERP's REAL
    // screen now, which is a stronger check than asserting it on a placeholder
    // that existed to be replaced.
    const erp = await get('/console/erp', tokens[emails.bundle]);
    assert.equal(erp.status, 200);
    assert.match(erp.body, /data-nav="shipments"/, "the ERP's own navigation");
    assert.match(erp.body, /data-nav="orders"/);

    // And the builder's menu is its own, from the same mechanism.
    const builder = await get('/console/builder', tokens[emails.bundle]);
    assert.match(builder.body, /data-nav="pages"/);
    assert.ok(!/data-nav="shipments"/.test(builder.body), "no product shows another's menu");
  });

  test('the generic route still resolves every registered product', { skip: skip() }, async () => {
    // Both shipped products now have their own index, so NOTHING exercises the
    // [product] fallback end to end any more. That is expected — it is what
    // Phase 6 was for — and it is worth saying rather than quietly losing the
    // coverage.
    //
    // What can still be checked is the resolution the fallback depends on: every
    // registered product resolves by its base path, and an unregistered segment
    // resolves to nothing. A tenth product added tomorrow is served by that
    // logic on its first day, before anyone writes it a page.
    for (const product of productRegistry.list()) {
      assert.equal(
        productRegistry.resolveByPath(product.basePath)?.id,
        product.id,
        `${product.basePath} must resolve to ${product.id}`,
      );
    }
    assert.equal(productRegistry.resolveByPath('/not-a-product'), undefined);
  });

  test('a product MAY supply its own index without the platform knowing', { skip: skip() }, async () => {
    // The builder has grown a real overview. The platform did not change to
    // allow that: a static segment simply wins over the dynamic one, and any
    // product that has not written a page keeps the generic fallback.
    const builder = await get('/console/builder', tokens[emails.bundle]);
    assert.equal(builder.status, 200);
    assert.match(builder.body, /data-testid="builder-overview"/);

    // Both still render inside the one shell, with the same switcher.
    for (const body of [builder.body, (await get('/console/erp', tokens[emails.bundle])).body]) {
      assert.match(body, /data-testid="product-switcher"/);
    }
  });
});

describe('a session outlives its membership without becoming a trap', () => {
  /* THE INCIDENT THIS PINS. Removing a membership deliberately keeps the
   * person's sessions (their other companies must stay signed in) — but a
   * surviving session still bound to the removed tenant resolved to
   * `tenant: null, products: []` and rendered a dead console captioned "No
   * products are enabled for this company", with the switcher hidden because
   * one membership is "nothing to switch". Observed in production on the demo
   * owner. Resolution now self-heals to a live membership and PERSISTS the
   * correction; a user with genuinely no memberships gets told that, in those
   * words. */

  test('a stale binding self-heals to a live membership', { skip: skip() }, async () => {
    // The bundle owner is NOT a member of the erp-only tenant; bind a fresh
    // session there anyway — exactly the state membership removal leaves.
    const { token } = await createSession(ids[emails.bundle], tenantErp);
    const r = await get('/console', token);
    // Healed: 200 on their real tenant (two products => the chooser page),
    // not the dead-console state.
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="console-choose-app"/);
    assert.match(r.body, /Bundle Co/, "the healed session shows the user's own company");
    // And the correction is PERSISTED, not re-derived per request. The id is
    // the token's sha256 — the same derivation createSession writes.
    const { createHash } = await import('node:crypto');
    const row = await asPlatform().session.findUnique({
      where: { id: createHash('sha256').update(token).digest('hex') },
      select: { activeTenantId: true },
    });
    assert.equal(row?.activeTenantId, tenantBundle, 'the healed binding is written back');
  });

  test('no memberships at all says so, not "no products"', { skip: skip() }, async () => {
    const email = `shell-orphan-${stamp}@landingos.test`;
    const u = await asPlatform().user.create({
      data: { email, name: email, passwordHash: await hashPassword('x') },
    });
    ids[email] = u.id;
    const { token } = await createSession(u.id, null);
    const r = await get('/console', token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="console-no-membership"/);
    assert.doesNotMatch(
      r.body,
      /data-testid="console-no-products"/,
      'the no-company state must not blame product enablement',
    );
  });
});

describe('the bare domain root is a door, not a dead end', () => {
  /* Nothing owned `/` — storefronts live at /{slug}, the console under
   * /console — so the naked domain answered the 404 page, which is what a
   * person typing the link into a phone saw first (found in production). The
   * root now forwards to the console front door, which itself routes by
   * session; a verified custom domain's root goes to that tenant's
   * storefront instead (asserted implicitly: no verified domains exist in
   * this environment, so the platform branch is the one a test can pin). */
  test('GET / redirects to the console front door', { skip: !serverUp && 'no server' }, async () => {
    const r = await fetch(BASE + '/', { redirect: 'manual' });
    assert.ok([307, 308, 303].includes(r.status), `expected a redirect, got ${r.status}`);
    assert.equal(new URL(r.headers.get('location') ?? '', BASE).pathname, '/console');
  });
});

describe('the display language follows the locale cookie', () => {
  /* The whole switching loop is: the header form posts a server action, the
   * action writes the `locale` cookie, the next render reads it
   * (src/i18n/request.ts). The client half — the select submitting itself on
   * change — is a React prop invisible to server HTML, so it is verified in a
   * real browser; THIS is the regression net for the server half, which is
   * what a wrong resolution order or a renamed cookie would break. The bug
   * this section was written after: choosing a language in the dropdown
   * changed nothing, because the form only submitted on a second click. */
  const skip = () => (!serverUp ? 'no server' : !HAS_DB ? 'no database' : false);

  const CASES = [
    { locale: 'ar', dir: 'rtl' },
    { locale: 'fr', dir: 'ltr' },
    { locale: 'en', dir: 'ltr' },
  ] as const;

  test('each locale cookie renders that language, with its direction', { skip: skip() }, async () => {
    for (const { locale, dir } of CASES) {
      const res = await fetch(BASE + '/console/builder', {
        redirect: 'manual',
        headers: { cookie: `${SESSION_COOKIE}=${tokens[emails.bundle]}; locale=${locale}` },
      });
      assert.equal(res.status, 200, `console must render with locale=${locale}`);
      const body = await res.text();
      assert.match(
        body,
        new RegExp(`<html[^>]*lang="${locale}"`),
        `locale=${locale} must reach <html lang>`,
      );
      assert.match(
        body,
        new RegExp(`<html[^>]*dir="${dir}"`),
        `locale=${locale} must render ${dir}`,
      );
      // The switcher itself must be on the page, offering the cookie's own
      // value — a selector that vanished or forgot its current state is how
      // somebody gets stranded in a language they cannot read.
      assert.match(body, /data-testid="locale-switcher"/);
      // BOTH homes: the header's (hidden below sm) and the drawer's (hidden
      // from md up). A phone had NO language control at all until the second
      // one existed — reported from a real device.
      assert.match(body, /id="locale-mobile"/, 'the drawer carries the phone’s language control');
      assert.match(body, new RegExp(`<option[^>]*selected[^>]*value="${locale}"|<option[^>]*value="${locale}"[^>]*selected`), `the select must show ${locale} as current`);
    }
  });

  test('an unknown locale cookie falls back rather than failing', { skip: skip() }, async () => {
    const res = await fetch(BASE + '/console/builder', {
      redirect: 'manual',
      headers: { cookie: `${SESSION_COOKIE}=${tokens[emails.bundle]}; locale=zz` },
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<html[^>]*lang="(ar|fr|en)"/);
  });
});
