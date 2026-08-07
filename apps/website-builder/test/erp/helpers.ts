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
 * would hand over every `*:*:write` in every product the tenant owns.
 *
 * `erp:ai:use` is here for the same reason and was added in Phase 5.3: the ERP's
 * agent PWA could list and use the assistants it was allowed, and no role glob
 * reaches a `:use` action — `*:*:read` and `*:*:write` do not match it. Without
 * the grant an agent gets 403 on the whole AI surface, which is a different
 * product from the one being ported.
 *
 * Note what is still absent: `erp:clients:read` and `erp:finance:read`. Those
 * are D-05.1, and an agent must not hold them — which is exactly what makes
 * the AI permission clamp observable, since `read_analytics` needs the second. */
export const AGENT_GRANTS = ['erp:orders:write', 'erp:ai:use'] as const;

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

/**
 * A raw request, for the one surface that is not JSON — PM.2.
 *
 * `call` sets `content-type: application/json` and stringifies the body, which
 * is right for every other route and wrong for a multipart upload: setting the
 * header by hand strips the boundary `FormData` generates, and the server sees
 * a body it cannot parse. This carries the session and touches nothing else.
 */
export async function raw(
  method: string,
  path: string,
  token: string | undefined,
  body?: BodyInit,
): Promise<Response> {
  return fetch(BASE + path, {
    method,
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
    body,
    redirect: 'manual',
  });
}

/** The smallest real PNG — a 1×1 pixel, so `sharp` has something to decode. */
export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
 * The secret `services/worker` presents to `POST /api/jobs/tick`.
 *
 * REQUIRED IN STRICT MODE, and it is worth saying why so nobody removes it. The
 * tick fails closed: with no secret configured it answers 404 for everybody, so
 * a suite running against a server that has none can only ever test the refusal.
 * That is precisely how 6.5b shipped a tick which — once authorised — read
 * `Subscription` through an unbound client, matched no tenant, and reported
 * "0 jobs over 0 tenants" as though the system were quiet. The scheduled work
 * never ran a single time and every test passed.
 *
 * The test process and the server must agree, which they do because both read
 * `apps/website-builder/.env`.
 */
export const WORKER_SECRET = process.env.WORKER_SECRET ?? '';

