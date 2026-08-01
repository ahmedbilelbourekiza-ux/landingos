import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaClient } from '../prisma/client/index.js';
import { withTenant, forTenant, asPlatform, disconnect, TenantContextError } from '../src/tenant-client.ts';

/* =============================================================================
 * R-01 — cross-tenant isolation, against a real database.
 *
 * The architecture calls a cross-tenant leak the single critical risk of the
 * programme and commits to "an automated suite that calls every endpoint as
 * tenant A and asserts zero tenant-B rows... written in Phase 3, before any
 * feature depends on it". No endpoints exist yet, so the equivalent here is
 * every tenant-scoped TABLE, plus the paths a leak would realistically take.
 *
 * Two kinds of coverage, deliberately:
 *
 *   Structural — every one of the 46 tenant-scoped tables is checked in
 *   pg_catalog for RLS enabled, FORCE set, a policy present, and a WITH CHECK
 *   clause. Mechanical, so a table added later cannot quietly miss out.
 *
 *   Behavioural — real rows in both product domains, read and written across a
 *   tenant boundary, including through raw SQL where layer 2 does not apply.
 *
 * Requires DATABASE_URL (the app role) and MIGRATE_DATABASE_URL (the owner).
 * Skips rather than fails without them, so `npm test` still runs offline.
 * ========================================================================== */

const HAS_DB = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL);
const owner = HAS_DB
  ? new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } })
  : (null as any);

const A = 'test-tenant-a-' + Date.now();
const B = 'test-tenant-b-' + Date.now();

async function seedTenant(id: string, label: string) {
  await owner.tenant.create({ data: { id, slug: id, name: label } });

  // Written THROUGH the tenant binding, which also proves WITH CHECK accepts a
  // correctly-stamped row.
  await withTenant(id, async (db) => {
    await (db as any).client.create({
      data: { id: `${id}-client`, tenantId: id, phone: '0555000111', name: `${label} customer` },
    });
    await (db as any).landingPage.create({
      data: { tenantId: id, title: `${label} page`, slug: 'shared-slug', price: 1000 },
    });
    await (db as any).catalogProduct.create({
      data: { id: `${id}-product`, tenantId: id, name: `${label} product`, price: 500 },
    });
    await (db as any).fulfillmentOrder.create({
      data: { id: `${id}-order`, tenantId: id, client: `${label} buyer`, phone: '0555000111', price: 1500 },
    });
  });
}

before(async () => {
  if (!HAS_DB) return;
  await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE slug LIKE 'test-tenant-%'`);
  await seedTenant(A, 'Alpha');
  await seedTenant(B, 'Beta');
});

after(async () => {
  if (!HAS_DB) return;
  await owner.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE slug LIKE 'test-tenant-%'`);
  await owner.$disconnect();
  await disconnect();
});

describe('layer 3 — every tenant-scoped table is actually protected', { skip: !HAS_DB }, () => {
  test('RLS is enabled, FORCEd, and carries a policy with WITH CHECK', async () => {
    const rows = await owner.$queryRawUnsafe<any[]>(`
      SELECT c.relname                                    AS table,
             c.relrowsecurity                             AS enabled,
             c.relforcerowsecurity                        AS forced,
             (p.polname IS NOT NULL)                      AS has_policy,
             (p.polwithcheck IS NOT NULL)                 AS has_with_check
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'tenant_isolation'
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname
                      AND col.column_name = 'tenantId')
      ORDER BY c.relname
    `);

    assert.ok(rows.length >= 40, `expected the full set of scoped tables, saw ${rows.length}`);

    const broken = rows.filter(
      (r) => !r.enabled || !r.forced || !r.has_policy || !r.has_with_check,
    );
    assert.deepEqual(
      broken.map((r) => r.table),
      [],
      'these tables carry a tenantId but are not fully protected — run `npm run rls`',
    );
  });

  test('the unscoped tables are exactly the ones we expect', async () => {
    const rows = await owner.$queryRawUnsafe<any[]>(`
      SELECT table_name FROM information_schema.tables t
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                        WHERE c.table_schema='public' AND c.table_name=t.table_name
                          AND c.column_name='tenantId')
      ORDER BY table_name
    `);
    assert.deepEqual(
      rows.map((r) => r.table_name),
      ['Baladia', 'Session', 'Tenant', 'User', 'Wilaya'],
      'a table without tenantId is a table without a policy — this list must stay deliberate',
    );
  });
});

describe('reads cannot cross a tenant boundary', { skip: !HAS_DB }, () => {
  test('each tenant sees only its own rows', async () => {
    for (const [tenant, label] of [[A, 'Alpha'], [B, 'Beta']] as const) {
      const clients = await forTenant(tenant).client.findMany();
      assert.equal(clients.length, 1, `${label} should see exactly its own client`);
      assert.equal(clients[0].tenantId, tenant);
      assert.equal(clients[0].name, `${label} customer`);
    }
  });

  test('fetching another tenant\'s row BY ID returns nothing', async () => {
    // The realistic shape of a leak: an id arrives from a URL and is looked up
    // without a tenant filter. Layer 3 is what makes that return null.
    const stolen = await forTenant(A).client.findUnique({ where: { id: `${B}-client` } });
    assert.equal(stolen, null, "tenant A must not be able to read tenant B's client by id");

    const order = await forTenant(A).fulfillmentOrder.findUnique({ where: { id: `${B}-order` } });
    assert.equal(order, null, "tenant A must not be able to read tenant B's order by id");
  });

  test('aggregates do not count another tenant\'s rows', async () => {
    // A count that ignores the boundary leaks business volume even without
    // returning a single row of data.
    assert.equal(await forTenant(A).fulfillmentOrder.count(), 1);
    assert.equal(await forTenant(A).catalogProduct.count(), 1);
    assert.equal(await forTenant(A).landingPage.count(), 1);
  });

  test('raw SQL is constrained too — where layer 2 cannot help', async () => {
    // The ERP port will land complex SQL as $queryRaw, which the client
    // extension never sees. This is the case layer 3 exists for.
    const rows = await withTenant(A, (db) =>
      (db as any).$queryRawUnsafe('SELECT "tenantId", phone FROM "Client"'),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenantId, A);
  });

  test('a deliberately hostile raw query still returns only one tenant', async () => {
    const rows = await withTenant(A, (db) =>
      (db as any).$queryRawUnsafe(`SELECT "tenantId" FROM "Client" WHERE 1=1 OR "tenantId" = '${B}'`),
    );
    assert.deepEqual([...new Set(rows.map((r: any) => r.tenantId))], [A]);
  });
});

