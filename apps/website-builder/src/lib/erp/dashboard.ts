import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { rangeBounds } from "./orders";
import { rate } from "./analytics";
import { stockLevel, type StockSeverity } from "./stock-level";

/* =============================================================================
 * The operational dashboard — PM.1.
 *
 * WHAT WAS WRONG WITH THE SCREEN THIS REPLACES, stated plainly because it is the
 * whole argument for the file. `/console/erp` was six counts and an overdue
 * banner. Every figure was a lifetime total with no period, no comparison and no
 * trend, so it answered "how many confirmed orders exist" — a question nobody
 * has — and never "is today going better or worse than yesterday", which is the
 * only question a manager opens a dashboard with. Nothing on it was a decision.
 *
 * THE SHAPE THIS IS BUILT TO, and it is deliberate:
 *
 *   1. WHAT NEEDS A PERSON — first, always, and only when it is non-zero. A
 *      queue with a deadline outranks a figure to read. Each one carries the
 *      destination that ACTS on it, not the screen that describes it.
 *   2. WHAT THE PERIOD DID — the headline rates, each against the SAME LENGTH
 *      of the period before it. A confirmation rate with no comparison is a
 *      number; the same rate with "▼ 6.2 pts vs the previous 7 days" is a
 *      management decision.
 *   3. WHAT IT LOOKS LIKE OVER TIME — a daily series, so a bad week is visible
 *      as a shape rather than inferred from one number.
 *   4. WHO AND WHAT IS DOING IT — agents, carriers, products.
 *
 * -----------------------------------------------------------------------------
 * THREE PROPERTIES THAT ARE EASY TO GET PLAUSIBLY WRONG
 *
 * **The window is `rangeBounds`, exported from `orders.ts` rather than computed
 * here.** Every tile links to the order list carrying the same `range=` word.
 * A dashboard that resolved "today" itself would eventually disagree with the
 * list it links to, and the symptom is a tile reading 14 that opens a list of
 * 11 — the exact failure D-LP.3 exists to prevent, one screen further out.
 *
 * **Orders count by `createdAt`, parcels by `deliveryOutcomeAt`.** A March order
 * delivered in April belongs to March's order count and April's delivered
 * count. `analytics.ts` already makes that split and this uses the same rule,
 * because a dashboard and an analytics screen disagreeing about a month is how
 * people stop trusting both.
 *
 * **Everything is scoped by the caller's `orderScope`.** An agent's dashboard is
 * their own queue — the same rows the list would show them — because a
 * company-wide total an agent cannot act on is both a leak and a lie about their
 * workload. The sections that are supervision data (the agent league table)
 * additionally require `erp:agents:manage`, which is the permission the
 * analytics route checks for the same table.
 * ========================================================================== */

const ZERO = new Prisma.Decimal(0);

/* -----------------------------------------------------------------------------
 * The period
 * -------------------------------------------------------------------------- */

/**
 * The windows the dashboard offers.
 *
 * A subset of `DATE_RANGES`, not a new vocabulary: `yesterday` is missing
 * because a dashboard is a live surface and "how did yesterday go" is a report,
 * which is what `/console/erp/analytics` is. Every value here is a word the
 * order list already understands.
 */
