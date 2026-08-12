import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, withTenant, disconnect, deleteTenant } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

/* Workspace defaults — B9 (CAPABILITY_AUDIT). Before this route existed, NO
 * tenant.update call existed anywhere: name/locale/currency/timezone were
 * whatever signup wrote, forever. The properties pinned here: the caller's
 * own row and nothing else moves, the slug cannot move at all, junk values
 * are refused, and the permission is owner-tier. */

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

async function patch(path: string, token: string, data: unknown) {
  const res = await fetch(BASE + path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

before(async () => {
  if (skip) return;
  for (const [key, slug] of [['a', `ws-a-${stamp}`], ['b', `ws-b-${stamp}`]] as const) {
    const t = await asPlatform().tenant.create({ data: { slug, name: `WS ${key}` } });
    await withTenant(t.id, (tx) =>
      (tx as any).subscription.create({
        data: { tenantId: t.id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
      }),
    );
    if (key === 'a') tenantA = t.id; else tenantB = t.id;
    const u = await asPlatform().user.create({
      data: { email: `ws-${key}-${stamp}@landingos.test`, name: key, passwordHash: await hashPassword('x') },
    });
    userIds.push(u.id);
    await withTenant(t.id, (tx) =>
      (tx as any).membership.create({ data: { tenantId: t.id, userId: u.id, role: 'OWNER' } }),
    );
    tokens[key] = (await createSession(u.id, t.id)).token;
  }
  const m = await asPlatform().user.create({
    data: { email: `ws-mgr-${stamp}@landingos.test`, name: 'mgr', passwordHash: await hashPassword('x') },
  });
  userIds.push(m.id);
  await withTenant(tenantA, (tx) =>
    (tx as any).membership.create({ data: { tenantId: tenantA, userId: m.id, role: 'MANAGER' } }),
  );
  tokens.manager = (await createSession(m.id, tenantA)).token;
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

describe('workspace defaults move, and only for their owner', { skip }, () => {
  test("an owner's update lands on their row and nobody else's", async () => {
    const r = await patch('/api/platform/workspace', tokens.a, {
      name: 'Renamed Co', locale: 'fr', currency: 'EUR', timezone: 'Europe/Paris',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.name, 'Renamed Co');

    const a = await asPlatform().tenant.findUnique({ where: { id: tenantA } });
    assert.equal(a!.locale, 'fr');
    assert.equal(a!.currency, 'EUR');
    assert.equal(a!.timezone, 'Europe/Paris');
    const b = await asPlatform().tenant.findUnique({ where: { id: tenantB } });
    assert.equal(b!.name, 'WS b', "the neighbour's row must not move");
  });

  test('the slug is not an accepted field, junk values are refused', async () => {
    const slugTry = await patch('/api/platform/workspace', tokens.a, { slug: 'stolen-name', name: 'X' });
    assert.equal(slugTry.status, 200, 'unknown keys are ignored, not applied');
    const row = await asPlatform().tenant.findUnique({ where: { id: tenantA } });
    assert.equal(row!.slug, `ws-a-${stamp}`, 'the slug never moves');

    for (const bad of [
      { locale: 'de' },
      { currency: 'BTC' },
      { timezone: 'Mars/Olympus' },
      {},
    ]) {
      const r = await patch('/api/platform/workspace', tokens.a, bad);
      assert.equal(r.status, 422, `${JSON.stringify(bad)} must be refused`);
    }
  });

  test('a MANAGER gets 403 on the API and 404 on the screen', async () => {
    const viaApi = await patch('/api/platform/workspace', tokens.manager, { name: 'Coup' });
    assert.equal(viaApi.status, 403);
    const viaScreen = await fetch(`${BASE}/console/settings/workspace`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.manager}` },
      redirect: 'manual',
    });
    assert.equal(viaScreen.status, 404);
  });

  test('the screen renders the form for an owner', async () => {
    const r = await fetch(`${BASE}/console/settings/workspace`, {
      headers: { cookie: `${SESSION_COOKIE}=${tokens.a}` },
    });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /data-testid="workspace-form"/);
  });
});
