import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import {
  createSession, destroySessionsForUser, destroyOtherSessions, resolveSession,
  SESSION_COOKIE, hashPassword,
} from '@landingos/auth';

/* Sessions become visible and revocable — B6 (CAPABILITY_AUDIT). The write
 * side existed quietly (throttled lastSeenAt, destroy helpers, ua/ip
 * columns); this pins the screen that finally shows them and the
 * "sign out everywhere else" semantics: the kept session survives, every
 * other one dies immediately. */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();
let tenantId = '';
let userId = '';
let tokenA = '';
let tokenB = '';

before(async () => {
  if (skip) return;
  const t = await asPlatform().tenant.create({
    data: { slug: `sess-${stamp}`, name: 'Sessions Co' },
  });
  tenantId = t.id;
  await withTenant(t.id, (tx) =>
    (tx as any).subscription.create({
      data: { tenantId: t.id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
    }),
  );
  const u = await asPlatform().user.create({
    data: { email: `sess-${stamp}@landingos.test`, name: 'sess', passwordHash: await hashPassword('x') },
  });
  userId = u.id;
  await withTenant(t.id, (tx) =>
    (tx as any).membership.create({ data: { tenantId: t.id, userId: u.id, role: 'OWNER' } }),
  );
  tokenA = (await createSession(u.id, t.id)).token;
  tokenB = (await createSession(u.id, t.id)).token;
});

after(async () => {
  if (skip) return;
  await destroySessionsForUser(userId).catch(() => {});
  await withTenant(tenantId, (tx) =>
    (tx as any).membership.deleteMany({ where: { userId } }),
  ).catch(() => {});
  await asPlatform().user.delete({ where: { id: userId } }).catch(() => {});
  await deleteTenant(tenantId).catch(() => {});
  await disconnect();
});

describe('the profile shows every session and can end the others', { skip }, () => {
  test('both sessions render, the presenting one marked current', async () => {
    const r = await fetch(`${BASE}/console/settings/profile`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokenA}` },
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /data-testid="sessions-section"/);
    assert.equal((html.match(/data-current="true"/g) ?? []).length, 1, 'exactly one current');
    assert.ok((html.match(/data-current="false"/g) ?? []).length >= 1, 'the other session is listed');
    assert.match(html, /data-testid="sign-out-others"/);
  });

  test('destroyOtherSessions keeps exactly the presented session', async () => {
    const resolved = await resolveSession(tokenA);
    assert.ok(resolved, 'session A resolves before the sweep');
    const killed = await destroyOtherSessions(userId, resolved!.sessionId);
    assert.ok(killed >= 1, 'at least the second session died');

    assert.ok(await resolveSession(tokenA), 'the kept session still works');
    assert.equal(await resolveSession(tokenB), null, 'the other session is gone');

    // And over HTTP: the revoked cookie is a stranger again, immediately.
    const r = await fetch(`${BASE}/console`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokenB}` },
      redirect: 'manual',
    });
    assert.equal(r.status, 307);
    assert.match(r.headers.get('location') ?? '', /\/console\/login/);
  });
});
