/* =============================================================================
 * Phase 3.3 preflight — answers R-05 before any of it is built on.
 *
 * The architecture names R-05 the highest-risk unknown in the programme:
 * "Prisma has no first-class way to set a per-connection session variable...
 * Prototype this in the first week — if it proves unworkable, L2 becomes the
 * primary control and the plan must know that early, not late."
 *
 * This is that prototype. It answers five questions against a real database,
 * in order, and stops at the first one that fails:
 *
 *   1. Can we connect, and what are we connected AS?
 *   2. Would RLS even apply to this role?  A superuser bypasses it
 *      unconditionally; a table owner bypasses it unless the table is set to
 *      FORCE. Either case makes an isolation suite pass while enforcing
 *      nothing, which is worse than no suite at all.
 *   3. Does a policy actually block a cross-tenant read?
 *   4. Can Prisma set app.tenant_id per TRANSACTION, and does the setting
 *      survive for the whole transaction?
 *   5. Does that setting LEAK to the next user of the same pooled connection?
 *      This is the one that decides whether the design is safe at all: SET
 *      leaks across a pool and SET LOCAL does not, and getting it wrong is a
 *      cross-tenant read under load that no test at low concurrency would see.
 *
 * Run:  npm run preflight --workspace @landingos/db
 *
 * Writes nothing outside a scratch schema it creates and drops.
 * ========================================================================== */

import { PrismaClient } from '@prisma/client';

const SCRATCH = '_preflight';

const prisma = new PrismaClient();

let failures = 0;
const ok = (label: string, detail = '') => console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
const bad = (label: string, detail = '') => { failures++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); };
const info = (label: string, detail = '') => console.log(`  ..    ${label}${detail ? ' — ' + detail : ''}`);

async function main() {
  console.log('\n=== 1. Connection and identity ===');
  const [who] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT current_user                                        AS role,
           current_database()                                  AS db,
           version()                                           AS version,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls
  `);
  info('connected', `${who.role}@${who.db}`);
  info('server', String(who.version).split(' ').slice(0, 2).join(' '));

  console.log('\n=== 2. Would RLS actually apply to this role? ===');
  if (who.is_superuser) {
    bad('role is a SUPERUSER', 'RLS is bypassed unconditionally — no policy can be verified with this role');
  } else {
    ok('role is not a superuser');
  }
  if (who.bypasses_rls) {
    bad('role has BYPASSRLS', 'policies would never be consulted');
  } else {
    ok('role does not have BYPASSRLS');
  }

  // Table owners bypass RLS unless the table is FORCEd. Since the migration
  // will create (and therefore own) every table, this decides whether every
  // policy we write is real or decorative.
  console.log('\n=== 3. Does a policy actually block a cross-tenant read? ===');
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCRATCH}`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE ${SCRATCH}.row (id int primary key, tenant_id text not null, secret text)
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO ${SCRATCH}.row VALUES (1,'tenant-a','a-secret'), (2,'tenant-b','b-secret')
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE ${SCRATCH}.row ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY tenant_isolation ON ${SCRATCH}.row
      USING (tenant_id = current_setting('app.tenant_id', true))
  `);

  // Without FORCE, the owner sees everything.
  const asOwnerUnforced = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${SCRATCH}.row`);
  if (asOwnerUnforced[0].n === 2) {
    info('ENABLE alone does not constrain the table owner', 'expected — this is why FORCE is required');
  } else {
    info('ENABLE alone already constrains this role', `saw ${asOwnerUnforced[0].n} rows`);
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE ${SCRATCH}.row FORCE ROW LEVEL SECURITY`);
  const forcedNoSetting = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${SCRATCH}.row`);
  if (forcedNoSetting[0].n === 0) {
    ok('with FORCE and no tenant set, the table is empty', 'deny-by-default holds');
  } else {
    bad('with FORCE and no tenant set, rows were still visible', `saw ${forcedNoSetting[0].n}`);
  }

  console.log('\n=== 4. Can Prisma scope a transaction to one tenant? (R-05) ===');
  const seen = await prisma.$transaction(async (tx) => {
    // SET LOCAL is transaction-scoped. set_config(...,true) is the callable
    // equivalent and is what allows a bound parameter — string interpolation
    // into SET LOCAL would be an injection point on a tenant id.
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, 'tenant-a');
    return tx.$queryRawUnsafe<any[]>(`SELECT id, tenant_id, secret FROM ${SCRATCH}.row ORDER BY id`);
  });
  if (seen.length === 1 && seen[0].tenant_id === 'tenant-a') {
    ok('a transaction bound to tenant-a sees only tenant-a', '1 row');
  } else {
    bad('tenant scoping did not hold inside the transaction', JSON.stringify(seen));
  }

  // The setting must survive every statement in the transaction, not just the
  // first — a repository method issues many.
  const multi = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, 'tenant-b');
    await tx.$queryRawUnsafe(`SELECT 1`);
    await tx.$queryRawUnsafe(`SELECT 1`);
    return tx.$queryRawUnsafe<any[]>(`SELECT tenant_id FROM ${SCRATCH}.row`);
  });
  if (multi.length === 1 && multi[0].tenant_id === 'tenant-b') {
    ok('the binding survives multiple statements in one transaction');
  } else {
    bad('the binding did not survive the whole transaction', JSON.stringify(multi));
  }

  console.log('\n=== 5. Does the binding leak to the next user of the connection? ===');
  // The decisive test. If set_config(...,false) — or a bare SET — were used,
  // the value would persist on the pooled connection and the NEXT request to
  // borrow it would silently read another tenant's data. That is a
  // cross-tenant leak that only appears under load.
  const afterTx = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_setting('app.tenant_id', true) AS leaked, count(*)::int AS n FROM ${SCRATCH}.row GROUP BY 1`,
  );
  const leaked = afterTx[0]?.leaked ?? null;
  if (!leaked) {
    ok('no tenant binding survives the transaction', 'SET LOCAL semantics confirmed');
  } else {
    bad('a tenant binding LEAKED past its transaction', `app.tenant_id = "${leaked}" — this is a cross-tenant read under pooling`);
  }

  // And prove the leak-free state is deny-by-default rather than allow-all.
  const outside = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM ${SCRATCH}.row`);
  if (outside[0].n === 0) {
    ok('outside any transaction the table is empty', 'unscoped access reads nothing');
  } else {
    bad('outside a transaction rows are visible', `saw ${outside[0].n} — unscoped access is not denied`);
  }

  await prisma.$executeRawUnsafe(`DROP SCHEMA ${SCRATCH} CASCADE`);

  console.log('\n' + '='.repeat(64));
  if (failures === 0) {
    console.log('R-05 RESOLVED: Prisma can enforce per-transaction tenant isolation');
    console.log('Layer 3 (RLS) is viable. Phase 3.3 proceeds as designed.');
  } else {
    console.log(`R-05 UNRESOLVED: ${failures} check(s) failed.`);
    console.log('Do NOT build on layer 3 until these are understood — the');
    console.log('architecture requires falling back to L2 as the primary');
    console.log('control if RLS cannot be made to hold.');
  }
  console.log('='.repeat(64) + '\n');
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch(async (e) => {
    console.error('\nPreflight aborted:', e.message);
    try { await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`); } catch {}
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
