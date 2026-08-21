import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword,
  verifyPassword,
  needsRehash,
  verifyAgainstDecoy,
} from '../src/password.ts';
import {
  can,
  requirePermission,
  isEntitled,
  productOf,
  accessibleProducts,
  grantedPermissions,
  ForbiddenError,
  type AuthContext,
} from '../src/rbac.ts';
import {
  createSession,
  resolveSession,
  switchTenant,
  destroySession,
  destroySessionsForUser,
  purgeExpiredSessions,
} from '../src/session.ts';
import { asPlatform, withTenant, disconnect } from '@landingos/db';

const HAS_DB = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL);

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u1',
  tenantId: 't1',
  role: 'MEMBER',
  permissions: [],
  entitlements: ['product.erp', 'product.website-builder'],
  ...over,
});

after(async () => {
  if (HAS_DB) await disconnect();
});

/* ========================================================================== */

describe('passwords', () => {
  test('a hash verifies and a wrong password does not', async () => {
    const h = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('correct horse battery staple', h), true);
    assert.equal(await verifyPassword('Correct horse battery staple', h), false);
  });

  test('hashes are argon2id and salted per password', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.match(a, /^\$argon2id\$/);
    assert.notEqual(a, b, 'identical passwords must not produce identical hashes');
  });

  test("the ERP's existing scrypt hashes still verify", async () => {
    // The migration case. An agent whose password stops working on cutover is
    // a call-centre that cannot log in on a Monday morning.
    const crypto = await import('node:crypto');
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync('legacy-secret', salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    const legacy = ['scrypt', 16384, 8, 1, salt.toString('hex'), key.toString('hex')].join('$');

    assert.equal(await verifyPassword('legacy-secret', legacy), true);
    assert.equal(await verifyPassword('wrong', legacy), false);
  });

  test('a legacy hash is flagged for upgrade, a current one is not', async () => {
    assert.equal(needsRehash('scrypt$16384$8$1$aa$bb'), true);
    assert.equal(needsRehash(await hashPassword('x')), false);
    assert.equal(needsRehash(''), true);
    assert.equal(needsRehash('garbage'), true);
  });

  test('a malformed stored hash is a failed login, not a crash', async () => {
    for (const bad of ['', 'nonsense', '$argon2id$broken', 'scrypt$$$$$']) {
      assert.equal(await verifyPassword('anything', bad), false);
    }
  });

  test('an over-long password is truncated rather than costing unbounded work', async () => {
    // Without a cap an unauthenticated caller decides how much CPU a login
    // burns. The body limit is megabytes.
    const huge = 'a'.repeat(50_000);
    const h = await hashPassword(huge);
    assert.equal(await verifyPassword(huge, h), true);
    assert.equal(await verifyPassword('a'.repeat(1024), h), true, 'truncated at the cap');
  });

  test('the decoy burns comparable work and always fails', async () => {
    // A miss must not be measurably faster than a hit, or the uniform error
    // message leaks which accounts exist.
    const real = await hashPassword('secret');
    const t0 = performance.now();
    await verifyPassword('secret', real);
    const hit = performance.now() - t0;

    const t1 = performance.now();
    const result = await verifyAgainstDecoy('secret');
    const miss = performance.now() - t1;

    assert.equal(result, false);
    const ratio = Math.max(hit, miss) / Math.max(1, Math.min(hit, miss));
    assert.ok(ratio < 10, `hit ${hit.toFixed(0)}ms vs miss ${miss.toFixed(0)}ms — too far apart`);
  });
});

/* ========================================================================== */

