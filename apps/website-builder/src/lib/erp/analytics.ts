import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

/* =============================================================================
 * The numbers a COD call centre is run on — LP.13, restoring R6 / K1 / N18.
 *
 * **THE CONFIRMATION RATE WAS COMPUTED NOWHERE ON THE PLATFORM.** Not on the
 * dashboard, not on any screen, not in any route. The legacy CRM leads its
 * dashboard with it and recomputes it across seven dimensions on its analytics
 * screen, because it is the number this business is MANAGED by: how many of the
 * people who ordered actually agreed to it when somebody phoned. An agent with a
 * 40% rate and an agent with a 75% rate look identical on every screen the
 * platform had.
 *
 * -----------------------------------------------------------------------------
 * N19 — THE TWO REVENUE FIGURES ARE BOTH REAL AND ARE NOT THE SAME NUMBER
 *
 * The legacy sums CONFIRMED orders; the platform's dashboard sums DELIVERED
 * ones. The platform is right — under cash on delivery a phone confirmation is
 * not a sale, which `settleOutcome` says in its own comment, and 30–50% of
 * confirmed parcels can still be refused at the door. But "what we agreed to
 * sell" is also a real management number, and reporting only one of them is what
 * makes somebody comparing two systems file a bug against the correct one.
 *
 * So BOTH are returned, each labelled for what it is, and the difference between
 * them is itself the interesting figure. Neither is called "revenue" on its own.
 *
 * -----------------------------------------------------------------------------
 * WHICH DATE EACH FIGURE IS COUNTED BY, which is not a detail
 *
 * Orders are counted by `createdAt` — when the business took the order.
 * Delivered and returned parcels are counted by `deliveryOutcomeAt` — when the
 * carrier actually settled them. A parcel ordered in March and delivered in
 * April belongs to March's order count and April's delivered count, and folding
 * either into the other produces a month whose figures cannot be reconciled
 * against anything. The legacy makes the same split, deliberately.
 *
 * -----------------------------------------------------------------------------
 * EVERY BREAKDOWN IS A `groupBy` OVER ONE TABLE
 *
 * The legacy downloads the whole order book into the browser and buckets it in
 * JavaScript, which is PERF-02 and is why its analytics screen is unusable past
 * a few thousand orders. Here each dimension is three aggregate queries the
 * database answers from an index. The rows come back already scoped, so an agent
 * running this sees their own queue and a manager sees the book — the same
 * `scopedWhere` the list and the export use.
 * ========================================================================== */

const ZERO = new Prisma.Decimal(0);

/** The order statuses that mean the customer said yes. */
const CONFIRMED = "confirmed";
const CANCELLED = "cancelled";

/**
 * The seven dimensions the legacy breaks orders down by, as column names.
 *
 * `marketer` and `source` are in here because they are written by the channel
 * webhooks and were READ BY NOTHING (N20) — ad attribution was uncomputable on
 * this platform, which for a business that buys its orders is the single most
 * expensive thing not to know.
 */
export const ANALYTICS_DIMENSIONS = [
  "status",
  "salesChannelName",
  "product",
  "wilaya",
  "agentUserId",
  "marketer",
  "deliveryStatus",
] as const;

export type Dimension = (typeof ANALYTICS_DIMENSIONS)[number];

/** Supervision data, withheld from somebody who may not manage the roster. */
export const SUPERVISION_DIMENSIONS: ReadonlySet<Dimension> = new Set(["agentUserId"]);

export interface Bucket {
  readonly key: string;
  readonly orders: number;
  readonly confirmed: number;
  readonly cancelled: number;
  /** confirmed / orders × 100, one decimal place, as a string. */
  readonly confirmationRate: string;
  readonly cancellationRate: string;
  /** The value of the CONFIRMED orders in this bucket. */
  readonly confirmedValue: string;
}

export interface Headline {
  readonly orders: number;
  readonly confirmed: number;
  readonly cancelled: number;
  readonly confirmationRate: string;
  readonly cancellationRate: string;
  /** What was agreed on the phone. The legacy's "revenue". */
  readonly confirmedValue: string;
  /** confirmedValue / confirmed — the legacy's "average order". */
  readonly averageOrderValue: string;
  /** Parcels the carrier actually settled in this window, and what they paid. */
  readonly delivered: number;
  readonly deliveredValue: string;
  readonly returned: number;
  /** delivered / (delivered + returned) × 100 — how many that shipped arrived. */
  readonly deliveryRate: string;
  /** Orders with no call logged at all. The shortest-reaction-time number. */
  readonly neverCalled: number;
}

/** `n / d × 100`, one decimal, and `0.0` rather than a division by zero. */
export function rate(numerator: number, denominator: number): string {
  if (!denominator) return "0.0";
  return ((numerator / denominator) * 100).toFixed(1);
}