export const DASHBOARD_RANGES = ["today", "week", "month"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export function isDashboardRange(value: string | null | undefined): value is DashboardRange {
  return (DASHBOARD_RANGES as readonly string[]).includes(value ?? "");
}

export interface Window {
  readonly gte: Date;
  /** Exclusive. Half-open so two adjacent windows cannot both claim a second. */
  readonly lt: Date;
}

/**
 * This period and the one immediately before it, of the same length.
 *
 * The previous window is what every delta on the screen is measured against,
 * and it is derived from the current one rather than named separately — so
 * "the 7 days before these 7 days" cannot drift into "last calendar week" the
 * first time somebody edits one of the two.
 */
export function dashboardWindow(
  range: DashboardRange,
  now = new Date(),
): { readonly current: Window; readonly previous: Window } {
  const bounds = rangeBounds(range, now) ?? rangeBounds("today", now)!;
  const gte = bounds.gte!;
  // `now`, not the end of the day: comparing a partial today against a whole
  // previous day would report every morning as a collapse in volume.
  const lt = new Date(now.getTime() + 1);
  const span = lt.getTime() - gte.getTime();
  return {
    current: { gte, lt },
    previous: { gte: new Date(gte.getTime() - span), lt: gte },
  };
}

/* -----------------------------------------------------------------------------
 * The figures
 * -------------------------------------------------------------------------- */

export interface Kpi {
  readonly id: string;
  /** Already formatted where it is a rate; a raw string where it is money. */
  readonly value: string;
  readonly previous: string;
  /**
   * Signed change. `null` when the previous window held nothing to compare
   * against — a "+100%" against a base of zero is arithmetic, not information.
   */
  readonly delta: number | null;
  /** Percentage points for a rate, percent for a count or a value. */
  readonly deltaKind: "points" | "percent";
  /** Is a rise good? Returns and cancellations are the ones where it is not. */
  readonly riseIsGood: boolean;
  readonly kind: "count" | "money" | "rate";
  /**
   * The counts a rate is derived from, so it is never read on its own.
   *
   * The screen this replaced rendered the confirmation rate as a sub-line under
   * the confirmed count, and the contract suite asserts that pairing for a
   * stated reason: a percentage with no denominator beside it is a figure
   * nobody can sanity-check. The rate is a first-class tile now — it is what
   * the business is managed by — and it still carries its own arithmetic.
   */
  readonly parts?: readonly [number, number];
}

interface PeriodTotals {
  readonly orders: number;
  readonly confirmed: number;
  readonly cancelled: number;
  readonly confirmedValue: Prisma.Decimal;
  readonly delivered: number;
  readonly deliveredValue: Prisma.Decimal;
  readonly returned: number;
  readonly neverCalled: number;
  /** New customer records in the window. `null` where the caller may not read
   *  the registry — absent, never zero, because a zero reads as a fact about
   *  the business rather than as a permission (D-05.1). */
  readonly customers: number | null;
}

/**
 * One window's totals — FOUR queries, not nine.
 *
 * WHY THAT COUNT IS THE DESIGN AND NOT A MICRO-OPTIMISATION. `withTenant` opens
 * an INTERACTIVE TRANSACTION, which pins one connection — so `Promise.all`
 * around nine Prisma calls does not run them in parallel, it queues them on one
 * wire. Every query on this page is one network round trip to Postgres, in
 * order, and the first build of this dashboard issued about thirty-five of
 * them: measured at 3.2–4.8 s on the front door, which is the screen a manager
 * opens first and judges the product by.
 *
 * So the fix is fewer round trips, and the way to get them without a second
 * vocabulary is `groupBy`. One pass grouped by `status` answers "how many
 * orders, how many confirmed, how many cancelled, and what the confirmed ones
 * were worth" — four of the old queries. One pass grouped by `deliveryOutcome`
 * answers three more. Both are the same indexed scan the four separate counts
 * were doing individually.
 *
 * NOT raw SQL, deliberately, and this is the load-bearing part: `orderScope`'s
 * record-level rule is a Prisma `where`, and hand-writing it into a SQL string
 * would be a SECOND definition of "which orders may this person see" — the
 * exact failure D-LP.3 exists to prevent, in the one place where being wrong
 * leaks a colleague's queue rather than merely disagreeing about a filter.
 *
 * `settledWhere` is the same scope with the SETTLEMENT window, because
 * delivered and returned are counted by when the carrier settled them and
 * everything else by when the order was taken.
 */
async function totals(
  db: TenantDb,
  where: Prisma.FulfillmentOrderWhereInput,
  settledWhere: Prisma.FulfillmentOrderWhereInput,
  window: Window,
  withCustomers: boolean,
): Promise<PeriodTotals> {
  const [byStatus, byOutcome, neverCalled, customers] = await Promise.all([
    db.fulfillmentOrder.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { price: true },
    }),
    db.fulfillmentOrder.groupBy({
      by: ["deliveryOutcome"],
      where: settledWhere,
      _count: { _all: true },
      _sum: { price: true },
    }),
    /* NOT "pending". An order with three failed attempts is being worked and
       one with none is being ignored, and a status count cannot tell them
       apart — the relation can, and no `groupBy` can express it. It is the
       shortest-reaction-time figure the legacy leads its dashboard with. */
    db.fulfillmentOrder.count({ where: { AND: [where, { calls: { none: {} } }] } }),
    withCustomers
      ? db.client.count({ where: { createdAt: { gte: window.gte, lt: window.lt } } })
      : Promise.resolve(null),
  ]);

  const countOf = (rows: typeof byStatus, key: string | null) =>
    rows.filter((r) => r.status === key).reduce((n, r) => n + r._count._all, 0);
  const sumOf = (rows: typeof byStatus, key: string | null) =>
    rows
      .filter((r) => r.status === key)
      .reduce((sum, r) => sum.plus(r._sum.price ?? ZERO), ZERO);

  const outcomeCount = (key: string) =>
    byOutcome.filter((r) => r.deliveryOutcome === key).reduce((n, r) => n + r._count._all, 0);
  const outcomeSum = (key: string) =>
    byOutcome
      .filter((r) => r.deliveryOutcome === key)
      .reduce((sum, r) => sum.plus(r._sum.price ?? ZERO), ZERO);

  return {
    orders: byStatus.reduce((n, r) => n + r._count._all, 0),
    confirmed: countOf(byStatus, "confirmed"),
    cancelled: countOf(byStatus, "cancelled"),
    confirmedValue: sumOf(byStatus, "confirmed"),
    delivered: outcomeCount("delivered"),
    deliveredValue: outcomeSum("delivered"),
    returned: outcomeCount("returned"),
    neverCalled,
    customers,
  };
}