describe('authorization', () => {
  test('an owner can do anything their tenant is entitled to', () => {
    const owner = ctx({ role: 'OWNER' });
    assert.equal(can(owner, 'erp:orders:write'), true);
    assert.equal(can(owner, 'website-builder:pages:publish'), true);
    assert.equal(can(owner, 'erp:agents:manage'), true);
  });

  test('entitlement beats role — the gate that ties access to billing', () => {
    // An ADMIN of a tenant that never bought the builder has no business
    // reaching a builder permission, whatever their role says.
    const adminErpOnly = ctx({ role: 'ADMIN', entitlements: ['product.erp'] });
    assert.equal(can(adminErpOnly, 'erp:orders:write'), true);
    assert.equal(can(adminErpOnly, 'website-builder:pages:write'), false);
  });

  test('a lapsed subscription removes access without touching roles', () => {
    // What a downgrade must look like: nothing about the membership changes.
    const owner = ctx({ role: 'OWNER', entitlements: [] });
    assert.equal(can(owner, 'erp:orders:read'), false);
    assert.equal(can(owner, 'website-builder:pages:write'), false);
  });

  test('a viewer reads and cannot write', () => {
    const viewer = ctx({ role: 'VIEWER' });
    assert.equal(can(viewer, 'erp:orders:read'), true);
    assert.equal(can(viewer, 'erp:orders:write'), false);
  });

  test('a manager works the day to day but does not administer the team', () => {
    // Running a call-centre is a different thing from deciding who works
    // there; conflating them lets a shift lead remove the owner.
    const manager = ctx({ role: 'MANAGER' });
    assert.equal(can(manager, 'erp:orders:write'), true);
    assert.equal(can(manager, 'website-builder:pages:publish'), true);
    assert.equal(can(manager, 'erp:agents:manage'), false);
  });

  test('a sensitive permission can still be granted by name', () => {
    const manager = ctx({ role: 'MANAGER', permissions: ['erp:agents:manage'] });
    assert.equal(can(manager, 'erp:agents:manage'), true);
  });

  test('SEC.8 — AI spend is not implied by the write glob', () => {
    // The asymmetry the security review named: every AI call bills the
    // tenant's own provider key, and the spending routes were gated on
    // pages:write — so `*:*:write` quietly handed a MANAGER the company
    // wallet. `*:ai:spend` is SENSITIVE now: role `*` or a named grant.
    const manager = ctx({ role: 'MANAGER' });
    assert.equal(can(manager, 'website-builder:pages:write'), true, 'editing is still theirs');
    assert.equal(can(manager, 'website-builder:ai:spend'), false, 'spending is not');

    const member = ctx({ role: 'MEMBER', permissions: ['website-builder:pages:write'] });
    assert.equal(can(member, 'website-builder:pages:write'), true);
    assert.equal(can(member, 'website-builder:ai:spend'), false);

    assert.equal(can(ctx({ role: 'OWNER' }), 'website-builder:ai:spend'), true);
    assert.equal(can(ctx({ role: 'ADMIN' }), 'website-builder:ai:spend'), true);
    const trusted = ctx({ role: 'MANAGER', permissions: ['website-builder:ai:spend'] });
    assert.equal(can(trusted, 'website-builder:ai:spend'), true, 'grantable by name, like agents:manage');
  });

  test('D-05.1 — the customer registry and the books are not ordinary reads', () => {
    // Found by porting the ERP's suite (Phase 5.1). Both were manager-only
    // there, and the `*:*:read` glob would have handed them to every member —
    // every customer's phone number and lifetime spend, and the company's P&L,
    // readable by a confirmation agent whose own order book is scoped to a
    // handful of rows.
    const member = ctx({ role: 'MEMBER' });
    assert.equal(can(member, 'erp:orders:read'), true, 'an ordinary read still works');
    assert.equal(can(member, 'erp:clients:read'), false);
    assert.equal(can(member, 'erp:finance:read'), false);

    const viewer = ctx({ role: 'VIEWER' });
    assert.equal(can(viewer, 'erp:clients:read'), false);
    assert.equal(can(viewer, 'erp:finance:read'), false);
  });

  test('D-05.1 — a MANAGER needs them by name, an OWNER does not', () => {
    // The accepted cost of the rule above. Running a call-centre day to day is
    // not by itself a reason to hold every customer's PII.
    const manager = ctx({ role: 'MANAGER' });
    assert.equal(can(manager, 'erp:clients:read'), false);

    const granted = ctx({ role: 'MANAGER', permissions: ['erp:clients:read'] });
    assert.equal(can(granted, 'erp:clients:read'), true);
    assert.equal(can(granted, 'erp:finance:read'), false, 'one grant lifts one permission');

    for (const role of ['OWNER', 'ADMIN'] as const) {
      assert.equal(can(ctx({ role }), 'erp:clients:read'), true, role);
      assert.equal(can(ctx({ role }), 'erp:finance:read'), true, role);
    }
  });

  test('D-05.1 — the rule names no product, so a tenth product inherits it', () => {
    // Stated as a glob for the same reason every other rule here is: the
    // registry is the only thing that knows which products exist.
    const member = ctx({ role: 'MEMBER' });
    assert.equal(can(member, 'website-builder:clients:read'), false);
  });

  test('D-05.1 — entitlement is still checked first', () => {
    // A grant by name must not become a way around the billing gate.
    const granted = ctx({
      role: 'MANAGER',
      permissions: ['erp:clients:read'],
      entitlements: ['product.website-builder'],
    });
    assert.equal(can(granted, 'erp:clients:read'), false);
  });

  test('an explicit grant lifts one permission without lifting the rest', () => {
    const member = ctx({ role: 'MEMBER', permissions: ['erp:orders:write'] });
    assert.equal(can(member, 'erp:orders:write'), true);
    assert.equal(can(member, 'erp:products:write'), false);
  });

  test('a suspended member loses access while their session survives', () => {
    // The entire reason sessions are server-side rather than a stateless token.
    const suspended = ctx({ role: 'OWNER', suspended: true });
    assert.equal(can(suspended, 'erp:orders:read'), false);
  });

  test('requirePermission throws a typed error', () => {
    assert.throws(
      () => requirePermission(ctx({ role: 'VIEWER' }), 'erp:orders:write'),
      (e: Error) => e instanceof ForbiddenError && e.message.includes('erp:orders:write'),
    );
  });

  test('permissions resolve to the product that declared them', () => {
    assert.equal(productOf('erp:orders:read'), 'erp');
    assert.equal(productOf('website-builder:pages:write'), 'website-builder');
    // The bug this replaced: a 'builder:' prefix resolves to no product and
    // therefore skips the entitlement gate entirely.
    assert.equal(productOf('builder:pages:write'), null);
    assert.equal(productOf('platform:billing:read'), null);
  });

  test('an unknown product is not silently entitled or denied', () => {
    // Left to a default it would be one or the other, and both are wrong.
    assert.equal(isEntitled('mystery:thing:read', []), true, 'left to the role check');
  });

  test('the app switcher shows only products that are both paid for and reachable', () => {
    const erpOnly = ctx({ role: 'ADMIN', entitlements: ['product.erp'] });
    assert.deepEqual(accessibleProducts(erpOnly).map((p) => p.id), ['erp']);

    const both = ctx({ role: 'ADMIN' });
    assert.deepEqual(accessibleProducts(both).map((p) => p.id).sort(), ['erp', 'website-builder']);

    const none = ctx({ role: 'ADMIN', entitlements: [] });
    assert.deepEqual(accessibleProducts(none), []);
  });

  test('granted permissions never include an unentitled product', () => {
    const granted = grantedPermissions(ctx({ role: 'OWNER', entitlements: ['product.erp'] }));
    assert.ok(granted.length > 0);
    assert.ok(!granted.some((p) => p.startsWith('website-builder:')), granted.join(', '));
  });
});

