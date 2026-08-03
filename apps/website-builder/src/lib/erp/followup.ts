import "server-only";

import type { TenantDb } from "@landingos/db";

import { readSettings } from "./settings";

/* =============================================================================
 * The follow-up module's PRODUCER — Phase 6.5a.
 *
 * Ported from `onDeliveryStatus` in apps/erp/lib/followup.js, which was the half
 * of this feature Phase 5 never carried across. Until now the platform could
 * list, count and resolve follow-up tasks that nothing was able to create — a
 * gap invisible to a contract test over HTTP, because a producer nobody calls
 * has no endpoint to attack.
 *
 * WHAT A TASK MEANS. Not "the parcel moved" — that is the shipment timeline.
 * A task means A PERSON MUST RING THIS CUSTOMER: they were out, the address is
 * wrong, they want it another day, it is sitting at an office nobody has
 * collected it from. Everything below exists to keep that distinction sharp,
 * because a queue that fills up with parcels moving normally is a queue nobody
 * reads.
 * ========================================================================== */

/**
 * CRM statuses that always require a call, whatever the carrier called them.
 *
 * Deliberately short. `refused` and `returned` are the two states where the
 * parcel has come back and somebody has to find out why; everything else is
 * caught by wording, below.
 */
export const CALL_REQUIRED_CRM_STATUSES = ["refused", "returned"] as const;

/**
 * ...and the carrier's own words, which are usually the only signal.
 *
 * Algerian carriers write "Client absent", "Adresse erronée", "Reporté par le
 * client" and map all of them onto whatever their API calls "in progress". The
 * mapped status therefore says nothing useful; the ORIGINAL text does. This is
 * why `statusRequiresCall` is a two-part rule and not a status lookup, and it is
 * ported verbatim in behaviour from the ERP.
 */
export const CALL_REQUIRED_KEYWORDS: readonly RegExp[] = [
  /absent|unavailable|injoignable/i,
  /fail|échec|echec|échouée|echouee/i,
  /retour|return/i,
  /adresse|address|erronée|erronee/i,
  /report|delay|délai|delai|postpone/i,
  /annul.*client|client.*annul|refus/i,
  // Returned to agency, or held at an office nobody has collected from.
  /bureau|agence|office/i,
];

/** Does this delivery update need a human to ring the customer? */
export function statusRequiresCall(crmStatus?: string | null, originalStatus?: string | null): boolean {
  if (crmStatus && (CALL_REQUIRED_CRM_STATUSES as readonly string[]).includes(crmStatus)) {
    return true;
  }
  const text = `${crmStatus ?? ""} ${originalStatus ?? ""}`.trim();
  return Boolean(text) && CALL_REQUIRED_KEYWORDS.some((re) => re.test(text));
}

export const FOLLOWUP_TASK_TYPE = "call_customer";

/**
 * Raise a follow-up task for this order, or refresh the one already open.
 *
 * ONE OPEN TASK PER ORDER, and that is the whole of the idempotency story here.
 * Carriers replay their backlogs — the delivery suite exists partly because of
 * it — so a second report of the same trouble must not mean two agents ringing
 * the same customer about the same thing, and an escalation that never clears.
 * An existing open task has its countdown and reason refreshed instead.
 *
 * A RESOLVED TASK IS NOT REOPENED. `status: "open"` in the lookup is doing that:
 * once an agent has said they dealt with it, a replayed history must not undo
 * their work. A genuinely new problem arrives as a status TRANSITION, and the
 * caller only invokes this on one.
 *
 * The countdown is the tenant's `followupReminderMinutes` — the same setting the
 * automation screen edits and the escalation job reads.
 */
export async function raiseFollowupTask(
  db: TenantDb,
  tenantId: string,
  orderId: string,
  event: { crmStatus?: string | null; originalStatus?: string | null; description?: string | null },
): Promise<{ id: string; created: boolean } | null> {
  if (!statusRequiresCall(event.crmStatus, event.originalStatus)) return null;

  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: { id: true, followupUserId: true },
  });
  if (!order) return null;

  const settings = await readSettings(db);
  const minutes = Number(settings.followupReminderMinutes) || 120;
  const dueAt = new Date(Date.now() + minutes * 60_000);

  // What the carrier actually said, preferred over the mapped status — it is
  // what tells the agent why they are ringing.
  const reason =
    (event.description || "").trim() ||
    (event.originalStatus || "").trim() ||
    (event.crmStatus || "").trim();

  const existing = await db.followupTask.findFirst({
    where: { orderId, type: FOLLOWUP_TASK_TYPE, status: "open" },
    select: { id: true },
  });

  if (existing) {
    await db.followupTask.update({
      where: { id: existing.id },
      data: { dueAt, reason },
    });
    return { id: existing.id, created: false };
  }

  const created = await db.followupTask.create({
    data: {
      tenantId,
      orderId,
      type: FOLLOWUP_TASK_TYPE,
      status: "open",
      dueAt,
      // Whoever is already following this order up. Unassigned is fine and is
      // work anybody may pick up — `loadOwnedFollowupTask` allows exactly that.
      agentUserId: order.followupUserId ?? null,
      reason,
    },
    select: { id: true },
  });

  return { id: created.id, created: true };
}
