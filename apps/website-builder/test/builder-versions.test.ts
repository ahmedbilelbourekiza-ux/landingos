import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { asPlatform, withTenant, disconnect, deleteTenant, Prisma } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

import {
  SNAPSHOT_TO_MANY,
  SNAPSHOT_TO_ONE,
  HISTORY_RELATIONS,
  REFERENCE_RELATIONS,
  RELATION_MODEL,
  SNAPSHOT_RELATIONS,
  SESSION_IDLE_MINUTES,
  continuesEditingSession,
  restorableColumns,
} from '../src/lib/landing/versions.ts';

/* =============================================================================
 * LB.14b — page version history.
 *
 * PURE — the session rule and the column sweep, both without a database.
 *
 * DRIFT — the two guards this feature is worth nothing without. The scoping
 * note said it plainly: "any design that hooks eleven routes will be missing
 * the twelfth within a month", and it said so because `duplicate`'s
 * hand-written copy list had already gone stale twice by then and has gone
 * stale twice more since. So the suite, not anybody's memory, is what holds
 * the hook complete and the snapshot whole.
 *
 * END TO END — the three product decisions, checked as behaviour: one version
 * per sitting, a restore lands as a DRAFT, and orders keep the price they were
 * taken at. Plus the isolation a new tenant-scoped table owes.
 * ========================================================================== */

const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';
const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const serverUp = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);
const skip = !HAS_DB || !serverUp;

const stamp = Date.now();

/* ---- pure: the session rule --------------------------------------------- */

describe('the editing-session rule (pure)', () => {
  const now = new Date('2026-08-19T12:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  test('the same session, still warm, continues the sitting', () => {
    assert.equal(continuesEditingSession({ sessionId: 's1', lastEditAt: ago(1) }, 's1', now), true);
    assert.equal(
      continuesEditingSession({ sessionId: 's1', lastEditAt: ago(SESSION_IDLE_MINUTES - 1) }, 's1', now),
      true,
    );
  });

  test('the gap ends it — this is what stops a 14-day login being one version', () => {
    assert.equal(
      continuesEditingSession({ sessionId: 's1', lastEditAt: ago(SESSION_IDLE_MINUTES) }, 's1', now),
      false,
    );
    assert.equal(continuesEditingSession({ sessionId: 's1', lastEditAt: ago(60 * 24) }, 's1', now), false);
  });

  test('another session is another sitting, however recent', () => {
    assert.equal(continuesEditingSession({ sessionId: 's2', lastEditAt: ago(1) }, 's1', now), false);
  });

  test('no mark, and no session id, never continue', () => {
    assert.equal(continuesEditingSession(null, 's1', now), false);
    assert.equal(continuesEditingSession({ sessionId: 's1', lastEditAt: ago(1) }, null, now), false);
    assert.equal(continuesEditingSession({ sessionId: null, lastEditAt: ago(1) }, null, now), false);
  });

  test('a clock that went backwards does not extend a sitting forever', () => {
    assert.equal(continuesEditingSession({ sessionId: 's1', lastEditAt: ago(-5) }, 's1', now), false);
  });
});

/* ---- pure: the column sweep --------------------------------------------- */

