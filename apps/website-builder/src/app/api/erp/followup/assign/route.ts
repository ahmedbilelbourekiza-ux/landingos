import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { seesWholeBook } from "@/lib/erp/scope";
import { assignFollowupAgent, eligibleAgents } from "@/lib/erp/assign";
import { notifyOrderAssigned } from "@/lib/erp/notify";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Moving a customer to another follow-up agent — LP.21, closing R13.
 *
 * The legacy's `POST /api/followup/assign`. LP.9 built the RULE
 * (`assignFollowupAgent`) and reached it only through the bulk action; this is
 * the single-order door, which is the one a supervisor uses when a customer has
 * become difficult and needs a senior agent.
 *
 * -----------------------------------------------------------------------------
 * `auto: true` IS NOT THE SAME REQUEST AS AN OMITTED AGENT, AND SAYING SO MATTERS
 *
 * The legacy's `assignFollowup(id, { agent, auto })` treats a missing agent as
 * "auto" only when `auto` was asked for. Here the same distinction is enforced at
 * the edge: a body with neither `userId` nor `auto: true` is a 422 rather than a
 * silent automatic assignment. A supervisor who meant to name somebody and sent
 * an empty select must not discover that the system picked for them.
 *
 * MANAGER-ONLY, because `followupUserId` is a REASSIGNMENT field and
 * `buildPatch` answers `403 FORBIDDEN_FIELD` for anybody else. One rule, two
 * doors, and this door does not widen it.
 *
 * WHOEVER RECEIVES THE WORK IS TOLD. `notifyOrderAssigned` is what the ERP's
 * `broadcast({type:'followup_assigned'})` was for: work that lands in somebody's
 * queue silently is work nobody knows they have.
 * ========================================================================== */

const Assign = z.object({
  orderId: z.string().trim().min(1).max(64),
  /** A named person. Omit and set `auto` to let the workload rule choose. */
  userId: z.string().trim().max(64).optional(),
  auto: z.boolean().optional(),
});

export const POST = tenantRoute("erp:orders:write", async ({ db, req, session }) => {
  const parsed = Assign.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { orderId, userId, auto } = parsed.data;

  if (!seesWholeBook(session)) {
    return apiError(403, "FORBIDDEN", "Only a manager can assign a follow-up agent.");
  }

  // See the header: an empty body is not a request for automatic assignment.
  if (!userId && auto !== true) {
    return apiError(
      422,
      "NO_ASSIGNEE",
      "Name a follow-up agent, or ask for automatic assignment explicitly.",
    );
  }

  const tenantId = session.auth!.tenantId;

  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: { id: true, reference: true, followupUserId: true },
  });
  // 404 for another tenant's order, and for one that does not exist. RLS
  // produces the first without this route filtering anything.
  if (!order) return apiError(404, "NOT_FOUND", "No such order.");

  const chosen = await assignFollowupAgent(db, tenantId, orderId, {
    userId: userId ?? null,
    actorUserId: session.user.id,
  });

  if (!chosen) {
    /* Two different problems, and the caller can act on the difference: nobody
     * carries the follow-up job role at all (a settings problem), or the person
     * they named is not eligible right now — suspended, on a day off, or
     * without `erp:orders:write` (D-06.6). A single "failed" would send a
     * supervisor to the wrong screen. */
    const eligible = await eligibleAgents(db, tenantId, "followup");
    return eligible.length === 0
      ? apiError(
          422,
          "NO_FOLLOWUP_AGENTS",
          "Nobody on this team carries the follow-up job role, so there is nobody to assign to.",
        )
      : apiError(
          422,
          "NOT_ELIGIBLE",
          "That person cannot take follow-up work right now — check their job role, their days off and whether they are suspended.",
          { eligible },
        );
  }

  // Only when it MOVED. Re-assigning somebody to the order they already hold
  // would otherwise notify them of work they have had all week.
  if (chosen !== order.followupUserId) {
    await notifyOrderAssigned(db, tenantId, { ...order, agentUserId: chosen });
  }

  return apiOk({ orderId, followupUserId: chosen, auto: !userId });
});
