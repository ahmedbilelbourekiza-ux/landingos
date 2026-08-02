import { test as nodeTest, type TestContext } from 'node:test';

import { asPlatform, withTenant, disconnect } from '@landingos/db';
import { createSession, destroySessionsForUser, SESSION_COOKIE, hashPassword } from '@landingos/auth';

/* =============================================================================
 * test/erp/helpers.ts — the ERP contract-test harness (M-18).
 *
 * The counterpart of apps/erp/test/helpers.js, and deliberately much smaller.
 * That one had to boot a real Express server as a child process against a
 * throwaway SQLite file, because the ERP's only isolation between test runs was
 * a separate database file. Here the isolation IS the tenant: every run creates
 * its own, and row-level security guarantees nothing it writes is visible to
 * anything else. So there is no process to spawn, no port to pick, no
 * write-ahead log to checkpoint, and no cleanup that can leave a file locked.
 *
 * What this file owes the suite:
 *
 *   1. Tenants, with the entitlements a test needs and no others.
 *   2. Users shaped like the ERP's — a MANAGER and an AGENT — under the
 *      platform's role model. See PORTING.md for the mapping and for D-05.1,
 *      the place where the two models disagree.
 *   3. One `api()` that carries a platform session cookie.
 *   4. The mount probe, below.
 *
 * ========================================================================== */

export const BASE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3000';

/** The permissions an ERP confirmation/follow-up agent needs to do their job.
 *
 * `MEMBER` grants reads by role glob but no writes at all, and an agent must log
 * calls and correct the details of their own orders. Granting exactly this — by
 * name, on the membership — is narrower than promoting them to `MANAGER`, which
 * would hand over every `*:*:write` in every product the tenant owns. */
export const AGENT_GRANTS = ['erp:orders:write'] as const;

export interface Caller {
  readonly userId: string;
  readonly token: string;
  /** Fetch bound to this caller's session. Returns the parsed envelope. */
  readonly api: ApiFn;
}

export interface ApiResult {
  readonly status: number;
  // Deliberately `any`: these tests assert on response shapes that do not exist
  // yet, and typing them here would be inventing the contract in the wrong file.
  readonly body: any;
  readonly headers: Headers;
}

type ApiFn = (method: string, path: string, body?: unknown, init?: RequestInit) => Promise<ApiResult>;

/** An unauthenticated call. */
export const anon: ApiFn = (method, path, body, init = {}) => call(method, path, body, undefined, init);

