import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaClient } from '../prisma/client/index.js';
import { withTenant, asPlatform, disconnect } from '../src/tenant-client.ts';
import { deleteTenant } from '../src/delete-tenant.ts';

/* =============================================================================
 * A deleted tenant leaves ZERO rows behind.
 *
 * The defect this pins: `tenant.delete` cascades platform rows and nothing
 * else — product-domain tables reference the tenant by an RLS-scoped column,
 * not an FK, so pages, orders, clients and settings all survive as orphans.
 * Measured before the fix: 73,267 orphaned rows from 4,149 dead tenants in
 * the dev database, left by a test harness whose own comment claimed the
 * cascade existed.
 *
 * The zero-rows assertion is deliberately DATABASE-derived: every table with
 * a `tenantId` column, from information_schema, counted through the OWNER
 * connection so RLS cannot hide a leftover. A scoped table added later is
 * asserted on without anyone remembering to list it.
 *
 * Requires DATABASE_URL (the app role) and MIGRATE_DATABASE_URL (the owner).
 * Skips rather than fails without them, so `npm test` still runs offline.
 * ========================================================================== */

const HAS_DB = Boolean(process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL);
const skip = HAS_DB ? false : 'needs DATABASE_URL + MIGRATE_DATABASE_URL';
const owner = HAS_DB
  ? new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } })
  : (null as any);

const STAMP = Date.now();
const madeTenants: string[] = [];

/** Every BASE TABLE carrying a tenantId column — the database's own list. */
async function scopedTables(): Promise<string[]> {
  const rows = await owner.$queryRawUnsafe(`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
      AND t.table_type = 'BASE TABLE' AND c.table_name <> 'Tenant'
  `) as { table_name: string }[];
  return rows.map((r) => r.table_name);
}

async function rowsFor(tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of await scopedTables()) {
    const [{ count }] = (await owner.$queryRawUnsafe(
      `SELECT count(*)::bigint AS count FROM "${table}" WHERE "tenantId" = $1`,
      tenantId,
    )) as { count: bigint }[];
    if (count > 0n) out[table] = Number(count);
  }
  return out;
}

/** A tenant with rows fanned across both product domains. */
async function seed(label: string): Promise<string> {
  const id = `del-tenant-${label}-${STAMP}`;
  madeTenants.push(id);
  await asPlatform().tenant.create({ data: { id, slug: id, name: `Delete ${label}` } });
  const wilaya = await asPlatform().wilaya.findFirst({ select: { id: true } });

  await withTenant(id, async (db) => {
    const page = await (db as any).landingPage.create({
      data: { tenantId: id, title: `${label} page`, slug: `${label}-page`, price: 2900 },
      select: { id: true },
    });
    // A child of the page AND of reference data — the row shape that survived
    // the production tenant delete on 12 August.
    if (wilaya) {
      await (db as any).landingDeliveryPrice.create({
        data: { tenantId: id, landingPageId: page.id, wilayaId: wilaya.id, homePrice: 900 },
      });
      await (db as any).tenantDeliveryPrice.create({
        data: { tenantId: id, wilayaId: wilaya.id, homePrice: 500, deskPrice: 300 },
      });
    }
    await (db as any).client.create({
      data: { tenantId: id, phone: '0555112233', name: `${label} customer` },
    });
    await (db as any).fulfillmentOrder.create({
      data: { tenantId: id, client: `${label} buyer`, phone: '0555112233', price: 2900 },
    });
    await (db as any).catalogProduct.create({
      data: { tenantId: id, name: `${label} product`, price: 500 },
    });
    await (db as any).productSetting.create({
      data: { tenantId: id, product: 'erp', key: 'financeEnabled', value: true },
    });
  });
  return id;
}

after(async () => {
  if (!HAS_DB) return;
  for (const id of madeTenants) {
    await deleteTenant(id).catch(() => {});
  }
  await owner.$disconnect();
  await disconnect();
});

describe('deleteTenant leaves zero rows behind', { skip }, () => {
  test('the sweep empties every scoped table, then the Tenant row', async () => {
    const id = await seed('full');

    const before = await rowsFor(id);
    assert.ok(Object.keys(before).length >= 5, `seed produced rows: ${JSON.stringify(before)}`);

    const result = await deleteTenant(id);
    assert.equal(result.tenantRowDeleted, true, 'the Tenant row existed and was deleted');
    assert.ok(result.rowsDeleted >= 6, `swept the seeded rows (got ${result.rowsDeleted})`);

    const leftovers = await rowsFor(id);
    assert.deepEqual(leftovers, {}, `rows survived deletion: ${JSON.stringify(leftovers)}`);
    assert.equal(await owner.tenant.count({ where: { id } }), 0, 'the Tenant row is gone');
  });

  test('a bare tenant.delete DOES orphan product rows — the defect, pinned', async () => {
    // If this test ever fails because the orphans stopped appearing, an FK
    // cascade to Tenant has been added; deleteTenant and its docs should be
    // revisited together with that change.
    const id = await seed('orphan');

    await asPlatform().tenant.delete({ where: { id } });
    const orphans = await rowsFor(id);
    assert.ok(
      Object.keys(orphans).length > 0,
      'tenant.delete alone should have left orphans (has an FK cascade been added?)',
    );

    // And deleteTenant cleans up after it — the Tenant row already being gone
    // is tolerated, because that is exactly the orphan-cleanup case.
    const result = await deleteTenant(id);
    assert.equal(result.tenantRowDeleted, false, 'no Tenant row left to delete');
    assert.ok(result.rowsDeleted > 0, 'the orphans were swept');
    assert.deepEqual(await rowsFor(id), {}, 'nothing remains');
  });
});