describe('restorableColumns (pure)', () => {
  test('identity and bookkeeping never come back out', () => {
    const out = restorableColumns('LandingPage', {
      id: 'p1',
      tenantId: 't1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Watch',
    });
    assert.deepEqual(Object.keys(out).sort(), ['title']);
  });

  test('an explicit null CLEARS an ordinary column rather than being skipped', () => {
    const out = restorableColumns('LandingPage', { announcement: null, oldPrice: null });
    assert.equal('announcement' in out, true);
    assert.equal(out.announcement, null);
    assert.equal(out.oldPrice, null);
  });

  test('a null JSON column becomes DbNull — the third state duplicate documents', () => {
    const out = restorableColumns('LandingPage', { trackingIntegrationIds: null });
    assert.equal(out.trackingIntegrationIds, Prisma.DbNull);
    const kept = restorableColumns('LandingPage', { trackingIntegrationIds: ['a', 'b'] });
    assert.deepEqual(kept.trackingIntegrationIds, ['a', 'b']);
  });

  test('a column absent from an older snapshot is left alone, not written as undefined', () => {
    const out = restorableColumns('LandingPage', { title: 'Watch' });
    assert.equal('brandId' in out, false);
  });

  test('skip wins over presence — this is how status/published are held back', () => {
    const out = restorableColumns(
      'LandingPage',
      { status: 'PUBLISHED', published: true, title: 'Watch' },
      new Set(['status', 'published']),
    );
    assert.deepEqual(Object.keys(out).sort(), ['title']);
  });

  test('relation rows drop their own foreign key so they can be re-parented', () => {
    const out = restorableColumns('LandingVariant', {
      id: 'v1',
      tenantId: 't1',
      landingPageId: 'p1',
      name: 'Colour',
      value: 'Black',
      extraPrice: '0',
      displayOrder: 0,
    });
    assert.deepEqual(Object.keys(out).sort(), ['displayOrder', 'extraPrice', 'name', 'value']);
  });
});

/* ---- drift guard 1: the snapshot covers every relation ------------------- */

describe('the snapshot cannot silently fall behind the schema', () => {
  const model = (Prisma as any).dmmf.datamodel.models.find((m: any) => m.name === 'LandingPage');

  test('every relation on LandingPage is classified exactly once', () => {
    const declared = [
      ...SNAPSHOT_TO_MANY,
      ...SNAPSHOT_TO_ONE,
      ...HISTORY_RELATIONS,
      ...REFERENCE_RELATIONS,
    ] as string[];
    assert.equal(new Set(declared).size, declared.length, 'a relation is classified twice');

    const actual = model.fields.filter((f: any) => f.kind === 'object').map((f: any) => f.name);

    const unclassified = actual.filter((name: string) => !declared.includes(name));
    assert.deepEqual(
      unclassified,
      [],
      'LandingPage grew a relation nobody decided about. Add it to SNAPSHOT_TO_MANY / ' +
        'SNAPSHOT_TO_ONE if a version should carry it, or to HISTORY_RELATIONS / ' +
        'REFERENCE_RELATIONS if it must not — see versions.ts.',
    );

    const stale = declared.filter((name) => !actual.includes(name));
    assert.deepEqual(stale, [], 'versions.ts names a relation LandingPage no longer has');
  });

  test('the to-many split matches the schema, so nothing is restored as the wrong shape', () => {
    for (const name of SNAPSHOT_TO_MANY) {
      const field = model.fields.find((f: any) => f.name === name);
      assert.equal(field.isList, true, `${name} is declared to-many but the schema says otherwise`);
    }
    for (const name of SNAPSHOT_TO_ONE) {
      const field = model.fields.find((f: any) => f.name === name);
      assert.equal(field.isList, false, `${name} is declared to-one but the schema says otherwise`);
    }
  });

  test('every snapshotted relation has a client accessor that resolves', () => {
    const accessors = new Set(
      (Prisma as any).dmmf.datamodel.models.map((m: any) => m.name[0].toLowerCase() + m.name.slice(1)),
    );
    for (const relation of SNAPSHOT_RELATIONS) {
      const accessor = RELATION_MODEL[relation];
      assert.ok(accessor, `${relation} has no entry in RELATION_MODEL`);
      assert.ok(accessors.has(accessor), `RELATION_MODEL.${relation} points at no model: ${accessor}`);
    }
  });
});

/* ---- drift guard 2: the hook covers every write route -------------------- */