async function call(
  method: string,
  path: string,
  body: unknown,
  token: string | undefined,
  init: RequestInit = {},
): Promise<ApiResult> {
  const res = await fetch(BASE + path, {
    ...init,
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(init.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}

/* -----------------------------------------------------------------------------
 * Preconditions
 *
 * Three separate questions, answered separately, because collapsing them
 * produces a skip message that does not say what to fix.
 * -------------------------------------------------------------------------- */

const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);

const SERVER_UP = await fetch(BASE + '/console/login', { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false);

/**
 * Is the ERP API mounted yet?
 *
 * An unmatched route in Next is a 404. A mounted `tenantRoute` with no session
 * is a 401. That difference is the whole probe, and it needs no cooperation
 * from the routes themselves — no health endpoint to remember to add, nothing
 * to keep in sync.
 *
 * Until Phase 5.3 lands the routes this is false and the suite skips. Setting
 * ERP_CONTRACT=strict turns the skip into a failure, which is what CI should do
 * from the moment 5.3 starts: a contract suite that is allowed to stay silent
 * is a contract suite nobody notices has stopped running.
 */
const ERP_MOUNTED = SERVER_UP
  ? await fetch(BASE + '/api/erp/orders', { redirect: 'manual' })
      .then((r) => r.status !== 404)
      .catch(() => false)
  : false;

const STRICT = process.env.ERP_CONTRACT === 'strict';

if (STRICT && SERVER_UP && HAS_DB && !ERP_MOUNTED) {
  throw new Error(
    'ERP_CONTRACT=strict: /api/erp/* is not mounted. ' +
      'The ported ERP contract suite cannot run. See test/erp/PORTING.md.',
  );
}

/**
 * Why this suite is not running, or `false` if it is.
 *
 * A string rather than a boolean on purpose — node:test prints it, so the run
 * says WHY the suite did not execute instead of quietly reporting a smaller
 * number than yesterday.
 */
export const skip: string | false = !HAS_DB
  ? 'no PLATFORM_DATABASE_URL — this suite runs against the real database'
  : !SERVER_UP
    ? `no server on ${BASE} — start it with: npm run builder:start`
    : !ERP_MOUNTED
      ? 'the ERP API is not mounted yet (Phase 5.3, M-11) — see test/erp/PORTING.md'
      : false;

/**
 * Every test in this directory is declared with this, not with `node:test`'s
 * `test` directly.
 *
 * The reason is countability. Skipping a whole `describe` makes node report
 * `suites 8, tests 0` — the ported tests vanish from the run rather than
 * appearing as skipped, so nobody can tell from the output whether this suite
 * contains a hundred tests or none. Skipping each test individually reports
 * `tests 130, skipped 130`, which says exactly what is waiting on Phase 5.3.
 *
 * That distinction is the whole point of the file: a contract suite whose
 * absence is invisible is a contract suite that will be quietly deleted.
 */
export function contractTest(name: string, fn: (t: TestContext) => unknown | Promise<unknown>) {
  return nodeTest(name, { skip }, fn as (t: TestContext) => void);
}

/* -----------------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------------- */

const stamp = Date.now().toString(36);
let seq = 0;
/** A value unique across this run — the ERP's `uid()`, same job. */
export const uid = () => `${stamp}${(seq++).toString(36)}`;

/** A phone number in the local form the ERP normalises to. */
export const phone = () => '05' + Math.floor(10000000 + Math.random() * 89999999);

const createdTenants: string[] = [];
const createdUsers: string[] = [];

/** A tenant holding exactly the entitlements named, and nothing else. */
export async function makeTenant(label: string, entitlements: string[] = ['product.erp']) {
  const slug = `erp-${label}-${uid()}`;
  const tenant = await asPlatform().tenant.create({ data: { slug, name: slug } });
  createdTenants.push(tenant.id);
  await withTenant(tenant.id, (tx) =>
    (tx as any).subscription.create({
      data: { tenantId: tenant.id, status: 'ACTIVE', entitlements },
    }),
  );
  return tenant.id;
}

interface MemberOptions {
  /** Platform role. See the mapping table in PORTING.md. */
  readonly role?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER';
  /** Extra permissions on the membership, granted by name. */
  readonly permissions?: readonly string[];
  /** The ERP's JOB role — confirmation | followup | both. Not a privilege. */
  readonly jobRole?: string;
}

/** A user with a membership and a live session in `tenantId`. */
export async function makeMember(tenantId: string, opts: MemberOptions = {}): Promise<Caller> {
  const email = `erp-${uid()}@landingos.test`;
  const user = await asPlatform().user.create({
    data: { email, name: email, passwordHash: await hashPassword('devpassword123') },
  });
  createdUsers.push(user.id);

  await withTenant(tenantId, (tx) =>
    (tx as any).membership.create({
      data: {
        tenantId,
        userId: user.id,
        role: opts.role ?? 'MEMBER',
        permissions: [...(opts.permissions ?? [])],
        jobRole: opts.jobRole ?? null,
      },
    }),
  );

  const { token } = await createSession(user.id, tenantId);
  return {
    userId: user.id,
    token,
    api: (method, path, body, init) => call(method, path, body, token, init),
  };
}

/** An ERP manager: `erp:agents:manage` is SENSITIVE, so only a bare `*` reaches it. */
export const makeManager = (tenantId: string) => makeMember(tenantId, { role: 'ADMIN', jobRole: 'both' });

/** An ERP agent: reads by role, writes only what is granted by name. */
export const makeAgent = (tenantId: string, jobRole = 'confirmation') =>
  makeMember(tenantId, { role: 'MEMBER', permissions: AGENT_GRANTS, jobRole });

/**
 * A whole ERP tenant in one call: the tenant, a manager, and two agents who do
 * not know about each other.
 *
 * Two agents rather than one because most of what the ERP's authorization tests
 * assert is about the SECOND agent — the one whose orders must stay invisible.
 */
export async function makeErpTenant(label: string) {
  const tenantId = await makeTenant(label);
  const [manager, agent, other] = await Promise.all([
    makeManager(tenantId),
    makeAgent(tenantId, 'both'),
    makeAgent(tenantId, 'both'),
  ]);
  return { tenantId, manager, agent, other };
}

/**
 * Remove everything this run created.
 *
 * Sessions first: destroying them before the user rows means a token cannot
 * resolve against a half-deleted account if anything is still in flight. The
 * tenant delete then cascades its memberships and all 46 scoped tables, so
 * nothing needs listing here — which matters, because a list would go stale
 * every time the ERP port adds a model.
 */
export async function cleanup() {
  for (const id of createdUsers) {
    await destroySessionsForUser(id).catch(() => {});
  }
  for (const id of createdTenants) {
    await asPlatform().tenant.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdUsers) {
    await asPlatform().user.delete({ where: { id } }).catch(() => {});
  }
  createdTenants.length = 0;
  createdUsers.length = 0;
  await disconnect();
}

/** Poll until `fn` returns something truthy. The ERP's `waitFor`, unchanged. */
export async function waitFor<T>(
  fn: () => Promise<T> | T,
  { timeout = 10000, interval = 150, label = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
