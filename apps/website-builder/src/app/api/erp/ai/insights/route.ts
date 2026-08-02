import { tenantRoute, apiOk } from "@/lib/api/route";
import { ceilingFor } from "@/lib/erp/ai";

export const dynamic = "force-dynamic";

/**
 * Headline numbers for the assistant panel.
 *
 * Computed, not generated: these are counts the caller could already read
 * through the ordinary routes, assembled in one call. Nothing here reaches a
 * model, so it works on a deployment with no provider configured — and it is
 * still scoped, because `erp:finance:read` is what the revenue line needs.
 */
export const GET = tenantRoute("erp:ai:use", async ({ db, session }) => {
  const ceiling = ceilingFor(session);
  const canSeeMoney = ceiling.includes("read_analytics");

  const [orders, pending, delivered] = await Promise.all([
    db.fulfillmentOrder.count(),
    db.fulfillmentOrder.count({ where: { status: "pending" } }),
    db.fulfillmentOrder.count({ where: { deliveryOutcome: "delivered" } }),
  ]);

  const revenue = canSeeMoney
    ? await db.fulfillmentOrder.aggregate({
        where: { deliveryOutcome: "delivered" },
        _sum: { price: true },
      })
    : null;

  return apiOk({
    orders,
    pending,
    delivered,
    // Absent rather than zero when the caller may not see it. A zero would be a
    // lie that reads like a fact.
    ...(revenue ? { deliveredRevenue: (revenue._sum.price ?? 0).toString() } : {}),
    permissions: ceiling,
  });
});
