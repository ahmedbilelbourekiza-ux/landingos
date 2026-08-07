import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { normalizeProductName } from "./product-match";

/* =============================================================================
 * A product's lifetime counters — the audit's finding, and BUG-02's shape.
 *
 * `CatalogProduct.totalOrders`, `cancelledOrders`, `totalRevenue` and
 * `firstOrderAt` have existed since M-06 under the comment "denormalized
 * lifetime counters, **maintained by the order pipeline**". `PRODUCT_SELECT`
 * returns all four to every caller of `GET /api/erp/products`.
 *
 * **Nothing wrote one, ever.** The port brought across `upsertClientFromOrder`
 * as `syncClientFromOrder` and left `upsertProductStatsFromOrder` behind, so
 * every product on the API has reported zero orders and zero revenue for the
 * life of the platform. Nothing errored; the numbers were real numbers; and a
 * product that had sold two hundred units said it had sold none.
 *
 * That is exactly BUG-02 — `deliveryOutcome` read in eight places and written
 * in none — which is why this module exists rather than an inline `update`.
 *
 * -----------------------------------------------------------------------------
 * THE TWO PROPERTIES IT SHARES WITH THE CLIENT REGISTRY, AND MUST KEEP
 *
 * 1. THESE ARE LIFETIME EVENT COUNTS, NOT LIVE SNAPSHOTS. `confirmedOrders`
 *    means "how many times has one of this product's orders ever reached
 *    confirmed". It does not go back down when one is later cancelled — that
 *    cancellation is its own event and increments `cancelledOrders`. Making
 *    them agree with a live `COUNT(*)` looks like a bug fix and destroys the
 *    history.
 *
 * 2. DELETING AN ORDER NEVER TOUCHES THEM. A product's sales history outlives
 *    any individual order, and the ERP asserted it.
 *
 * `increment` rather than read-modify-write, for the reason the client
 * counters use it: two orders for the same product processed concurrently
 * would otherwise lose an update.
 *
 * -----------------------------------------------------------------------------
 * WHICH PRODUCT AN ORDER IS, AND WHY IT IS NOT A STRING COMPARE
 *
 * An order carries the product as a NAME, typed by whoever took the call. LP.16a
 * built `product-match.ts` for exactly this and found the defect it exists to
 * stop: `where: { product: product.name }` meant a product called `Montre™`
 * matched no orders and reported zero revenue.
 *
 * The precedence is that module's, and it is used here so the counters and the
 * revenue attribution cannot disagree: the channel's own `CatalogProductLink`
 * first and EXCLUSIVELY, then a normalised name.
 * ========================================================================== */

/** The order fields the counters key off. Same shape as `OrderStatsView`. */
export interface ProductStatsView {
  readonly status: string | null;
  readonly deliveryOutcome: string | null;
  readonly price: Prisma.Decimal | null;
  readonly product: string | null;
  readonly externalProductId?: string | null;
  readonly salesChannelId?: string | null;
  readonly platform?: string | null;
  readonly createdAt: Date;
}

/**
 * Which catalogue product this order is, or null.
 *
 * The link first and exclusively — a shop that renamed a listing must not have
 * its sales silently reattributed by a name collision, which is why a link that
 * resolves to a DIFFERENT product is an answer rather than a miss.
 */
async function resolveProduct(
  db: TenantDb,
  order: ProductStatsView,
): Promise<{ id: string } | null> {
  if (order.externalProductId) {
    const link = await db.catalogProductLink.findFirst({
      where: {
        externalProductId: order.externalProductId,
        ...(order.salesChannelId ? { salesChannelId: order.salesChannelId } : {}),
      },
      select: { productId: true },
    });
    // A link that resolves DECIDES, including deciding "this one and not the
    // name match".
    if (link) return { id: link.productId };
  }

  const normalized = normalizeProductName(order.product);
  // A nameless order matches nothing. `product: undefined` is NOT a filter in
  // Prisma — it is an absent clause — which is the second defect LP.16a found
  // on the same line, where a catalogue row with a NULL name reported the whole
  // book's revenue.
  if (!normalized) return null;

  /* Normalising happens in JS, so the candidate set has to be read first. It is
   * bounded by the catalogue — tens to low hundreds of rows for a COD business
   * — and this runs once per order write, not per row. A `LOWER(name) = ?`
   * index would be faster and would not fold `™` or a non-breaking space, which
   * is the whole point of the normaliser. */
  const candidates = await db.catalogProduct.findMany({
    select: { id: true, name: true },
  });
  const matches = candidates.filter((p) => normalizeProductName(p.name) === normalized);

  /* AMBIGUITY IS REFUSED, NOT GUESSED — found by driving a real order through
   * the running console rather than by a test.
   *
   * The legacy does `products.find(...)` and takes the FIRST row whose
   * normalised name matches. Two catalogue rows called "Montre" — which is what
   * an import, a duplicate entry or two colours listed as products produce —
   * means every order's revenue and every lifetime counter lands silently on
   * whichever was created first. The other product reads zero forever and
   * nobody can tell why.
   *
   * It is D-LP.5.2 and D-LP.22.2 in a third place: a resolution that could be
   * one of two is refused rather than guessed, because the wrong answer looks
   * exactly like the right one.
   *
   * IT CANNOT REFUSE THE ORDER, though. A sale must not fail over a catalogue
   * tidiness problem, so the counters simply do not move and the products
   * screen marks BOTH rows as ambiguous — which is where somebody can fix it,
   * by renaming one. `duplicateProductNames` is that reader. */
  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.warn(
        `[erp] "${order.product}" matches ${matches.length} catalogue products; lifetime counters not attributed`,
      );
    }
    return null;
  }
  return { id: matches[0].id };
}

/**
 * The normalised names that more than one catalogue row answers to.
 *
 * The reader for the ambiguity above, and for the same ambiguity in
 * `/sales-summary` — where it is worse, because that direction asks "which
 * orders are mine" per product, so BOTH rows claim the same revenue and the
 * P&L double-counts it.
 *
 * Returns the ids, so a screen can mark the rows rather than describe the
 * problem in the abstract.
 */
export async function duplicateProductNames(db: TenantDb): Promise<Set<string>> {
  const rows = await db.catalogProduct.findMany({
    where: { archived: false },
    select: { id: true, name: true },
  });

  const byName = new Map<string, string[]>();
  for (const row of rows) {
    const key = normalizeProductName(row.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), row.id]);
  }

  const ambiguous = new Set<string>();
  for (const ids of byName.values()) {
    if (ids.length > 1) for (const id of ids) ambiguous.add(id);
  }
  return ambiguous;
}

/**
 * Bring a product's lifetime counters up to date after an order write.
 *
 * `before` is the order's state prior to the write, or null for a brand new
 * order. Called inside the same transaction as the write, beside
 * `syncClientFromOrder`, so the counters cannot drift from what happened.
 */
export async function syncProductStatsFromOrder(
  db: TenantDb,
  before: ProductStatsView | null,
  after: ProductStatsView,
): Promise<void> {
  const product = await resolveProduct(db, after);
  if (!product) return;

  const isNewOrder = !before;
  const became = (field: "status" | "deliveryOutcome", value: string) =>
    after[field] === value && (!before || before[field] !== value);

  const nowConfirmed = became("status", "confirmed");
  const nowCancelled = became("status", "cancelled");
  const nowDelivered = became("deliveryOutcome", "delivered");

  // Nothing the counters key off moved. Skipping the write is not an
  // optimisation — an unconditional update would touch `lastOrderAt` on every
  // note added to every order.
  if (!isNewOrder && !nowConfirmed && !nowCancelled && !nowDelivered) return;

  // Revenue counts the order ONCE, when the carrier settles it. Under cash on
  // delivery a confirmation is not a sale (N19), and counting at `confirmed`
  // would book money nobody collected.
  const revenueDelta = nowDelivered ? (after.price ?? new Prisma.Decimal(0)) : new Prisma.Decimal(0);

  const existing = await db.catalogProduct.findUnique({
    where: { id: product.id },
    select: { firstOrderAt: true, lastOrderAt: true },
  });
  if (!existing) return;

  const at = after.createdAt;

  await db.catalogProduct.update({
    where: { id: product.id },
    data: {
      ...(isNewOrder ? { totalOrders: { increment: 1 } } : {}),
      ...(nowConfirmed ? { confirmedOrders: { increment: 1 } } : {}),
      ...(nowCancelled ? { cancelledOrders: { increment: 1 } } : {}),
      ...(nowDelivered
        ? { deliveredOrders: { increment: 1 }, totalRevenue: { increment: revenueDelta } }
        : {}),
      // First stays first; last only moves forward. An imported back catalogue
      // (LP.19) arrives with older `createdAt` values than rows already here,
      // and a naive `lastOrderAt = createdAt` would walk it backwards.
      ...(!existing.firstOrderAt || at < existing.firstOrderAt ? { firstOrderAt: at } : {}),
      ...(!existing.lastOrderAt || at > existing.lastOrderAt ? { lastOrderAt: at } : {}),
    },
  });
}