/** Percent change, or `null` when there is no base to change from. */
function changePercent(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) / before) * 100;
}

/** Percentage-POINT change between two rates, or `null` with no prior sample. */
function changePoints(now: string, before: string, hadSample: boolean): number | null {
  if (!hadSample) return null;
  return Number(now) - Number(before);
}

function buildKpis(now: PeriodTotals, before: PeriodTotals): readonly Kpi[] {
  const confirmationNow = rate(now.confirmed, now.orders);
  const confirmationBefore = rate(before.confirmed, before.orders);
  const deliveryNow = rate(now.delivered, now.delivered + now.returned);
  const deliveryBefore = rate(before.delivered, before.delivered + before.returned);
  const aovNow = now.confirmed ? now.confirmedValue.dividedBy(now.confirmed) : ZERO;
  const aovBefore = before.confirmed ? before.confirmedValue.dividedBy(before.confirmed) : ZERO;
  const returnNow = rate(now.returned, now.delivered + now.returned);
  const returnBefore = rate(before.returned, before.delivered + before.returned);

  return [
    {
      id: "orders",
      value: String(now.orders),
      previous: String(before.orders),
      delta: changePercent(now.orders, before.orders),
      deltaKind: "percent",
      riseIsGood: true,
      kind: "count",
    },
    {
      id: "confirmationRate",
      value: confirmationNow,
      previous: confirmationBefore,
      delta: changePoints(confirmationNow, confirmationBefore, before.orders > 0),
      deltaKind: "points",
      riseIsGood: true,
      kind: "rate",
      parts: [now.confirmed, now.orders],
    },
    {
      id: "neverCalled",
      value: String(now.neverCalled),
      previous: String(before.neverCalled),
      delta: changePercent(now.neverCalled, before.neverCalled),
      deltaKind: "percent",
      // More orders nobody has phoned is not an improvement, whatever the
      // volume did.
      riseIsGood: false,
      kind: "count",
    },
    {
      id: "confirmedValue",
      value: now.confirmedValue.toString(),
      previous: before.confirmedValue.toString(),
      delta: changePercent(Number(now.confirmedValue), Number(before.confirmedValue)),
      deltaKind: "percent",
      riseIsGood: true,
      kind: "money",
    },
    {
      id: "deliveredValue",
      value: now.deliveredValue.toString(),
      previous: before.deliveredValue.toString(),
      delta: changePercent(Number(now.deliveredValue), Number(before.deliveredValue)),
      deltaKind: "percent",
      riseIsGood: true,
      kind: "money",
    },
    {
      id: "deliveryRate",
      value: deliveryNow,
      previous: deliveryBefore,
      delta: changePoints(deliveryNow, deliveryBefore, before.delivered + before.returned > 0),
      deltaKind: "points",
      riseIsGood: true,
      kind: "rate",
      parts: [now.delivered, now.delivered + now.returned],
    },
    {
      id: "returnRate",
      value: returnNow,
      previous: returnBefore,
      delta: changePoints(returnNow, returnBefore, before.delivered + before.returned > 0),
      deltaKind: "points",
      // A rise is bad here, and the tile has to know: a green arrow on a
      // climbing return rate is worse than no arrow at all.
      riseIsGood: false,
      kind: "rate",
      parts: [now.returned, now.delivered + now.returned],
    },
    {
      id: "averageOrder",
      value: aovNow.toFixed(2),
      previous: aovBefore.toFixed(2),
      delta: changePercent(Number(aovNow), Number(aovBefore)),
      deltaKind: "percent",
      riseIsGood: true,
      kind: "money",
    },
    /* D-05.1 — ABSENT, NEVER ZERO. The customer registry is sensitive, so
       somebody who cannot read it is not shown a count of it; a zero would be a
       lie that reads as a fact about the business. The contract suite asserts
       both halves of this, and has since Phase 6.1. */
    ...(now.customers === null
      ? []
      : [
          {
            id: "customers",
            value: String(now.customers),
            previous: String(before.customers ?? 0),
            delta: changePercent(now.customers, before.customers ?? 0),
            deltaKind: "percent" as const,
            riseIsGood: true,
            kind: "count" as const,
          },
        ]),
  ];
}