/**
 * The headline figures for one window.
 *
 * `where` is the caller's already-scoped filter over orders BY CREATION;
 * `settledWhere` is the same scope with the settlement-date window, because the
 * two are counted by different dates (see the header).
 */
export async function headline(
  db: TenantDb,
  where: Prisma.FulfillmentOrderWhereInput,
  settledWhere: Prisma.FulfillmentOrderWhereInput,
): Promise<Headline> {
  const [orders, confirmed, cancelled, confirmedSum, delivered, deliveredSum, returned, neverCalled] =
    await Promise.all([
      db.fulfillmentOrder.count({ where }),
      db.fulfillmentOrder.count({ where: { AND: [where, { status: CONFIRMED }] } }),
      db.fulfillmentOrder.count({ where: { AND: [where, { status: CANCELLED }] } }),
      db.fulfillmentOrder.aggregate({
        where: { AND: [where, { status: CONFIRMED }] },
        _sum: { price: true },
      }),
      db.fulfillmentOrder.count({
        where: { AND: [settledWhere, { deliveryOutcome: "delivered" }] },
      }),
      db.fulfillmentOrder.aggregate({
        where: { AND: [settledWhere, { deliveryOutcome: "delivered" }] },
        _sum: { price: true },
      }),
      db.fulfillmentOrder.count({
        where: { AND: [settledWhere, { deliveryOutcome: "returned" }] },
      }),
      // NEVER CALLED — the count the platform's dashboard lost and the legacy
      // leads with. It is NOT "pending": an order with three failed attempts is
      // being worked and one with none is being ignored, and the two look
      // identical on a status count. `calls: { none: {} }` asks the relation
      // directly rather than trusting a denormalised counter that no column
      // maintains.
      db.fulfillmentOrder.count({ where: { AND: [where, { calls: { none: {} } }] } }),
    ]);

  const confirmedValue = confirmedSum._sum.price ?? ZERO;

  return {
    orders,
    confirmed,
    cancelled,
    confirmationRate: rate(confirmed, orders),
    cancellationRate: rate(cancelled, orders),
    confirmedValue: confirmedValue.toString(),
    averageOrderValue: confirmed
      ? confirmedValue.dividedBy(confirmed).toFixed(2)
      : "0.00",
    delivered,
    deliveredValue: (deliveredSum._sum.price ?? ZERO).toString(),
    returned,
    deliveryRate: rate(delivered, delivered + returned),
    neverCalled,
  };
}

/**
 * One dimension, bucketed.
 *
 * Three `groupBy` passes rather than one: Prisma cannot compute a conditional
 * aggregate, so "orders in this bucket" and "CONFIRMED orders in this bucket"
 * are separate queries joined on the key here. It is still three indexed
 * aggregates against a table rather than the whole order book in a browser.
 *
 * `take` bounds the result. A product dimension over a large catalogue is
 * unbounded otherwise, and a table nobody can read is not a report — the buckets
 * come back biggest first, which is the order somebody reads them in anyway.
 */
export async function breakdown(
  db: TenantDb,
  where: Prisma.FulfillmentOrderWhereInput,
  dimension: Dimension,
  take = 25,
): Promise<Bucket[]> {
  const by = [dimension] as ["status"];

  const [all, confirmedRows, cancelledRows] = await Promise.all([
    db.fulfillmentOrder.groupBy({ by, where, _count: { _all: true } }),
    db.fulfillmentOrder.groupBy({
      by,
      where: { AND: [where, { status: CONFIRMED }] },
      _count: { _all: true },
      _sum: { price: true },
    }),
    db.fulfillmentOrder.groupBy({
      by,
      where: { AND: [where, { status: CANCELLED }] },
      _count: { _all: true },
    }),
  ]);

  const keyOf = (row: Record<string, unknown>) => {
    const raw = row[dimension];
    return raw === null || raw === undefined || raw === "" ? "" : String(raw);
  };

  const confirmedBy = new Map(
    confirmedRows.map((r) => [
      keyOf(r as never),
      { n: (r._count as { _all: number })._all, sum: (r as { _sum: { price: Prisma.Decimal | null } })._sum.price ?? ZERO },
    ]),
  );
  const cancelledBy = new Map(
    cancelledRows.map((r) => [keyOf(r as never), (r._count as { _all: number })._all]),
  );

  return all
    .map((row) => {
      const key = keyOf(row as never);
      const orders = (row._count as { _all: number })._all;
      const c = confirmedBy.get(key) ?? { n: 0, sum: ZERO };
      const x = cancelledBy.get(key) ?? 0;
      return {
        key,
        orders,
        confirmed: c.n,
        cancelled: x,
        confirmationRate: rate(c.n, orders),
        cancellationRate: rate(x, orders),
        confirmedValue: c.sum.toString(),
      };
    })
    .sort((a, b) => b.orders - a.orders)
    .slice(0, take);
}