/* ========================================================================== */

describe('sessions', { skip: !HAS_DB }, () => {
  const db = () => asPlatform();
  const email = `session-test-${Date.now()}@landingos.test`;
  let userId = '';
  let tenantA = '';
  let tenantB = '';

  test('setup', async () => {
    const t1 = await db().tenant.create({ data: { slug: `sess-a-${Date.now()}`, name: 'Sess A' } });
    const t2 = await db().tenant.create({ data: { slug: `sess-b-${Date.now()}`, name: 'Sess B' } });
    tenantA = t1.id;
    tenantB = t2.id;
    const u = await db().user.create({
      data: { email, name: 'Session Tester', passwordHash: await hashPassword('pw') },
    });
    userId = u.id;
    // Membership and Subscription are tenant-scoped, so they are written
    // through a tenant binding. asPlatform() cannot insert them at all — with
    // no tenant bound, every WITH CHECK compares against NULL and the write is
    // refused. That is layer 3 doing its job, not an obstacle to work around.
    await withTenant(tenantA, async (tx) => {
      await (tx as any).membership.create({ data: { tenantId: tenantA, userId, role: 'OWNER' } });
      await (tx as any).subscription.create({
        data: { tenantId: tenantA, status: 'ACTIVE', entitlements: ['product.erp'] },
      });
    });
  });

  test('a session resolves to its user, tenant and permissions', async () => {
    const { token } = await createSession(userId, tenantA);
    const s = await resolveSession(token);
    assert.ok(s);
    assert.equal(s!.user.email, email);
    assert.equal(s!.tenant?.id, tenantA);
    assert.equal(s!.auth?.role, 'OWNER');
    assert.equal(can(s!.auth!, 'erp:orders:write'), true);
    await destroySession(token);
  });

  test('only the hash is stored — the raw token is not in the database', async () => {
    const { token } = await createSession(userId, tenantA);
    const found = await db().session.findUnique({ where: { id: token } });
    assert.equal(found, null, 'the raw token must not be a usable key');
    assert.ok(await resolveSession(token), 'but it still resolves via its hash');
    await destroySession(token);
  });

  test('an unknown or destroyed token resolves to nothing', async () => {
    assert.equal(await resolveSession('not-a-real-token'), null);
    assert.equal(await resolveSession(''), null);
    assert.equal(await resolveSession(null), null);

    const { token } = await createSession(userId, tenantA);
    await destroySession(token);
    assert.equal(await resolveSession(token), null);
  });

  test('an expired session is rejected and cleaned up', async () => {
    const { token } = await createSession(userId, tenantA);
    const crypto = await import('node:crypto');
    const id = crypto.createHash('sha256').update(token).digest('hex');
    await db().session.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    assert.equal(await resolveSession(token), null);
    assert.equal(await db().session.findUnique({ where: { id } }), null, 'and removed');
  });

  test('switching tenants requires membership', async () => {
    const { token } = await createSession(userId, tenantA);
    // tenantB exists but this user is not a member — otherwise the switcher
    // would be a way to act as any tenant by id.
    assert.equal(await switchTenant(token, tenantB), false);
    assert.equal((await resolveSession(token))!.tenant?.id, tenantA);

    await withTenant(tenantB, (tx) =>
      (tx as any).membership.create({ data: { tenantId: tenantB, userId, role: 'VIEWER' } }),
    );
    assert.equal(await switchTenant(token, tenantB), true);

    const s = await resolveSession(token);
    assert.equal(s!.tenant?.id, tenantB);
    assert.equal(s!.auth?.role, 'VIEWER', 'the role follows the tenant, not the user');
    await destroySession(token);
  });

  test('a session lists every tenant its user belongs to', async () => {
    const { token } = await createSession(userId, tenantA);
    const s = await resolveSession(token);
    assert.equal(s!.memberships.length, 2, 'the tenant switcher reads this');
    await destroySession(token);
  });

  test('suspending a membership revokes access on the very next request', async () => {
    // The property a stateless token cannot provide.
    const { token } = await createSession(userId, tenantA);
    assert.equal(can((await resolveSession(token))!.auth!, 'erp:orders:read'), true);

    await withTenant(tenantA, (tx) =>
      (tx as any).membership.update({
        where: { tenantId_userId: { tenantId: tenantA, userId } },
        data: { suspended: true },
      }),
    );

    const after = await resolveSession(token);
    assert.ok(after, 'the session still exists');
    assert.equal(can(after!.auth!, 'erp:orders:read'), false, 'but access is gone');

    await withTenant(tenantA, (tx) =>
      (tx as any).membership.update({
        where: { tenantId_userId: { tenantId: tenantA, userId } },
        data: { suspended: false },
      }),
    );
    await destroySession(token);
  });

  test('a lapsed subscription removes access without touching the session', async () => {
    const { token } = await createSession(userId, tenantA);
    await withTenant(tenantA, (tx) =>
      (tx as any).subscription.update({
        where: { tenantId: tenantA },
        data: { entitlements: [] },
      }),
    );
    assert.equal(can((await resolveSession(token))!.auth!, 'erp:orders:read'), false);

    await withTenant(tenantA, (tx) =>
      (tx as any).subscription.update({
        where: { tenantId: tenantA },
        data: { entitlements: ['product.erp'] },
      }),
    );
    await destroySession(token);
  });

  test('signing out everywhere revokes every session at once', async () => {
    const a = await createSession(userId, tenantA);
    const b = await createSession(userId, tenantA);
    const n = await destroySessionsForUser(userId);
    assert.ok(n >= 2);
    assert.equal(await resolveSession(a.token), null);
    assert.equal(await resolveSession(b.token), null);
  });

  test('purging expired sessions leaves live ones alone', async () => {
    const live = await createSession(userId, tenantA);
    await purgeExpiredSessions();
    assert.ok(await resolveSession(live.token), 'a live session survives the purge');
    await destroySession(live.token);
  });

  test('teardown', async () => {
    await db().session.deleteMany({ where: { userId } });
    for (const t of [tenantA, tenantB]) {
      await withTenant(t, (tx) => (tx as any).membership.deleteMany({ where: { userId } }));
    }
    await db().user.delete({ where: { id: userId } });
    await db().tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  });
});