describe('the checkpoint hook cannot be forgotten on a new route', () => {
  const ROOT = path.join(import.meta.dirname, '..', 'src', 'app', 'api', 'builder', 'landings', '[id]');

  /**
   * Mutating exports that deliberately take NO session checkpoint. Each entry
   * is a decision, and the reason travels with it — the same shape
   * `apply-rls.ts` uses for the tables it leaves without a policy.
   */
  const EXEMPT: Record<string, string> = {
    'duplicate/route.ts:POST': 'writes a NEW page; this one is not touched, so there is nothing to undo',
    'analyze/route.ts:POST': 'writes a LandingInsight — advice about the page is not a change to it',
    'route.ts:DELETE': 'versions cascade from the page, so a checkpoint here deletes itself',
    'versions/[versionId]/restore/route.ts:POST':
      'takes its own unconditional `restore` checkpoint, which the session rule would have skipped',
  };

  function routeFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return routeFiles(full);
      return entry.name === 'route.ts' ? [full] : [];
    });
  }

  const files = routeFiles(ROOT);

  test('the scan found the routes', () => {
    assert.ok(files.length >= 15, `expected the landing write surface, found ${files.length} files`);
  });

  test('every mutating export is hooked, or exempt on the record', () => {
    const unhooked: string[] = [];

    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const source = fs.readFileSync(file, 'utf8');

      for (const match of source.matchAll(/export const (PATCH|PUT|POST|DELETE) = (\w+)/g)) {
        const [, method, wrapper] = match;
        const key = `${rel}:${method}`;
        if (wrapper === 'landingWriteRoute') continue;
        if (key in EXEMPT) continue;
        unhooked.push(`${key} uses ${wrapper}`);
      }
    }

    assert.deepEqual(
      unhooked,
      [],
      'a landing-page write takes no version checkpoint. Use `landingWriteRoute` from ' +
        '@/lib/api/landing-write, or add it to EXEMPT here with the reason it must not.',
    );
  });

  test('no exemption outlives the route it was written for', () => {
    const stale = Object.keys(EXEMPT).filter((key) => {
      const [rel, method] = key.split(':');
      const file = path.join(ROOT, rel);
      if (!fs.existsSync(file)) return true;
      return !new RegExp(`export const ${method} = `).test(fs.readFileSync(file, 'utf8'));
    });
    assert.deepEqual(stale, [], 'an exemption names a route or method that no longer exists');
  });
});

/* ---- end to end --------------------------------------------------------- */

