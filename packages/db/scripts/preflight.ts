/* =============================================================================
 * Phase 3.3 preflight — answers R-05 before anything is built on it.
 *
 * The architecture names R-05 the highest-risk unknown in the programme:
 * "Prisma has no first-class way to set a per-connection session variable...
 * Prototype this in the first week — if it proves unworkable, L2 becomes the
 * primary control and the plan must know that early, not late."
 *
 * This is that prototype, and it uses BOTH roles exactly the way the running
 * platform will:
 *
 *   owner (MIGRATE_DATABASE_URL)  creates the fixture, enables RLS, writes the
 *                                 policy. Never serves a request.
 *   app   (DATABASE_URL)          runs every isolation check. This is the role
 *                                 Prisma Client uses at runtime, and the one
 *                                 RLS has to actually constrain.
 *
 * That split is not incidental. A role with BYPASSRLS — which is what Neon's
 * default neondb_owner carries — ignores row-level security entirely, so
 * policies are never consulted and an isolation suite passes while enforcing
 * nothing. Running these checks as the owner would prove precisely nothing.
 *
 * Run:  npm run preflight --workspace @landingos/db
 *
 * Writes nothing outside a scratch schema it creates and drops.
 * ========================================================================== */

import { PrismaClient } from '../prisma/client/index.js';

const SCRATCH = '_preflight';
const APP_ROLE = 'landingos_app';

const ownerUrl = process.env.MIGRATE_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;

let failures = 0;
const ok = (l: string, d = '') => console.log(`  PASS  ${l}${d ? ' — ' + d : ''}`);
const bad = (l: string, d = '') => { failures++; console.log(`  FAIL  ${l}${d ? ' — ' + d : ''}`); };
const info = (l: string, d = '') => console.log(`  ..    ${l}${d ? ' — ' + d : ''}`);

const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
const app = new PrismaClient({ datasources: { db: { url: appUrl } } });

async function buildFixture() {
  await owner.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`);
  await owner.$executeRawUnsafe(`CREATE SCHEMA ${SCRATCH}`);
  await owner.$executeRawUnsafe(
    `CREATE TABLE ${SCRATCH}.row (id int primary key, tenant_id text not null, secret text)`,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO ${SCRATCH}.row VALUES (1,'tenant-a','a-secret'), (2,'tenant-b','b-secret')`,
  );

  // ENABLE turns the policy on for everyone except the table's owner; FORCE
  // closes that hole. Both are applied because Phase 3.3 will apply both: the
  // app role is already not an owner, so this is the second independent reason
  // the policy holds rather than the only one.
  await owner.$executeRawUnsafe(`ALTER TABLE ${SCRATCH}.row ENABLE ROW LEVEL SECURITY`);
  await owner.$executeRawUnsafe(`ALTER TABLE ${SCRATCH}.row FORCE ROW LEVEL SECURITY`);
  await owner.$executeRawUnsafe(`
    CREATE POLICY tenant_isolation ON ${SCRATCH}.row
      USING (tenant_id = current_setting('app.tenant_id', true))
  `);

  await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${SCRATCH} TO ${APP_ROLE}`);
  await owner.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${SCRATCH}.row TO ${APP_ROLE}`,
  );
}