/* -----------------------------------------------------------------------------
 * What needs a person
 * -------------------------------------------------------------------------- */

/**
 * One thing that is wrong and can be acted on.
 *
 * `href` is the screen where the ACTION lives, not the screen that describes
 * the problem. That distinction is the whole value of the panel: "12 orders
 * nobody has called" linking to a definition of overdue is a fact; linking to
 * those twelve orders, filtered, is a shift's work made one click away.
 */
export interface Alert {
  readonly id: string;
  readonly count: number;
  readonly href: string;
  readonly severity: "danger" | "warning" | "info";
}

/**
 * Who may be shown what.
 *
 * EVERY FLAG HERE IS THE PERMISSION ITS DESTINATION SCREEN CHECKS, not a
 * plausible neighbour — and getting that wrong is how an alert card becomes a
 * link into a 404. The first build of this file gated the two integration
 * cards on one settings permission and pointed them at two screens that check
 * two different ones; found by reading the manifest's nav gates beside these,
 * which is the check a route-shaped review does not make.
 */
export interface AlertInput {
  /** The tenant's own overdue threshold, so this and the queue badge agree. */
  readonly alertMinutes: number;
  /** `erp:agents:manage` — supervision data, and the roster screen's own gate. */
  readonly mayManageAgents: boolean;
  /** `erp:shipments:write` — what `/console/erp/carriers` checks. */
  readonly mayReachCarriers: boolean;
  /** `erp:settings:write` — what `/console/erp/sales-channels` checks. */
  readonly mayReachChannels: boolean;
  /**
   * `erp:inventory:write` — what `/console/erp/inventory` checks.
   *
   * It decides the DESTINATION, not whether the stock figures are shown: the
   * catalogue is not customer data, and an agent who cannot open the stockroom
   * still needs to know the thing they are about to confirm has run out. Stock
   * alerts point at the products list for them, which every member may read.
   */
  readonly mayReachInventory: boolean;
  /** `followupScope` — a manager sees every task, everybody else their own. */
  readonly followupScope: { agentUserId?: string };
}

/** Failures younger than this are the ones somebody can still do something about. */
const INTEGRATION_WINDOW_HOURS = 24;

