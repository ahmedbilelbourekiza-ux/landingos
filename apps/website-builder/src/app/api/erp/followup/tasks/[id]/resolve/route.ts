import { tenantRoute, apiOk } from "@/lib/api/route";
import { loadOwnedFollowupTask } from "@/lib/erp/guard";
import { ERP_PRODUCT } from "@/lib/erp/settings";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * "I contacted this customer, it is sorted."
 *
 * The follow-up module watches what carriers report. When a shipment reaches a
 * state that needs a person — the customer was out, the address is wrong, they
 * want it another day — a task is raised against the order. An agent rings them,
 * fixes it, and marks the task done. This is that last step, and it was the only
 * thing `apps/erp` could still do that the platform could not.
 *
 * `erp:orders:write`, not `:read`. Reading the queue is what a member gets by
 * role glob; asserting that a customer was contacted is work, and it is the same
 * class of claim as logging a confirmed call. `loadOwnedFollowupTask` decides
 * WHOSE task it is, with the same 404-not-403 answer the order guard gives.
 *
 * IT SETTLES ONCE. A second call returns the task unchanged rather than moving
 * `resolvedAt`, because when a customer was contacted is a fact about the past —
 * the same reasoning that makes `deliveryOutcome` settle once from the carrier's
 * own event time, so a stray second press cannot rewrite last week.
 *
 * NO SECOND MARKER. The ERP also wrote `orders.callReminderStatus = 'done'`
 * here, and this deliberately does not. On the platform the TASK is the source
 * of truth — the follow-up dashboard counts `FollowupTask.status`, and nothing
 * reads `callReminderStatus` at all. Writing a parallel marker nothing consults
 * is the mirror image of BUG-02 (a column read in eight places and written in
 * none), and two markers for one fact are two things that come to disagree.
 * ========================================================================== */

export const POST = tenantRoute<Params>(
  "erp:orders:write",
  async ({ db, session, params }) => {
    const { task, denied } = await loadOwnedFollowupTask(db, session, params.id);
    if (denied) return denied;

    if (task.status === "done") {
      return apiOk(toJson(task));
    }

    const resolved = await db.followupTask.update({
      where: { id: task.id },
      data: { status: "done", resolvedAt: new Date() },
      select: {
        id: true, orderId: true, type: true, status: true,
        agentUserId: true, dueAt: true, resolvedAt: true,
      },
    });

    // Who closed it, against the order it is about. The ERP audited this as
    // `followup_reminder_resolved`; the payload names the task rather than
    // copying its fields, because the row itself is still there to read.
    await db.auditEvent.create({
      data: {
        tenantId: session.auth!.tenantId,
        userId: session.user.id,
        product: ERP_PRODUCT,
        entity: "order",
        entityId: task.orderId,
        action: "followup_resolved",
        payload: { taskId: task.id },
      },
    });

    return apiOk(toJson(resolved));
  },
);
