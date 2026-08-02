import { tenantRoute, apiOk } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * The five buckets the Suivi dashboard renders.
 *
 * Counts only — the rows live behind their own routes. Gated on
 * `erp:finance:read` because this is a whole-company view: it aggregates across
 * every agent's queue and answers "how is the department doing", which the ERP
 * treated as manager-only and D-05.1 preserved.
 *
 * The buckets are the department's actual working states, not order statuses:
 * an order can be confirmed and still need chasing.
 */
export const GET = tenantRoute("erp:finance:read", async ({ db }) => {
  const [waitingFollowup, inDelivery, needsContact, problems, escalation] = await Promise.all([
    db.fulfillmentOrder.count({ where: { status: "confirmed", followupUserId: null } }),
    db.fulfillmentOrder.count({
      where: { deliveryStatus: { in: ["dispatched", "in_transit", "at_office", "out_for_delivery"] } },
    }),
    db.followupTask.count({ where: { status: "open", type: "call_customer" } }),
    db.fulfillmentOrder.count({ where: { deliveryOutcome: "returned" } }),
    db.followupTask.count({ where: { status: "overdue" } }),
  ]);

  return apiOk({
    counts: { waitingFollowup, inDelivery, needsContact, problems, escalation },
  });
});