if (STRICT && SERVER_UP && HAS_DB && !WORKER_SECRET) {
  throw new Error(
    'ERP_CONTRACT=strict: WORKER_SECRET is not set, so the authorised half of ' +
      'POST /api/jobs/tick cannot be exercised. Set it in apps/website-builder/.env ' +
      '(the same value the server reads).',
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

/**
 * A follow-up task, inserted directly.
 *
 * There is no route that creates one, and that is correct: tasks are raised by
 * the system when a carrier reports a state needing a person — customer
 * unavailable, bad address, a reschedule — not by anybody asking. So the fixture
 * writes one the way the delivery path does, inside the tenant binding, and the
 * tests exercise the only thing a human does to it: resolve it.
 */
export async function makeFollowupTask(
  tenantId: string,
  input: {
    orderId: string;
    agentUserId?: string | null;
    type?: string;
    reason?: string;
    /** Explicit countdown, so a test can stage one that has already expired. */
    dueAt?: Date;
  },
): Promise<{ id: string; status: string | null; agentUserId: string | null }> {
  return withTenant(tenantId, (tx) =>
    (tx as any).followupTask.create({
      data: {
        tenantId,
        orderId: input.orderId,
        type: input.type ?? 'call_customer',
        status: 'open',
        agentUserId: input.agentUserId ?? null,
        reason: input.reason ?? 'customer_unavailable',
        dueAt: input.dueAt ?? new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true, status: true, agentUserId: true },
    }),
  );
}

/**
 * Move an order's `createdAt` into the past.
 *
 * The overdue sweep's shortest useful threshold is ONE MINUTE, and a suite that
 * slept 61 seconds per case to observe it would not be run. `createdAt` is
 * server-set on purpose, so a test cannot ask the API for a past order — it
 * stages one, the same way `makeFollowupTask` stages a task nothing has a route
 * to create.
 *
 * `overdueFlaggedAt` moves with it when asked. That column is the sweep's clock
 * for an order that has already been reassigned once, so staging a SECOND
 * timeout means backdating the handover rather than the creation.
 *
 * Inside the tenant binding, so it cannot reach another company's rows.
 */
export async function backdateOrder(
  tenantId: string,
  orderId: string,
  minutes: number,
  also: { overdueFlaggedAt?: boolean } = {},
) {
  const when = new Date(Date.now() - minutes * 60_000);
  await withTenant(tenantId, (tx) =>
    (tx as any).fulfillmentOrder.update({
      where: { id: orderId },
      data: {
        createdAt: when,
        ...(also.overdueFlaggedAt ? { overdueFlaggedAt: when } : {}),
      },
    }),
  );
}

/**
 * Change a tenant's subscription status.
 *
 * Entitlement is the gate on the scheduled work as well as on the routes, and
 * "this company stopped paying" has no route that produces it — billing is
 * Phase 7. So a test stages it, inside the binding.
 */
export async function setSubscriptionStatus(tenantId: string, status: string) {
  await withTenant(tenantId, (tx) =>
    (tx as any).subscription.updateMany({ where: { tenantId }, data: { status } }),
  );
}

/**
 * Move a shipment's `lastPolledAt` into the past — or clear it.
 *
 * The tracking poll's interval is `trackingPollMinutes`, whose floor is one
 * minute, and a suite that slept through it per case would not be run. This is
 * `backdateOrder`'s counterpart and exists for the same reason: the column is
 * written by the job itself, so a test stages the passage of time rather than
 * waiting for it.
 */
export async function backdateShipmentPoll(
  tenantId: string,
  orderId: string,
  minutes: number | null,
) {
  await withTenant(tenantId, (tx) =>
    (tx as any).shipment.updateMany({
      where: { orderId },
      data: { lastPolledAt: minutes === null ? null : new Date(Date.now() - minutes * 60_000) },
    }),
  );
}

/**
 * Put an adapter key on a carrier row without going through the API.
 *
 * Needed precisely BECAUSE the API refuses an unregistered key now. A row can
 * still hold one — it predates the check, or the deployment dropped an adapter
 * it used to have — and the booking and polling paths have to refuse it too.
 * Staging that state is the only way to test the second half of the guard.
 */
export async function setCarrierAdapter(tenantId: string, carrierId: string, adapter: string) {
  await withTenant(tenantId, (tx) =>
    (tx as any).carrier.update({ where: { id: carrierId }, data: { adapter } }),
  );
}

/* -----------------------------------------------------------------------------
 * A storefront, for the paths that start with a customer rather than an agent
 * -------------------------------------------------------------------------- */

export interface Storefront {
  readonly page: { id: string; title: string };
  readonly wilaya: { id: number; name: string };
  readonly baladiaName: string;
}

/**
 * A published page with a priced wilaya — everything a checkout needs.
 *
 * Here rather than in one test file because two of them now place real orders
 * through the public endpoint, and a second copy of this fixture is a second
 * thing to keep in step with the checkout contract.
 */
export async function storefront(tenantId: string): Promise<Storefront> {
  return withTenant(tenantId, async (db) => {
    const page = await (db as any).landingPage.create({
      data: {
        tenantId,
        title: `Fixture Widget ${uid()}`,
        slug: `fixture-${uid()}`,
        price: 4900,
        published: true,
        status: 'PUBLISHED',
      },
      select: { id: true, title: true },
    });
    const wilaya = await asPlatform().wilaya.findFirst({ select: { id: true, name: true } });
    // Upsert, not create: the price is per (tenant, wilaya) and this helper runs
    // once per test against the same tenant and the same first wilaya.
    await (db as any).tenantDeliveryPrice.upsert({
      where: { tenantId_wilayaId: { tenantId, wilayaId: wilaya!.id } },
      create: { tenantId, wilayaId: wilaya!.id, homePrice: 500, deskPrice: 300 },
      update: {},
    });
    const baladia = await asPlatform().baladia.findFirst({
      where: { wilayaId: wilaya!.id },
      select: { name: true },
    });
    return { page, wilaya: wilaya!, baladiaName: baladia?.name ?? 'Centre' };
  });
}

/** Place a real order through the public, anonymous checkout. */
export async function checkout(slug: string, shop: Storefront, customerName = 'Split Customer') {
  const res = await fetch(`${BASE}/api/storefront/${slug}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      landingPageId: shop.page.id,
      customerName,
      phone: phone(),
      wilayaId: shop.wilaya.id,
      baladiaName: shop.baladiaName,
      address: '12 Rue de Test',
      quantity: 2,
      variantIds: [],
      shippingMethod: 'HOME',
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * A tenant's slug.
 *
 * Needed because the inbound-webhook paths carry it (D-05.5): those requests
 * have no session, and `SalesChannel` is RLS-scoped, so the tenant has to come
 * from the URL before anything can be read.
 */
export async function slugOf(tenantId: string): Promise<string> {
  const t = await asPlatform().tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });
  return t?.slug ?? '';
}

/**
 * Poll until `fn` returns something truthy. The ERP's `waitFor`, unchanged.
 *
 * It returns `NonNullable<T>` because it cannot return anything else — it loops
 * until the value is truthy or it throws. Saying so keeps every caller from
 * having to write `!` on a value the function guarantees.
 */
export async function waitFor<T>(
  fn: () => Promise<T> | T,
  { timeout = 10000, interval = 150, label = 'condition' } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Link a catalogue product to an external listing — LP.16a.
 *
 * `CatalogProductLink` is written by the channel import path, which needs a
 * configured storefront and a webhook. `sales-summary`'s precedence rule —
 * the channel's own link wins over the name, and wins by saying NO as well as
 * yes — is decided entirely by these rows, so a test that cannot create one
 * cannot attack the rule it exists for.
 */
export async function linkProduct(
  tenantId: string,
  productId: string,
  link: { platform?: string; salesChannelId?: string | null; externalProductId: string },
) {
  await withTenant(tenantId, (tx) =>
    (tx as any).catalogProductLink.create({
      data: {
        tenantId,
        productId,
        platform: link.platform ?? 'shopify',
        salesChannelId: link.salesChannelId ?? null,
        externalProductId: link.externalProductId,
      },
    }),
  );
}

/**
 * Stamp an order with the external identity a channel webhook would have set.
 *
 * `POST /api/erp/orders` deliberately does not accept `externalProductId` — an
 * order typed by an operator has no external listing behind it — so this is
 * the only way to produce the state the matcher has to get right.
 */
export async function setOrderExternalProduct(
  tenantId: string,
  orderId: string,
  external: { externalProductId: string; platform?: string; salesChannelId?: string | null },
) {
  await withTenant(tenantId, (tx) =>
    (tx as any).fulfillmentOrder.update({
      where: { id: orderId },
      data: {
        externalProductId: external.externalProductId,
        platform: external.platform ?? 'shopify',
        salesChannelId: external.salesChannelId ?? null,
      },
    }),
  );
}

/**
 * Put a chosen reference on an order and forget the counter — LP.7.
 *
 * The state every seeded, imported or restored tenant is in: references exist
 * that `nextReference` never minted, so `TenantSequence` knows nothing about
 * them. There is no route that produces it, because every route mints through
 * the counter — which is exactly why it went unnoticed until an order was
 * created by hand in the seeded demo tenant and answered 500.
 */
export async function stampReferenceWithoutCounter(
  tenantId: string,
  orderId: string,
  reference: string,
) {
  await withTenant(tenantId, async (tx) => {
    await (tx as any).fulfillmentOrder.update({ where: { id: orderId }, data: { reference } });
    await (tx as any).tenantSequence.deleteMany({ where: { tenantId, name: 'order' } });
  });
}

/**
 * Raise an agent's missed-order counter without waiting for the sweep — LP.12.
 *
 * There is no route that raises it: the overdue sweep does, on a schedule, and
 * that is exactly why the counter could reach `suspendThreshold` with nothing
 * able to lower it again. Staging the state is the only way to test the way out.
 */
export async function setAgentMissed(tenantId: string, userId: string, missedOrders: number) {
  await withTenant(tenantId, async (tx) => {
    const key = `agent:${userId}`;
    const row = await (tx as any).productSetting.findUnique({
      where: { tenantId_product_key: { tenantId, product: 'erp', key } },
    });
    const value = { ...(row?.value ?? {}), missedOrders };
    await (tx as any).productSetting.upsert({
      where: { tenantId_product_key: { tenantId, product: 'erp', key } },
      create: { tenantId, product: 'erp', key, value },
      update: { value },
    });
  });
}