describe('version history (end to end)', { skip }, () => {
  let tenantId = '';
  let otherTenantId = '';
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};

  let pageId = '';
  let otherPageId = '';

  async function makeUser(tenant: string, role: string, label: string) {
    const email = `ver-${label}-${stamp}@landingos.test`;
    const user = await asPlatform().user.create({
      data: { email, name: `Ver ${label}`, passwordHash: await hashPassword('x') },
    });
    userIds.push(user.id);
    await withTenant(tenant, (tx) =>
      (tx as any).membership.create({ data: { tenantId: tenant, userId: user.id, role } }),
    );
    const { token } = await createSession(user.id, tenant);
    tokens[label] = token;
    return user.id;
  }

  async function api(method: string, path: string, token: string | undefined, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  const listVersions = async (id = pageId, token = tokens.owner) =>
    (await api('GET', `/api/builder/landings/${id}/versions`, token)).body?.data?.versions ?? [];

  const readPage = (id = pageId) =>
    withTenant(tenantId, (tx) =>
      (tx as any).landingPage.findUnique({
        where: { id },
        include: { variants: { orderBy: { displayOrder: 'asc' } }, setting: true },
      }),
    );

  before(async () => {
    if (skip) return;

    const main = await asPlatform().tenant.create({
      data: { slug: `ver-${stamp}`, name: 'Version Tenant' },
    });
    tenantId = main.id;
    const other = await asPlatform().tenant.create({
      data: { slug: `ver-other-${stamp}`, name: 'Other Tenant' },
    });
    otherTenantId = other.id;

    for (const id of [tenantId, otherTenantId]) {
      await withTenant(id, (tx) =>
        (tx as any).subscription.create({
          data: { tenantId: id, status: 'ACTIVE', entitlements: ['product.website-builder'] },
        }),
      );
    }

    await withTenant(tenantId, async (tx) => {
      const page = await (tx as any).landingPage.create({
        data: {
          tenantId,
          title: 'Original title',
          slug: `ver-page-${stamp}`,
          status: 'PUBLISHED',
          published: true,
          price: 5000,
          announcement: 'Original announcement',
        },
        select: { id: true },
      });
      pageId = page.id;
      await (tx as any).landingVariant.create({
        data: { tenantId, landingPageId: pageId, name: 'Colour', value: 'Black', extraPrice: 0, displayOrder: 0 },
      });
      const second = await (tx as any).landingPage.create({
        data: { tenantId, title: 'Second', slug: `ver-second-${stamp}`, price: 100 },
        select: { id: true },
      });
      otherPageId = second.id;
    });

    await makeUser(tenantId, 'OWNER', 'owner');
    await makeUser(tenantId, 'OWNER', 'second');
    await makeUser(otherTenantId, 'OWNER', 'stranger');
  });

  after(async () => {
    if (skip) return;
    for (const id of userIds) {
      await destroySessionsForUser(id);
      await asPlatform().user.delete({ where: { id } }).catch(() => {});
    }
    for (const id of [tenantId, otherTenantId]) {
      if (id) await deleteTenant(id).catch(() => {});
    }
    await disconnect();
  });

  test('an untouched page has no versions — opening the editor is not editing', async () => {
    assert.deepEqual(await listVersions(), []);
  });

  test('the first edit of a sitting takes ONE version, and it holds the state BEFORE it', async () => {
    const res = await api('PATCH', `/api/builder/landings/${pageId}/general`, tokens.owner, {
      title: 'Edited once',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const versions = await listVersions();
    assert.equal(versions.length, 1);
    assert.equal(versions[0].reason, 'edit');
    assert.equal(versions[0].actorName, 'Ver owner');

    const stored = await withTenant(tenantId, (tx) =>
      (tx as any).landingPageVersion.findUnique({ where: { id: versions[0].id } }),
    );
    assert.equal(stored.snapshot.title, 'Original title', 'the snapshot must predate the edit');
    assert.equal(stored.snapshot.variants.length, 1, 'the seven owned relations travel with it');
    assert.equal(stored.snapshot.variants[0].value, 'Black');
  });

  test('more edits in the same sitting add NO versions — decision 1, the whole point', async () => {
    for (const [section, body] of [
      ['general', { title: 'Edited twice' }],
      ['pricing', { price: 7777 }],
    ] as const) {
      const res = await api('PATCH', `/api/builder/landings/${pageId}/${section}`, tokens.owner, body);
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const put = await api('PUT', `/api/builder/landings/${pageId}/variants`, tokens.owner, {
      items: [{ name: 'Colour', value: 'Red', extraPrice: 0 }],
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));

    assert.equal((await listVersions()).length, 1, 'one sitting is one version, across sections');
  });

  test('a different session is a different sitting, and gets its own version', async () => {
    const res = await api('PATCH', `/api/builder/landings/${pageId}/general`, tokens.second, {
      title: 'Edited by the second session',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const versions = await listVersions();
    assert.equal(versions.length, 2);
    assert.equal(versions[0].actorName, 'Ver second', 'newest first');
  });

  test('restoring lands the page as a DRAFT — decision 3, LB.34 precedent', async () => {
    // Put it back live first, so the unpublish is the restore's doing.
    await api('POST', `/api/builder/landings/${pageId}/publish`, tokens.owner, { published: true });
    const live = await readPage();
    assert.equal(live.published, true);
    assert.equal(live.status, 'PUBLISHED');

    const versions = await listVersions();
    const oldest = versions[versions.length - 1];
    const res = await api(
      'POST',
      `/api/builder/landings/${pageId}/versions/${oldest.id}/restore`,
      tokens.owner,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.published, false);
    assert.equal(res.body.data.status, 'DRAFT');

    const after = await readPage();
    assert.equal(after.title, 'Original title', 'the scalars came back');
    assert.equal(after.announcement, 'Original announcement');
    assert.equal(String(after.price), '5000', 'the price came back');
    assert.equal(after.published, false, 'a restore never republishes');
    assert.equal(after.status, 'DRAFT');
    assert.equal(after.variants.length, 1, 'owned relations were rebuilt from the snapshot');
    assert.equal(after.variants[0].value, 'Black', 'not the Red the sitting had left');
  });

  test('a restore is itself undoable — it checkpoints what it overwrites, always', async () => {
    const versions = await listVersions();
    assert.equal(versions[0].reason, 'restore', 'the newest version is the pre-restore state');

    const stored = await withTenant(tenantId, (tx) =>
      (tx as any).landingPageVersion.findUnique({ where: { id: versions[0].id } }),
    );
    assert.equal(stored.snapshot.title, 'Edited by the second session');
    assert.equal(stored.snapshot.variants[0].value, 'Red');
  });

  test('an order keeps the price it was taken at when the page price is restored — decision 2', async () => {
    const order = await withTenant(tenantId, (tx) =>
      (tx as any).salesOrder.create({
        data: {
          tenantId,
          landingPageId: pageId,
          customerName: 'Test Customer',
          phone: `0555${String(stamp).slice(-6)}`,
          wilaya: 'Alger',
          baladia: 'Alger Centre',
          address: 'Somewhere',
          quantity: 1,
          productPrice: 5000,
          shippingPrice: 400,
          totalPrice: 5400,
        },
        select: { id: true },
      }),
    );

    // Change the price, then restore a version that carries the old one.
    const bumped = await api('PATCH', `/api/builder/landings/${pageId}/pricing`, tokens.owner, {
      price: 9999,
    });
    assert.equal(bumped.status, 200, JSON.stringify(bumped.body));

    const versions = await listVersions();
    const res = await api(
      'POST',
      `/api/builder/landings/${pageId}/versions/${versions[versions.length - 1].id}/restore`,
      tokens.owner,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const after = await withTenant(tenantId, (tx) =>
      (tx as any).salesOrder.findUnique({ where: { id: order.id } }),
    );
    assert.equal(String(after.productPrice), '5000');
    assert.equal(String(after.totalPrice), '5400');
  });

  test('a version of ANOTHER page of the same tenant cannot overwrite this one', async () => {
    const versions = await listVersions();
    const res = await api(
      'POST',
      `/api/builder/landings/${otherPageId}/versions/${versions[0].id}/restore`,
      tokens.owner,
    );
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  test('another tenant sees nothing and can restore nothing', async () => {
    const list = await api('GET', `/api/builder/landings/${pageId}/versions`, tokens.stranger);
    assert.equal(list.status, 404, 'the page itself does not resolve for them');

    const versions = await listVersions();
    const restore = await api(
      'POST',
      `/api/builder/landings/${pageId}/versions/${versions[0].id}/restore`,
      tokens.stranger,
    );
    assert.equal(restore.status, 404, JSON.stringify(restore.body));
  });

  test('anonymous is refused', async () => {
    assert.equal((await api('GET', `/api/builder/landings/${pageId}/versions`, undefined)).status, 401);
  });

  test('the versions die with the page they describe', async () => {
    const doomed = await withTenant(tenantId, (tx) =>
      (tx as any).landingPage.create({
        data: { tenantId, title: 'Doomed', slug: `ver-doomed-${stamp}`, price: 10 },
        select: { id: true },
      }),
    );
    await api('PATCH', `/api/builder/landings/${doomed.id}/general`, tokens.owner, { title: 'Touched' });
    assert.equal((await listVersions(doomed.id)).length, 1);

    const del = await api('DELETE', `/api/builder/landings/${doomed.id}`, tokens.owner);
    assert.equal(del.status, 200, JSON.stringify(del.body));

    const left = await withTenant(tenantId, (tx) =>
      (tx as any).landingPageVersion.count({ where: { landingPageId: doomed.id } }),
    );
    assert.equal(left, 0);
  });
});
