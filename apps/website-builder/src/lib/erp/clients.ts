import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { normalizePhone } from "./phone";

/* =============================================================================
 * The permanent customer registry.
 *
 * Ported from `upsertClientFromOrder` in apps/erp/lib/db.js. Two properties
 * came across unchanged because they are the design, not an implementation
 * detail, and both are easy to "fix" into something wrong:
 *
 * 1. THESE ARE LIFETIME EVENT COUNTS, NOT LIVE SNAPSHOTS.
 *    `confirmedOrders` means "how many times has one of this customer's orders
 *    ever reached confirmed". It does NOT go back down when one is later
 *    cancelled — that cancellation is its own event and increments
 *    `cancelledOrders` instead. Making them agree with a live COUNT(*) looks
 *    like a bug fix and destroys the history the manager actually asked for.
 *
 * 2. DELETING AN ORDER NEVER TOUCHES THEM.
 *    A customer's identity and history outlive any individual order. The ERP
 *    was explicit about this and its tests assert it.
 *
 * WHAT CHANGED: the counters are updated with Prisma `increment`, which is
 * `SET x = x + 1` in SQL rather than a read-modify-write in JavaScript. The
 * ERP read the row, added one, and wrote the total back — safe under SQLite's
 * single writer, a lost update the moment two orders for the same customer are
 * processed concurrently. Two webhook deliveries landing together is the
 * ordinary case, not a rare one.
 * ========================================================================== */

/** The order fields the counters key off. */
export interface OrderStatsView {
  readonly status: string | null;
  readonly deliveryOutcome: string | null;
  readonly price: Prisma.Decimal | null;
  readonly phone: string | null;
  readonly client: string | null;
  readonly wilaya: string | null;
  readonly commune: string | null;
  readonly createdAt: Date;
}

/**
 * Bring the customer record for this order's phone number up to date.
 *
 * `before` is the order's state prior to the write, or null for a brand new
 * order. Called from inside the same transaction as every create and update, so
 * the counters cannot drift from what actually happened.
 */
export async function syncClientFromOrder(
  db: TenantDb,
  tenantId: string,
  before: OrderStatsView | null,
  after: OrderStatsView,
): Promise<void> {
  const phone = normalizePhone(after.phone);
  if (!phone) return;

  const isNewOrder = !before;
  const became = (field: "status" | "deliveryOutcome", value: string) =>
    after[field] === value && (!before || before[field] !== value);

  const nowConfirmed = became("status", "confirmed");
  const nowCancelled = became("status", "cancelled");
  const nowDelivered = became("deliveryOutcome", "delivered");

  // Lifetime spend counts the order ONCE, at the moment the carrier settles it.
  // Under cash on delivery a confirmation is not a sale — a large fraction of
  // confirmed parcels are refused at the door — so counting at `confirmed`
  // would book revenue for money nobody ever collected.
  const spendDelta = nowDelivered ? (after.price ?? new Prisma.Decimal(0)) : new Prisma.Decimal(0);

  const existing = await db.client.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
    select: { id: true, firstOrderAt: true, lastOrderAt: true },
  });

  if (!existing) {
    await db.client.create({
      data: {
        tenantId,
        phone,
        phoneDisplay: after.phone || phone,
        name: after.client ?? "",
        wilaya: after.wilaya ?? "",
        commune: after.commune ?? "",
        firstOrderAt: after.createdAt,
        lastOrderAt: after.createdAt,
        totalOrders: isNewOrder ? 1 : 0,
        confirmedOrders: nowConfirmed ? 1 : 0,
        cancelledOrders: nowCancelled ? 1 : 0,
        deliveredOrders: nowDelivered ? 1 : 0,
        totalSpent: spendDelta,
      },
    });
    return;
  }

  await db.client.update({
    where: { id: existing.id },
    data: {
      // Last write wins on the display fields: the newest order carries the
      // most recent spelling of a name and the address they last used.
      ...(after.phone ? { phoneDisplay: after.phone } : {}),
      ...(after.client ? { name: after.client } : {}),
      ...(after.wilaya ? { wilaya: after.wilaya } : {}),
      ...(after.commune ? { commune: after.commune } : {}),
      // An order can be backdated by an import, so the earliest wins here and
      // the latest wins below — neither is simply "now".
      ...(!existing.firstOrderAt || after.createdAt < existing.firstOrderAt
        ? { firstOrderAt: after.createdAt }
        : {}),
      ...(!existing.lastOrderAt || after.createdAt > existing.lastOrderAt
        ? { lastOrderAt: after.createdAt }
        : {}),
      ...(isNewOrder ? { totalOrders: { increment: 1 } } : {}),
      ...(nowConfirmed ? { confirmedOrders: { increment: 1 } } : {}),
      ...(nowCancelled ? { cancelledOrders: { increment: 1 } } : {}),
      ...(nowDelivered
        ? { deliveredOrders: { increment: 1 }, totalSpent: { increment: spendDelta } }
        : {}),
    },
  });
}

/** The shape the client list and detail screens read. */
export const CLIENT_SELECT = {
  id: true,
  phone: true,
  phoneDisplay: true,
  name: true,
  wilaya: true,
  commune: true,
  address: true,
  firstOrderAt: true,
  lastOrderAt: true,
  totalOrders: true,
  confirmedOrders: true,
  cancelledOrders: true,
  deliveredOrders: true,
  totalSpent: true,
  importedTotalOrders: true,
  importedConfirmedOrders: true,
  importedCancelledOrders: true,
  importedDeliveredOrders: true,
  importedTotalSpent: true,
  importedSource: true,
  importedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

/** Search across the fields a manager actually types into the box. */
export function clientFilter(search?: string): Prisma.ClientWhereInput {
  if (!search) return {};
  const q = search.trim();
  if (!q) return {};
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: normalizePhone(q) || q } },
      { phoneDisplay: { contains: q } },
      { wilaya: { contains: q, mode: "insensitive" } },
    ],
  };
}

/**
 * `avgOrderValue` is derived on read, never stored.
 *
 * A stored average is a third number that can disagree with the two it comes
 * from, and it would have to be recomputed on every counter change. Note the
 * divisor is DELIVERED orders, not all of them: it answers "what does this
 * customer spend when they actually take the parcel", which is the number that
 * decides whether to keep calling them.
 */
export function withDerived<T extends { totalSpent: Prisma.Decimal; deliveredOrders: number }>(
  client: T,
): T & { avgOrderValue: Prisma.Decimal } {
  return {
    ...client,
    avgOrderValue: client.deliveredOrders
      ? client.totalSpent.dividedBy(client.deliveredOrders)
      : new Prisma.Decimal(0),
  };
}