async function readAlerts(
  db: TenantDb,
  scope: Prisma.FulfillmentOrderWhereInput,
  input: AlertInput,
  stock: readonly StockAlert[],
): Promise<readonly Alert[]> {
  const scoped = (extra: Prisma.FulfillmentOrderWhereInput) =>
    Object.keys(scope).length ? { AND: [scope, extra] } : extra;

  const overdueBefore = new Date(Date.now() - input.alertMinutes * 60_000);
  const integrationSince = new Date(Date.now() - INTEGRATION_WINDOW_HOURS * 3_600_000);
  const now = new Date();

  const stockOut = stock.filter((s) => s.severity === "out").length;
  const stockCritical = stock.filter((s) => s.severity === "critical").length;

  const [
    overdue,
    followupDue,
    unbooked,
    suspicious,
    integrationFailures,
  ] = await Promise.all([
    /* NEVER CALLED **AND** OLD, which is not the same question as the
       never-called FIGURE in the band above. An order phoned three times is
       being worked however old it is, and an order taken four minutes ago is
       not late — `orderRowFacts` makes the same judgement and takes
       `alertMinutes` as an argument for exactly this reason, so the banner, the
       queue badge and this cannot become three opinions about one order. */
    db.fulfillmentOrder.count({
      where: scoped({
        status: "pending",
        calls: { none: {} },
        createdAt: { lt: overdueBefore },
      }),
    }),
    /* An open follow-up task whose deadline has passed. `dueAt: null` is
       excluded deliberately: a task with no deadline is not late, and counting
       it here would put a permanent number on a panel whose whole value is
       being empty most of the time. */
    db.followupTask.count({
      where: { status: "open", dueAt: { not: null, lte: now }, ...input.followupScope },
    }),
    /* CONFIRMED WITH NO PARCEL. The customer said yes and nothing has been
       booked — the single most expensive silent state in a COD operation,
       because it looks identical to a healthy confirmed order on every list. */
    db.fulfillmentOrder.count({
      where: scoped({ status: "confirmed", shipmentId: null, deliveryOutcome: "" }),
    }),
    /* LP.12 / R11 — a call shorter than `minCallSeconds` that was nevertheless
       marked confirmed. Supervision data, so it is withheld from somebody who
       cannot manage the roster rather than shown and unexplained. */
    input.mayManageAgents
      ? db.fulfillmentOrder.count({ where: scoped({ calls: { some: { suspicious: true } } }) })
      : Promise.resolve(0),
    /* Both failure counts from ONE grouped read. Carriers and channels are
       different screens to act on — and, as it turns out, different
       PERMISSIONS — so they stay two alert cards; but they are one question of
       the database. */
    input.mayReachCarriers || input.mayReachChannels
      ? db.integrationLog.groupBy({
          by: ["entity"],
          where: {
            entity: {
              in: [
                ...(input.mayReachCarriers ? ["carrier"] : []),
                ...(input.mayReachChannels ? ["salesChannel"] : []),
              ],
            },
            result: "failure",
            ts: { gte: integrationSince },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const failuresOf = (entity: string) =>
    integrationFailures.find((r) => r.entity === entity)?._count._all ?? 0;
  const carrierFailures = input.mayReachCarriers ? failuresOf("carrier") : 0;
  const channelFailures = input.mayReachChannels ? failuresOf("salesChannel") : 0;

  // The stockroom for somebody who may open it, the catalogue for everybody
  // else. Both show the level; only one of them can be corrected there.
  const stockHref = input.mayReachInventory
    ? "/console/erp/inventory"
    : "/console/erp/products";

  const all: readonly Alert[] = [
    { id: "overdue", count: overdue, href: "/console/erp/orders?status=pending&sort=createdAt&dir=asc", severity: "danger" },
    { id: "unbooked", count: unbooked, href: "/console/erp/orders?status=confirmed", severity: "danger" },
    { id: "followupDue", count: followupDue, href: "/console/erp/follow-up", severity: "danger" },
    { id: "stockOut", count: stockOut, href: stockHref, severity: "danger" },
    { id: "stockCritical", count: stockCritical, href: stockHref, severity: "warning" },
    { id: "suspicious", count: suspicious, href: "/console/erp/orders?suspicious=true", severity: "warning" },
    { id: "carrierFailures", count: carrierFailures, href: "/console/erp/carriers", severity: "warning" },
    { id: "channelFailures", count: channelFailures, href: "/console/erp/sales-channels", severity: "warning" },
  ];

  // A zero is furniture. The panel exists to be scanned in a second, and nine
  // rows of "0" is the surest way to make somebody stop scanning it.
  return all.filter((a) => a.count > 0);
}

/* -----------------------------------------------------------------------------
 * Stock
 * -------------------------------------------------------------------------- */

export interface StockAlert {
  readonly productId: string;
  readonly name: string;
  readonly variantName: string | null;
  readonly image: string | null;
  readonly stock: number;
  readonly threshold: number;
  readonly severity: StockSeverity;
}

/**
 * The catalogue, per variant, worst first.
 *
 * Read whole rather than filtered, and the reason is structural: the level
 * lives inside a JSON array, so no index can answer "which variants are below
 * their threshold" and there is nothing to push into SQL. It is bounded by the
 * catalogue rather than by the order book — tens to hundreds of rows for a call
 * centre, which is the same judgement `resolveStockLines` already makes.
 */
async function readStock(db: TenantDb): Promise<readonly StockAlert[]> {
  const products = await db.catalogProduct.findMany({
    where: { archived: false },
    select: {
      id: true, name: true, sku: true, image: true,
      stock: true, threshold: true, variants: true,
    },
  });

  const out: StockAlert[] = [];
  for (const product of products) {
    const variants = (Array.isArray(product.variants) ? product.variants : []) as Array<{
      name?: string; stock?: number | null; threshold?: number | null; image?: string | null;
    }>;

    if (variants.length) {
      for (const variant of variants) {
        const threshold = Number(variant.threshold ?? product.threshold ?? 0);
        const stock = Number(variant.stock ?? 0);
        const severity = stockLevel(stock, threshold);
        if (severity === "ok") continue;
        out.push({
          productId: product.id,
          name: product.name ?? "",
          variantName: variant.name ?? "",
          // Falls back to the product's own image, which is the legacy's rule
          // for every place a variant is shown.
          image: variant.image || product.image || null,
          stock,
          threshold,
          severity,
        });
      }
    } else {
      const threshold = Number(product.threshold ?? 0);
      const stock = Number(product.stock ?? 0);
      const severity = stockLevel(stock, threshold);
      if (severity === "ok") continue;
      out.push({
        productId: product.id,
        name: product.name ?? "",
        variantName: null,
        image: product.image || null,
        stock,
        threshold,
        severity,
      });
    }
  }

  const order: Record<StockSeverity, number> = { out: 0, critical: 1, low: 2, ok: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.stock - b.stock);
}

/* -----------------------------------------------------------------------------
 * The daily series
 * -------------------------------------------------------------------------- */

export interface TrendPoint {
  /** `YYYY-MM-DD` in the server's zone — the same day `rangeBounds` counts. */
  readonly day: string;
  readonly orders: number;
  readonly confirmed: number;
}

/**
 * Orders and confirmations per day across the window.
 *
 * Two grouped counts and a join in memory over at most 30 keys, NOT the order
 * book downloaded and bucketed in JavaScript — that is PERF-02 and it is what
 * makes the legacy's analytics screen unusable past a few thousand orders.
 *
 * The bucketing is done here rather than with `date_trunc` in SQL for one
 * reason: `rangeBounds` computes its boundaries in the SERVER'S zone, and
 * Postgres would truncate in UTC. A dashboard whose bars start at 01:00 while
 * its "today" starts at 00:00 is a dashboard whose first bar is always short.
 */
async function readTrend(
  db: TenantDb,
  scope: Prisma.FulfillmentOrderWhereInput,
  window: Window,
): Promise<readonly TrendPoint[]> {
  const where = (extra: Prisma.FulfillmentOrderWhereInput) => ({
    AND: [
      ...(Object.keys(scope).length ? [scope] : []),
      { createdAt: { gte: window.gte, lt: window.lt } },
      extra,
    ],
  });

  // ONE read carrying both facts, not one read per series — see `totals` for
  // why a query count is a latency budget on this page.
  const rows = await db.fulfillmentOrder.findMany({
    where: where({}),
    select: { createdAt: true, status: true },
  });

  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const buckets = new Map<string, { orders: number; confirmed: number }>();
  for (
    let cursor = new Date(window.gte.getFullYear(), window.gte.getMonth(), window.gte.getDate());
    cursor < window.lt;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    buckets.set(key(cursor), { orders: 0, confirmed: 0 });
  }
  for (const row of rows) {
    const bucket = buckets.get(key(row.createdAt));
    if (!bucket) continue;
    bucket.orders += 1;
    if (row.status === "confirmed") bucket.confirmed += 1;
  }

  return [...buckets.entries()].map(([day, v]) => ({ day, ...v }));
}

/* -----------------------------------------------------------------------------
 * Who and what
 * -------------------------------------------------------------------------- */

export interface PerformanceRow {
  readonly key: string;
  readonly orders: number;
  readonly confirmed: number;
  readonly rate: string;
  readonly value: string;
}

/**
 * One dimension, biggest first — in a SINGLE grouped read.
 *
 * `analytics.breakdown` makes three passes because it reports cancellations
 * too; this needs only the total and the confirmed share, and grouping by
 * `[dimension, status]` gets both from one indexed aggregate. Same reasoning as
 * `totals`: on a pinned transaction the query count IS the latency.
 */
async function performance(
  db: TenantDb,
  where: Prisma.FulfillmentOrderWhereInput,
  dimension: "agentUserId" | "product",
  take: number,
): Promise<readonly PerformanceRow[]> {
  // Prisma types `groupBy`'s `by` against a literal tuple; the dimension is a
  // union of column names it accepts. `analytics.ts` makes the same cast for
  // the same reason — the alternative is a switch that repeats this function
  // once per column.
  const rows = await db.fulfillmentOrder.groupBy({
    by: [dimension, "status"] as unknown as ["status"],
    where,
    _count: { _all: true },
    _sum: { price: true },
  });

  const merged = new Map<string, { orders: number; confirmed: number; sum: Prisma.Decimal }>();
  for (const row of rows) {
    const raw = (row as unknown as Record<string, unknown>)[dimension];
    const key = raw === null || raw === undefined ? "" : String(raw);
    const at = merged.get(key) ?? { orders: 0, confirmed: 0, sum: ZERO };
    const n = row._count._all;
    at.orders += n;
    if (row.status === "confirmed") {
      at.confirmed += n;
      at.sum = at.sum.plus(row._sum.price ?? ZERO);
    }
    merged.set(key, at);
  }

  return [...merged.entries()]
    .map(([key, v]) => ({
      key,
      orders: v.orders,
      confirmed: v.confirmed,
      rate: rate(v.confirmed, v.orders),
      value: v.sum.toString(),
    }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, take);
}

export interface CarrierRow {
  readonly key: string;
  readonly shipped: number;
  readonly delivered: number;
  readonly returned: number;
  readonly deliveryRate: string;
}

/** Delivery performance, counted by SETTLEMENT date like every other parcel
 *  figure. A carrier is judged on what it settled in the window, not on what
 *  was handed to it. */
async function carrierPerformance(
  db: TenantDb,
  settledWhere: Prisma.FulfillmentOrderWhereInput,
): Promise<readonly CarrierRow[]> {
  const rows = await db.fulfillmentOrder.groupBy({
    by: ["carrierCode", "deliveryOutcome"] as unknown as ["status"],
    where: { AND: [settledWhere, { deliveryOutcome: { in: ["delivered", "returned"] } }] },
    _count: { _all: true },
  });

  const merged = new Map<string, { delivered: number; returned: number }>();
  for (const row of rows) {
    const key = String((row as unknown as { carrierCode: string | null }).carrierCode ?? "");
    const at = merged.get(key) ?? { delivered: 0, returned: 0 };
    const outcome = (row as unknown as { deliveryOutcome: string | null }).deliveryOutcome;
    if (outcome === "delivered") at.delivered += row._count._all;
    else if (outcome === "returned") at.returned += row._count._all;
    merged.set(key, at);
  }

  return [...merged.entries()]
    .map(([key, v]) => ({
      key,
      shipped: v.delivered + v.returned,
      delivered: v.delivered,
      returned: v.returned,
      deliveryRate: rate(v.delivered, v.delivered + v.returned),
    }))
    .sort((a, b) => b.shipped - a.shipped)
    .slice(0, 6);
}

/* -----------------------------------------------------------------------------
 * The whole screen, in one read
 * -------------------------------------------------------------------------- */

export interface RecentOrder {
  readonly id: string;
  readonly reference: string | null;
  readonly client: string | null;
  readonly wilaya: string | null;
  readonly product: string | null;
  readonly price: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly agentUserId: string | null;
  readonly called: boolean;
}

export interface Dashboard {
  readonly range: DashboardRange;
  readonly window: Window;
  readonly kpis: readonly Kpi[];
  readonly alerts: readonly Alert[];
  readonly trend: readonly TrendPoint[];
  readonly recent: readonly RecentOrder[];
  readonly stock: readonly StockAlert[];
  readonly agents: readonly PerformanceRow[];
  readonly products: readonly PerformanceRow[];
  readonly carriers: readonly CarrierRow[];
}

export interface DashboardInput extends AlertInput {
  readonly range: DashboardRange;
  readonly scope: Prisma.FulfillmentOrderWhereInput;
  /** `erp:clients:read` — D-05.1 makes the registry sensitive. */
  readonly maySeeCustomers: boolean;
}

export async function readDashboard(
  db: TenantDb,
  input: DashboardInput,
): Promise<Dashboard> {
  const { current, previous } = dashboardWindow(input.range);
  const scope = input.scope;
  const withScope = (extra: Prisma.FulfillmentOrderWhereInput) =>
    Object.keys(scope).length ? { AND: [scope, extra] } : extra;

  const created = (w: Window) => withScope({ createdAt: { gte: w.gte, lt: w.lt } });
  const settled = (w: Window) => withScope({ deliveryOutcomeAt: { gte: w.gte, lt: w.lt } });

  /* Read ONCE and counted from, not queried twice. The catalogue scan is the
     one unindexable read on this page — the level lives inside a JSON array —
     so the alert band's "3 out of stock" and the panel listing them are the
     same rows counted two ways rather than two reads that could disagree. */
  const stock = await readStock(db);

  const [
    nowTotals,
    beforeTotals,
    alerts,
    trend,
    recent,
    agents,
    products,
    carriers,
  ] = await Promise.all([
    totals(db, created(current), settled(current), current, input.maySeeCustomers),
    totals(db, created(previous), settled(previous), previous, input.maySeeCustomers),
    readAlerts(db, scope, input, stock),
    readTrend(db, scope, current),
    db.fulfillmentOrder.findMany({
      where: withScope({}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true, reference: true, client: true, wilaya: true, product: true,
        price: true, status: true, createdAt: true, agentUserId: true,
        // The relation, not a counter: "has anybody phoned" is the fact a
        // manager reads this list for, and no column maintains it.
        _count: { select: { calls: true } },
      },
    }),
    // A league table of colleagues is supervision data — the same rule the
    // analytics screen applies to its by-agent breakdown (D-06.2).
    input.mayManageAgents
      ? performance(db, created(current), "agentUserId", 6)
      : Promise.resolve([] as readonly PerformanceRow[]),
    performance(db, created(current), "product", 6),
    input.mayManageAgents
      ? carrierPerformance(db, settled(current))
      : Promise.resolve([] as readonly CarrierRow[]),
  ]);

  return {
    range: input.range,
    window: current,
    kpis: buildKpis(nowTotals, beforeTotals),
    alerts,
    trend,
    recent: recent.map((o) => ({
      id: o.id,
      reference: o.reference,
      client: o.client,
      wilaya: o.wilaya,
      product: o.product,
      price: (o.price ?? ZERO).toString(),
      status: o.status ?? "",
      createdAt: o.createdAt,
      agentUserId: o.agentUserId,
      called: o._count.calls > 0,
    })),
    // Ten is what fits beside the recent-orders table without the panel
    // becoming the page. The full list is one click away on `/inventory`.
    stock: stock.slice(0, 10),
    agents,
    products,
    carriers,
  };
}