describe('writes cannot cross a tenant boundary', { skip: !HAS_DB }, () => {
  test('a tenant cannot create a row stamped with another tenant\'s id', async () => {
    // Without WITH CHECK this succeeds: the row is invisible to its author and
    // very visible to the victim. The preflight proved the gap before the
    // policy was written.
    await assert.rejects(
      () =>
        withTenant(A, (db) =>
          (db as any).client.create({
            data: { id: 'planted', tenantId: B, phone: '0555999999', name: 'planted by A' },
          }),
        ),
      'tenant A must not be able to insert a row owned by tenant B',
    );

    const planted = await forTenant(B).client.findUnique({ where: { id: 'planted' } });
    assert.equal(planted, null, 'nothing should have reached tenant B');
  });

  test('a tenant cannot update another tenant\'s row', async () => {
    const result = await forTenant(A).client.updateMany({
      where: { id: `${B}-client` },
      data: { name: 'overwritten by A' },
    });
    assert.equal(result.count, 0, 'the update must match nothing');

    const victim = await forTenant(B).client.findUnique({ where: { id: `${B}-client` } });
    assert.equal(victim?.name, 'Beta customer', "tenant B's row is unchanged");
  });

  test('a tenant cannot delete another tenant\'s row', async () => {
    const result = await forTenant(A).fulfillmentOrder.deleteMany({ where: { id: `${B}-order` } });
    assert.equal(result.count, 0);

    const survivor = await forTenant(B).fulfillmentOrder.findUnique({ where: { id: `${B}-order` } });
    assert.ok(survivor, "tenant B's order still exists");
  });

  test('a tenant cannot move its own row to another tenant', async () => {
    await assert.rejects(
      () =>
        withTenant(A, (db) =>
          (db as any).client.update({
            where: { id: `${A}-client` },
            data: { tenantId: B },
          }),
        ),
      'reassigning tenantId is how a leak would be laundered',
    );
  });
});

describe('the tenant binding does not escape its transaction', { skip: !HAS_DB }, () => {
  test('sequential calls for different tenants do not bleed', async () => {
    // Both borrow from the same pool. If the binding were session-scoped
    // instead of transaction-scoped, the second would inherit the first.
    const a = await forTenant(A).client.findMany();
    const b = await forTenant(B).client.findMany();
    assert.equal(a[0].tenantId, A);
    assert.equal(b[0].tenantId, B);
  });

  test('concurrent calls for different tenants do not bleed', async () => {
    // The failure mode that only appears under load, and the one a low-traffic
    // test would never catch. Interleaved on purpose.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => {
        const tenant = i % 2 === 0 ? A : B;
        return forTenant(tenant)
          .client.findMany()
          .then((rows: any[]) => ({ asked: tenant, got: rows.map((r) => r.tenantId) }));
      }),
    );
    for (const { asked, got } of results) {
      assert.deepEqual(got, [asked], `a query for ${asked} returned ${got.join(',')}`);
    }
  });

  test('unscoped access reads nothing from a scoped table', async () => {
    // asPlatform() is the app role with no tenant bound, so every policy
    // compares against NULL. Reading nothing is the correct, safe answer —
    // platform code must iterate tenants explicitly.
    const leaked = await asPlatform().client.findMany();
    assert.deepEqual(leaked, [], 'an unbound connection must not read tenant data');
  });

  test('withTenant refuses an empty tenant id', async () => {
    // Otherwise app.tenant_id stays unset and every query quietly returns
    // nothing — safe, but silently wrong, which is far worse to diagnose.
    await assert.rejects(
      () => withTenant('', async () => null),
      (e: Error) => e instanceof TenantContextError,
    );
  });
});

describe('per-tenant uniqueness actually works (M-04)', { skip: !HAS_DB }, () => {
  test('two tenants can hold the same landing-page slug', async () => {
    // Both tenants were seeded with slug 'shared-slug'. If the constraint were
    // still global, seeding the second would have thrown.
    const a = await forTenant(A).landingPage.findMany();
    const b = await forTenant(B).landingPage.findMany();
    assert.equal(a[0].slug, 'shared-slug');
    assert.equal(b[0].slug, 'shared-slug');
    assert.notEqual(a[0].id, b[0].id);
  });

  test('two tenants can hold the same customer phone number', async () => {
    // The most dangerous constraint in the port. Both seeds used 0555000111.
    const a = await forTenant(A).client.findMany();
    const b = await forTenant(B).client.findMany();
    assert.equal(a[0].phone, b[0].phone);
    assert.notEqual(a[0].tenantId, b[0].tenantId);
  });

  test('one tenant still cannot reuse a slug within itself', async () => {
    await assert.rejects(
      () =>
        withTenant(A, (db) =>
          (db as any).landingPage.create({
            data: { tenantId: A, title: 'duplicate', slug: 'shared-slug', price: 1 },
          }),
        ),
      'per-tenant uniqueness must still be uniqueness',
    );
  });
});