async function main() {
  if (!ownerUrl || !appUrl) {
    throw new Error('Both DATABASE_URL and MIGRATE_DATABASE_URL must be set — run setup:roles first');
  }

  console.log('\n=== 1. Who is the application connected as? ===');
  const [who] = await app.$queryRawUnsafe<any[]>(`
    SELECT current_user AS role, current_database() AS db, version() AS version,
           (SELECT rolsuper      FROM pg_roles WHERE rolname = current_user) AS is_superuser,
           (SELECT rolbypassrls  FROM pg_roles WHERE rolname = current_user) AS bypasses_rls
  `);
  info('connected', `${who.role}@${who.db}`);
  info('server', String(who.version).split(' ').slice(0, 2).join(' '));

  console.log('\n=== 2. Would RLS actually apply to it? ===');
  who.is_superuser
    ? bad('role is a SUPERUSER', 'RLS is bypassed unconditionally')
    : ok('role is not a superuser');
  who.bypasses_rls
    ? bad('role has BYPASSRLS', 'policies would never be consulted')
    : ok('role does not have BYPASSRLS');

  await buildFixture();

  console.log('\n=== 3. Does the policy deny by default? ===');
  const unset = await app.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${SCRATCH}.row`);
  unset[0].n === 0
    ? ok('with no tenant bound, the table reads empty', 'deny-by-default holds')
    : bad('rows visible with no tenant bound', `saw ${unset[0].n} of 2`);

  console.log('\n=== 4. Can Prisma scope a transaction to one tenant? (R-05) ===');
  const seen = await app.$transaction(async (tx) => {
    // set_config(..., true) is SET LOCAL — transaction-scoped — and unlike
    // SET LOCAL it takes a bound parameter, so a tenant id can never be
    // interpolated into SQL.
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, 'tenant-a');
    return tx.$queryRawUnsafe<any[]>(`SELECT id, tenant_id, secret FROM ${SCRATCH}.row ORDER BY id`);
  });
  seen.length === 1 && seen[0].tenant_id === 'tenant-a'
    ? ok('a transaction bound to tenant-a sees only tenant-a', '1 of 2 rows')
    : bad('tenant scoping did not hold', JSON.stringify(seen));

  const multi = await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, 'tenant-b');
    await tx.$queryRawUnsafe(`SELECT 1`);
    await tx.$queryRawUnsafe(`SELECT 1`);
    return tx.$queryRawUnsafe<any[]>(`SELECT tenant_id FROM ${SCRATCH}.row`);
  });
  multi.length === 1 && multi[0].tenant_id === 'tenant-b'
    ? ok('the binding survives every statement in the transaction')
    : bad('the binding did not survive the transaction', JSON.stringify(multi));

  console.log('\n=== 5. Writes are constrained too, not just reads ===');
  // A policy with only USING governs what is VISIBLE. Without WITH CHECK, a
  // tenant can still INSERT a row belonging to another tenant — invisible to
  // them afterwards, and very visible to the victim.
  let wrote = false;
  try {
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, 'tenant-a');
      await tx.$executeRawUnsafe(
        `INSERT INTO ${SCRATCH}.row VALUES (99,'tenant-b','planted-by-a')`,
      );
      wrote = true;
    });
  } catch { /* rejected, which is what we want */ }
  wrote
    ? bad('tenant-a inserted a row owned by tenant-b', 'a USING-only policy does not constrain writes — Phase 3.3 needs WITH CHECK')
    : ok('tenant-a cannot insert a row owned by tenant-b');

  console.log('\n=== 6. Does the binding leak to the next user of the connection? ===');
  // The decisive one. A bare SET, or set_config(...,false), persists on a
  // pooled connection, so the next request to borrow it reads another tenant's
  // rows — a leak that only appears under concurrency.
  const after = await app.$queryRawUnsafe<any[]>(
    `SELECT current_setting('app.tenant_id', true) AS leaked`,
  );
  after[0]?.leaked
    ? bad('a tenant binding LEAKED past its transaction', `app.tenant_id = "${after[0].leaked}"`)
    : ok('no binding survives the transaction', 'SET LOCAL semantics confirmed');

  const outside = await app.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${SCRATCH}.row`);
  outside[0].n === 0
    ? ok('unscoped access still reads nothing')
    : bad('unscoped access reads rows', `saw ${outside[0].n}`);

  console.log('\n=== 7. The owner is deliberately NOT constrained ===');
  // Migrations and backfills have to see everything. Stating it as a check so
  // the asymmetry is a decision on the record rather than a surprise later.
  const ownerSees = await owner.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${SCRATCH}.row`);
  ownerSees[0].n === 2
    ? ok('the migration role sees every row', 'expected — it never serves a request')
    : info('the migration role is also constrained', `saw ${ownerSees[0].n}`);

  await owner.$executeRawUnsafe(`DROP SCHEMA ${SCRATCH} CASCADE`);

  console.log('\n' + '='.repeat(66));
  if (failures === 0) {
    console.log('R-05 RESOLVED — Prisma enforces per-transaction tenant isolation.');
    console.log('Layer 3 (RLS) is viable. Phase 3.3 proceeds as designed.');
  } else {
    console.log(`R-05 UNRESOLVED — ${failures} check(s) failed.`);
    console.log('Do not build on layer 3 until these are understood; the');
    console.log('architecture requires falling back to L2 as the primary control.');
  }
  console.log('='.repeat(66) + '\n');
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch(async (e) => {
    console.error('\nPreflight aborted:', e.message);
    try { await owner.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`); } catch {}
    process.exitCode = 1;
  })
  .finally(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });
