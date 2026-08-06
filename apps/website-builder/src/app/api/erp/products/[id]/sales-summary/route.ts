import { Prisma } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { productOrderMatcher } from "@/lib/erp/product-match";

export const dynamic = "force-dynamic";

type Params = { id: string };

const ZERO = new Prisma.Decimal(0);

/**
 * What this product actually earned over a window.
 *
 * Every figure here counts DELIVERED orders only, by settlement date — not
 * confirmed ones, and not by creation date. Under cash on delivery a
 * confirmation is not a sale: a large fraction of confirmed parcels are refused
 * at the door, and counting them books revenue nobody ever collected.
 *
 * This route is the reason BUG-02 mattered. It reads `deliveryOutcome`, which
 * was written nowhere, so `realCA` was permanently zero and the product page
 * showed a catalogue that had apparently never sold anything.
 *
 * COST comes from what the movements actually recorded — the real FIFO lot
 * cost of the units this order consumed — and falls back to the product's flat
 * costPrice only where no movement carries one (an order predating the lot
 * feature, or `reservationMode: none`). Using the flat cost throughout would
 * report a margin computed against today's purchase price rather than the price
 * actually paid for the units that shipped.
 *
 * LP.16a rewrote three things here, and each was a wrong answer rather than a
 * missing feature:
 *
 *  1. MATCHING. `where: { product: product.name }` was exact string equality,
 *     so `Montre™` reported zero revenue on a screen that already ships, and a
 *     catalogue row with a NULL name passed `product: undefined` to Prisma —
 *     which is not a filter — and reported the whole book. Both now go through
 *     `productOrderMatcher` (external link first, then a normalised name).
 *
 *  2. `avgBuyPrice` FOLDED PACKAGING IN. The profit calculator multiplies the
 *     buy price AND the packaging cost by units, so a caller filling one field
 *     from this number and leaving the other alone counts packaging twice —
 *     and the resulting profit is wrong in the safe-looking direction, which is
 *     the kind of error nobody investigates. The two are separate now, as they
 *     always were on the legacy side.
 *
 *  3. `returnedCount` WAS NOT ANSWERED AT ALL, so the one figure that turns a
 *     revenue number into a return rate had to be typed from memory.
 *
 * `costTrackedUnits` / `costFallbackUnits` are new and are the honesty column:
 * a margin computed 80% from today's flat price is a guess, and until now the
 * route could not say so.
 */
export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params, searchParams }) => {
  const product = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, costPrice: true, packagingCost: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");

  const since = new Date(Number(searchParams.get("since")) || 0);
  const until = new Date(Number(searchParams.get("until")) || Date.now());

  // Both outcomes in one read. `returnedCount` is not a second query because it
  // is the same window, the same matcher and the same rows — and two reads
  // could disagree if a parcel settled between them.
  const settled = await db.fulfillmentOrder.findMany({
    where: {
      deliveryOutcome: { in: ["delivered", "returned"] },
      deliveryOutcomeAt: { gte: since, lte: until },
    },
    select: {
      id: true, price: true, quantity: true, deliveryOutcome: true,
      product: true, externalProductId: true, platform: true, salesChannelId: true,
    },
  });

  // Every link whose external id appears in this window — not only this
  // product's. An order linked to a DIFFERENT product must be refused rather
  // than falling through to the name comparison, which would hand one
  // product's revenue to another.
  const externalIds = [
    ...new Set(settled.map((o) => o.externalProductId).filter((v): v is string => Boolean(v))),
  ];
  const links = externalIds.length
    ? await db.catalogProductLink.findMany({
        where: { externalProductId: { in: externalIds } },
        select: { productId: true, platform: true, salesChannelId: true, externalProductId: true },
      })
    : [];

  const mine = productOrderMatcher(product.id, product.name, links);
  const matched = settled.filter(mine);
  const delivered = matched.filter((o) => o.deliveryOutcome === "delivered");
  const returned = matched.filter((o) => o.deliveryOutcome === "returned");

  // One read for every movement behind these orders. It used to be one query
  // per order inside the loop — correct, and a query count that grows with the
  // window a manager picks.
  const movements = delivered.length
    ? await db.inventoryMovement.findMany({
        where: {
          orderId: { in: delivered.map((o) => o.id) },
          productId: params.id,
          reason: { in: ["reserve", "confirm"] },
        },
        select: { orderId: true, delta: true, unitCost: true, packagingCost: true },
      })
    : [];
  const byOrder = new Map<string, typeof movements>();
  for (const m of movements) {
    if (!m.orderId) continue;
    const list = byOrder.get(m.orderId);
    if (list) list.push(m);
    else byOrder.set(m.orderId, [m]);
  }

  let realCA = ZERO;
  let units = 0;
  // Kept apart all the way through, and only divided at the end. Adding them
  // and dividing once is the defect this route shipped with.
  let costUnitTotal = ZERO;
  let costPackTotal = ZERO;
  let costTrackedUnits = 0;
  let costFallbackUnits = 0;

  const flatUnit = product.costPrice ?? ZERO;
  const flatPack = product.packagingCost ?? ZERO;

  for (const order of delivered) {
    const qty = Math.max(1, order.quantity ?? 1);
    realCA = realCA.plus(order.price ?? ZERO);
    units += qty;

    let accounted = 0;
    for (const m of byOrder.get(order.id) ?? []) {
      const moved = Math.abs(m.delta ?? 0);
      if (!moved) continue;
      accounted += moved;
      if (m.unitCost) {
        // A real lot cost: what these units actually cost when they sold, not
        // what the same product costs to buy today.
        costUnitTotal = costUnitTotal.plus(m.unitCost.times(moved));
        costPackTotal = costPackTotal.plus((m.packagingCost ?? flatPack).times(moved));
        costTrackedUnits += moved;
      } else {
        costUnitTotal = costUnitTotal.plus(flatUnit.times(moved));
        costPackTotal = costPackTotal.plus(flatPack.times(moved));
        costFallbackUnits += moved;
      }
    }

    // Whatever the ledger did not account for falls back to the flat cost, so
    // the total is a real number rather than a partial one — and it is COUNTED
    // as a fallback, so a manager can see how much of the answer is a guess.
    const remainder = Math.max(0, qty - accounted);
    if (remainder) {
      costUnitTotal = costUnitTotal.plus(flatUnit.times(remainder));
      costPackTotal = costPackTotal.plus(flatPack.times(remainder));
      costFallbackUnits += remainder;
    }
  }

  const costedUnits = costTrackedUnits + costFallbackUnits;
  const avgBuyPrice = costedUnits ? costUnitTotal.dividedBy(costedUnits) : flatUnit;
  const avgPackagingCost = costedUnits ? costPackTotal.dividedBy(costedUnits) : flatPack;
  const costOfGoods = costUnitTotal.plus(costPackTotal);

  return apiOk({
    productId: product.id,
    // Echoed so a saved calculation records WHAT it was about and over which
    // window, rather than only the number that came out.
    productName: product.name,
    since: since.getTime(),
    until: until.getTime(),
    deliveredCount: delivered.length,
    // ORDERS, not units. The calculator's per-unit arithmetic assumes it, so
    // `deliveredUnits` is offered beside it rather than instead of it.
    deliveredUnits: units,
    returnedCount: returned.length,
    realCA: realCA.toString(),
    totalCostOfGoods: costOfGoods.toString(),
    avgBuyPrice: avgBuyPrice.toString(),
    avgPackagingCost: avgPackagingCost.toString(),
    costTrackedUnits,
    costFallbackUnits,
    grossProfit: realCA.minus(costOfGoods).toString(),
  });
});
