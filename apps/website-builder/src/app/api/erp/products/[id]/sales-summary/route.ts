import { Prisma } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

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
 */
export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params, searchParams }) => {
  const product = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, costPrice: true, packagingCost: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");

  const since = new Date(Number(searchParams.get("since")) || 0);
  const until = new Date(Number(searchParams.get("until")) || Date.now());

  const orders = await db.fulfillmentOrder.findMany({
    where: {
      product: product.name ?? undefined,
      deliveryOutcome: "delivered",
      deliveryOutcomeAt: { gte: since, lte: until },
    },
    select: { id: true, price: true, quantity: true },
  });

  let realCA = ZERO;
  let units = 0;
  let costOfGoods = ZERO;
  let costedUnits = 0;
  let costTotal = ZERO;

  for (const order of orders) {
    const qty = Math.max(1, order.quantity ?? 1);
    realCA = realCA.plus(order.price ?? ZERO);
    units += qty;

    const movements = await db.inventoryMovement.findMany({
      where: { orderId: order.id, productId: params.id, reason: { in: ["reserve", "confirm"] } },
      select: { delta: true, unitCost: true, packagingCost: true },
    });

    let orderCost = ZERO;
    let accounted = 0;
    for (const m of movements) {
      const moved = Math.abs(m.delta ?? 0);
      if (!moved) continue;
      const unit = m.unitCost ?? product.costPrice ?? ZERO;
      const pack = m.packagingCost ?? product.packagingCost ?? ZERO;
      orderCost = orderCost.plus(unit.plus(pack).times(moved));
      accounted += moved;
    }
    // Whatever the ledger did not account for falls back to the flat cost, so
    // the total is a real number rather than a partial one.
    const remainder = Math.max(0, qty - accounted);
    if (remainder) {
      orderCost = orderCost.plus(
        (product.costPrice ?? ZERO).plus(product.packagingCost ?? ZERO).times(remainder),
      );
    }

    costOfGoods = costOfGoods.plus(orderCost);
    if (accounted) {
      costedUnits += accounted;
      costTotal = costTotal.plus(orderCost);
    }
  }

  const avgBuyPrice = costedUnits
    ? costTotal.dividedBy(costedUnits)
    : (product.costPrice ?? ZERO).plus(product.packagingCost ?? ZERO);

  return apiOk({
    productId: product.id,
    deliveredCount: orders.length,
    deliveredUnits: units,
    realCA: realCA.toString(),
    totalCostOfGoods: costOfGoods.toString(),
    avgBuyPrice: avgBuyPrice.toString(),
    grossProfit: realCA.minus(costOfGoods).toString(),
  });
});
