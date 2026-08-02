import { PrismaClient } from '../prisma/client/index.js';

/* =============================================================================
 * Layer 2 — the tenant-bound client.
 *
 * Layer 3 (RLS) already stops the database returning another tenant's rows.
 * This layer exists because "the database refused" is a 0-row result, not an
 * error: without it, a forgotten filter is a page that silently renders empty
 * rather than a bug anyone notices. It binds the tenant so that queries are
 * correct by construction, and it makes the unscoped case impossible to write
 * by accident rather than merely discouraged.
 *
 * HOW IT WORKS. Every call runs inside a transaction that first binds
 * app.tenant_id, which is what the RLS policies read. set_config(..., true) is
 * SET LOCAL — scoped to the transaction — so the binding cannot survive onto a
 * pooled connection and be picked up by the next request. The preflight proves
 * both halves of that against a real database.
 *
 * WHAT IT DOES NOT DO. It does not add `where: { tenantId }` to queries. That
 * would be a second, weaker copy of a rule the database already enforces, and
 * the two would eventually disagree. The tenant binding IS the filter.
 *
 * USAGE
 *
 *   const db = forTenant(tenantId);
 *   const orders = await db.fulfillmentOrder.findMany();   // this tenant only
 *
 * There is deliberately no way to ask this client for another tenant's data.
 * To act across tenants — migrations, platform admin, billing reconciliation —
 * use `asPlatform()`, which is separate, obvious in a diff, and named after
 * what it is.
 * ========================================================================== */

/** The setting the RLS policies compare against. */
const TENANT_SETTING = 'app.tenant_id';
/** Bound by withUser, read by Membership's self-visibility policy. */
const USER_SETTING = 'app.user_id';

let base: PrismaClient | null = null;

/**
 * The shared connection pool. Not exported: a bare client is exactly the
 * unscoped access this module exists to prevent, and every legitimate use has
 * a named entry point below.
 */
function client(): PrismaClient {
  if (!base) {
    /* PLATFORM_DATABASE_URL, not DATABASE_URL.
     *
     * During the migration a host process can hold TWO Prisma clients: the
     * website-builder's own, still pointed at its pre-tenant database, and this
     * one. Both would read DATABASE_URL and the second to load would silently
     * win, so the platform client names its connection explicitly. The fallback
     * keeps standalone use — tests, scripts, the seed — working unchanged. */
    const url = process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL;
    base = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  }
  return base;
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/** Anything the transaction callback receives — a client minus transaction control. */
export type TenantDb = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Run work bound to one tenant.
 *
 * The callback receives a client whose every query is constrained to
 * `tenantId` by the database itself. Anything it returns is returned here.
 */
export async function withTenant<T>(
  tenantId: string,
  work: (db: TenantDb) => Promise<T>,
): Promise<T> {
  if (!tenantId || typeof tenantId !== 'string') {
    // An empty tenant id would leave app.tenant_id unset, and every policy
    // compares against NULL — so the query would return nothing rather than
    // everything. Safe, but silently wrong, which is worse to debug than a
    // thrown error at the point the mistake was made.
    throw new TenantContextError('withTenant requires a tenant id');
  }

  return client().$transaction(async (tx) => {
    // Bound as a PARAMETER, never interpolated: a tenant id reaching SQL as
    // text would be an injection point on the one value the whole isolation
    // model depends on.
    await tx.$executeRawUnsafe(`SELECT set_config($1, $2, true)`, TENANT_SETTING, tenantId);
    return work(tx as unknown as TenantDb);
  });
}

/**
 * A convenience wrapper returning a proxy whose every model call is already
 * wrapped in `withTenant`. Reads more naturally at call sites that make a
 * single query:
 *
 *   const db = forTenant(tenantId);
 *   await db.landingPage.findMany();
 *
 * Each call is its own transaction. When several statements must be atomic —
 * or must see each other — use `withTenant` and issue them on the one client
 * it hands you.
 */
export function forTenant(tenantId: string): TenantDb {
  return new Proxy({} as TenantDb, {
    get(_target, model: string) {
      return new Proxy({} as any, {
        get(_t, operation: string) {
          return (...args: unknown[]) =>
            withTenant(tenantId, (db) => (db as any)[model][operation](...args));
        },
      });
    },
  });
}

/**
 * Run work bound to one USER rather than one tenant.
 *
 * Exists for exactly one problem: resolving a session. Working out which
 * tenants a person belongs to means reading Membership, but Membership is
 * tenant-scoped — and a tenant cannot be bound before the memberships that
 * would name it have been read. That is circular.
 *
 * Exempting Membership from row-level security would solve it by giving up,
 * and would let any query enumerate who works for whom. Instead Membership
 * carries a SECOND policy: a row is visible within its own tenant, OR to the
 * user it belongs to. Postgres ORs permissive policies together, so binding a
 * user id opens exactly that person's memberships and nothing else.
 *
 * Do not reach for this to sidestep a tenant binding. It grants a strictly
 * narrower view than withTenant, not a wider one.
 */
export async function withUser<T>(
  userId: string,
  work: (db: TenantDb) => Promise<T>,
): Promise<T> {
  if (!userId || typeof userId !== 'string') {
    throw new TenantContextError('withUser requires a user id');
  }
  return client().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config($1, $2, true)`, USER_SETTING, userId);
    return work(tx as unknown as TenantDb);
  });
}

/**
 * Deliberately unscoped access, for the small set of operations that are ABOUT
 * tenants rather than inside one: provisioning, billing reconciliation,
 * platform administration, and the scheduled jobs that sweep every tenant.
 *
 * Named so that it cannot appear in a diff without being noticed, and so that
 * "why is this not using forTenant?" has an answer at the call site. Note the
 * RLS policies still apply — this connection is the app role, not the owner —
 * so a query here reads nothing from a tenant-scoped table unless it binds a
 * tenant first. That is intentional: platform code should be iterating tenants
 * explicitly, not querying across them.
 */
export function asPlatform(): PrismaClient {
  return client();
}

/** Close the pool. For test teardown and graceful shutdown. */
export async function disconnect(): Promise<void> {
  if (base) {
    await base.$disconnect();
    base = null;
  }
}
