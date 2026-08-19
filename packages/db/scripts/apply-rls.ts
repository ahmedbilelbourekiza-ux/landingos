/* =============================================================================
 * Layer 3 — Postgres row-level security (M-07).
 *
 * The architecture's third isolation layer, and the only one that survives a
 * bug in the other two. Layer 1 is tenantId columns and indexes; layer 2 is a
 * Prisma client extension that injects the filter; layer 3 is this — the
 * database itself refusing to return another tenant's rows no matter what
 * query reaches it, including raw SQL.
 *
 * That last part is why it is not optional here. The ERP port will carry over
 * genuinely complex SQL — FIFO lot consumption, financial aggregation, the
 * payroll rollup — that lands as $queryRaw and therefore bypasses layer 2
 * entirely.
 *
 * THE TABLE LIST IS DERIVED, NOT WRITTEN DOWN. Every table with a tenantId
 * column gets a policy, discovered from the live database. A table added in a
 * later migration is covered the next time this runs, rather than only if
 * somebody remembers to add it to a list.
 *
 * Both USING and WITH CHECK, deliberately. USING governs what a tenant can
 * SEE; without WITH CHECK they can still INSERT a row stamped with another
 * tenant's id — invisible to them afterwards and very visible to the victim.
 * The preflight proved that gap is real before this was written.
 *
 * Idempotent. Run after every schema change:
 *   npm run rls --workspace @landingos/db
 * ========================================================================== */

import { PrismaClient } from '../prisma/client/index.js';

const POLICY = 'tenant_isolation';
const SETTING = 'app.tenant_id';

/**
 * Tables that deliberately have no tenantId, and therefore no policy. Every
 * one is either platform-owned reference data or part of resolving WHO the
 * caller is — which necessarily happens before a tenant is known, so a
 * tenant-scoped policy on them would be unsatisfiable rather than safe.
 *
 * These are protected by the application's auth layer instead: a session is
 * reachable only by presenting its token, and Membership — which IS
 * tenant-scoped and IS covered below — is what turns a user into access to a
 * particular tenant.
 */
const EXPECTED_UNSCOPED = new Set([
  'Tenant',  // a user must be able to list the tenants they belong to
  'User',    // global identity; resolved before any tenant is chosen
  'Session', // looked up by token hash, before a tenant is known
  'Wilaya',  // platform reference data, shared by every tenant
  'Baladia', // platform reference data, shared by every tenant
  // The OPERATOR's own secrets (encrypted at rest), not any tenant's — a
  // tenant-scoped policy would be unsatisfiable, and no route ever selects
  // the value column into a response (LB.14c option b).
  'PlatformCredential',
]);

const prisma = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });

async function main() {
  if (!process.env.MIGRATE_DATABASE_URL) {
    throw new Error('MIGRATE_DATABASE_URL is required — RLS is DDL and the app role cannot perform it');
  }

  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const scoped: string[] = [];
  const unscoped: string[] = [];
  for (const { table_name } of tables) {
    const [col] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name='tenantId'`,
      table_name,
    );
    (col ? scoped : unscoped).push(table_name);
  }

  console.log(`${tables.length} tables — ${scoped.length} tenant-scoped, ${unscoped.length} not`);

  // A table that quietly lost its tenantId would quietly lose its policy, so
  // the unscoped set is asserted rather than reported.
  const unexpected = unscoped.filter((t) => !EXPECTED_UNSCOPED.has(t));
  if (unexpected.length) {
    throw new Error(
      `these tables have no tenantId and are not on the expected list: ${unexpected.join(', ')}\n` +
        `Either add tenantId, or add them to EXPECTED_UNSCOPED with a reason.`,
    );
  }
  const missing = [...EXPECTED_UNSCOPED].filter((t) => !unscoped.includes(t));
  if (missing.length) {
    console.log(`  note: expected-unscoped tables no longer present or now scoped: ${missing.join(', ')}`);
  }

  let applied = 0;
  for (const table of scoped) {
    // ENABLE turns the policy on for everyone but the table's owner; FORCE
    // closes that hole. The app role is already a non-owner, so this is the
    // second independent reason the policy holds rather than the only one.
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS ${POLICY} ON "${table}"`);
    await prisma.$executeRawUnsafe(`
      CREATE POLICY ${POLICY} ON "${table}"
        FOR ALL
        USING      ("tenantId" = current_setting('${SETTING}', true))
        WITH CHECK ("tenantId" = current_setting('${SETTING}', true))
    `);
    applied++;
  }

  /* Membership needs a second, narrower policy.
   *
   * Resolving a session means reading which tenants a user belongs to — but
   * that read cannot bind a tenant, because the memberships are what NAME the
   * tenants. Exempting the table from RLS would solve the circularity by
   * giving up, and would let any query enumerate who works for whom.
   *
   * Postgres ORs permissive policies, so this adds "or the user it belongs to"
   * alongside the tenant policy. withUser() in @landingos/db binds app.user_id
   * and is the only thing that opens it. Read-only: a user may SEE their own
   * memberships, never grant themselves one. */
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS ${POLICY}_self ON "Membership"`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY ${POLICY}_self ON "Membership"
      FOR SELECT
      USING ("userId" = current_setting('app.user_id', true))
  `);
  console.log('Membership: added self-visibility policy for session resolution');

  /* Invitation needs a second, narrower policy — the same shape as Membership's
   * _self, for a different circularity.
   *
   * An invitation link is followed BEFORE any session exists, so it must be
   * resolved by its token rather than by the tenant it belongs to. But
   * Invitation is tenant-scoped, and the tenant cannot be bound before the row
   * that names it has been read — and binding the inviting tenant would also be
   * wrong, because the accepter is not yet a member of it and must not see any
   * other invitation that tenant has issued.
   *
   * Exempting the table from RLS would solve that by giving up, and would let
   * any query enumerate every outstanding invitation on the platform. Instead
   * this adds "or the token matches" alongside the tenant policy, opening
   * EXACTLY the one row whose token was presented and nothing else.
   * withInvitationToken() in @landingos/db binds app.invitation_token and is
   * the only thing that opens it. Read-only by construction: FOR SELECT, so a
   * holder of a token can read the invitation it names but cannot INSERT,
   * UPDATE or DELETE through this policy — the tenant policy's WITH CHECK
   * still governs every write. */
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS ${POLICY}_token ON "Invitation"`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY ${POLICY}_token ON "Invitation"
      FOR SELECT
      USING ("token" = current_setting('app.invitation_token', true))
  `);
  console.log('Invitation: added token-resolution policy for join flow');

  /* TenantDomain needs a third special case — the same circularity class as
   * the two above, found live on 10 Aug 2026 (CAPABILITY_AUDIT B5 follow-up).
   *
   * Resolving a custom domain is what DISCOVERS the tenant, so it necessarily
   * happens before any tenant is bound — and under the plain tenant policy
   * the unbound read returned nothing, which left `tenantByDomain` refusing
   * VERIFIED rows too: the whole custom-domain read path was safe but dead,
   * unnoticed for as long as no row could exist.
   *
   * A VERIFIED domain is public by construction — the hostname serves that
   * tenant's storefront to the whole internet and the mapping is readable in
   * DNS — so what this policy opens is not secret. But it must still be
   * GATED ON THE BINDING, exactly like the two above, and the reason is worth
   * stating because the first version of this policy got it wrong and the
   * suite caught it the same night:
   *
   *   Postgres ORs permissive policies. `USING ("verifiedAt" IS NOT NULL)`
   *   with no binding guard does not merely open the unbound lookup — it adds
   *   every verified row to what a TENANT-BOUND read sees, so the console's
   *   own domains list would show other companies' hostnames. Measured: a
   *   tenant owning nothing saw another tenant's domain.
   *
   * With the guard, the row opens only inside withVerifiedDomains() — the one
   * code path that resolves a hostname before a tenant is known.
   * `current_setting(..., true)` yields NULL when unset, so every other
   * context (bound or unbound) falls through to the tenant policy alone.
   *
   * Unverified rows — which carry the verification tokens mid-proof — stay
   * readable only through their own tenant's binding, and every write is
   * still governed by the tenant policy's WITH CHECK (FOR SELECT here). */
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS ${POLICY}_verified ON "TenantDomain"`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY ${POLICY}_verified ON "TenantDomain"
      FOR SELECT
      USING (
        "verifiedAt" IS NOT NULL
        AND current_setting('app.domain_lookup', true) = 'on'
      )
  `);
  console.log('TenantDomain: added verified-domain resolution policy for storefront routing');

  console.log(`policies applied to ${applied} tables (USING + WITH CHECK, FORCE enabled)`);
  console.log('not scoped, by design: ' + unscoped.join(', '));

  // Verify rather than trust. A policy that exists but is not FORCEd, or that
  // has no WITH CHECK, would leave exactly the gaps this script exists to close.
  const [audit] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      count(*) FILTER (WHERE c.relrowsecurity)                          AS enabled,
      count(*) FILTER (WHERE c.relforcerowsecurity)                     AS forced,
      count(*) FILTER (WHERE p.polname IS NOT NULL)                     AS with_policy,
      count(*) FILTER (WHERE p.polwithcheck IS NOT NULL)                AS with_check
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = '${POLICY}'
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema='public' AND col.table_name=c.relname
                    AND col.column_name='tenantId')
  `);

  const n = scoped.length;
  const rows = [
    ['RLS enabled', Number(audit.enabled)],
    ['FORCE enabled', Number(audit.forced)],
    ['policy present', Number(audit.with_policy)],
    ['WITH CHECK present', Number(audit.with_check)],
  ] as const;

  let bad = 0;
  for (const [label, got] of rows) {
    const okay = got === n;
    if (!okay) bad++;
    console.log(`  ${okay ? 'PASS' : 'FAIL'}  ${label}: ${got}/${n}`);
  }

  if (bad) throw new Error('row-level security is not fully applied — see the failures above');
  console.log('\nLayer 3 is in place on every tenant-scoped table.');
}

main()
  .catch((e) => {
    console.error('\napply-rls failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
