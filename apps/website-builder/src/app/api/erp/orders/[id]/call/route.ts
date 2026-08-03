import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { addCall, updateOrder, CALL_RESULTS } from "@/lib/erp/orders";
import { readSettings } from "@/lib/erp/settings";
import { onOrderConfirmed } from "@/lib/erp/confirm";
import { notifySuspiciousCall } from "@/lib/erp/notify";

export const dynamic = "force-dynamic";

type Params = { id: string };

const LogCall = z.object({
  result: z.string().trim().min(1),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Log the outcome of a confirmation call.
 *
 * The result moves the order's status, which is the one place in the ERP where
 * an agent's own action changes a number they are paid on — so this is also the
 * route the suspicious-call flag exists to watch. See addCall.
 */
export const POST = tenantRoute<Params>("erp:orders:write", async ({ db, req, session, params }) => {
  const { order, denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const parsed = LogCall.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", "A call result is required.");
  }
  const result = parsed.data.result;

  if (!CALL_RESULTS.includes(result as (typeof CALL_RESULTS)[number])) {
    // The valid set travels with the refusal. A console that has to hardcode
    // the list is a console that drifts from the server the next time the
    // call-centre invents an outcome.
    return apiError(422, "INVALID_RESULT", `"${result}" is not a call result.`, {
      valid: [...CALL_RESULTS],
    });
  }

  const settings = await readSettings(db);
  const call = await addCall(db, session.auth!.tenantId, order, {
    result,
    note: parsed.data.note ?? null,
    agentUserId: session.user.id,
    minCallSeconds: Number(settings.minCallSeconds) || 0,
  });

  // The result IS the new status. They share a vocabulary on purpose — a call
  // that ends "cancelled" leaves an order that is cancelled, and keeping two
  // words for one fact is how they come to disagree.
  const tenantId = session.auth!.tenantId;
  await updateOrder(db, tenantId, params.id, { status: result });

  // Confirming books the parcel and hands the order to a follow-up agent, when
  // the tenant has asked for either. Both live in one place because `PATCH`
  // reaches the same state and must not behave differently — see confirm.ts.
  const confirmed =
    result === "confirmed"
      ? await onOrderConfirmed(db, tenantId, params.id, settings)
      : { shipmentBooked: false, followupUserId: null };

  // The flag is only worth having if somebody is told. Manager-only, and
  // deliberately not the agent it is about — see notifySuspiciousCall.
  if (call.suspicious) {
    const stamped = await db.fulfillmentOrder.findUnique({
      where: { id: params.id },
      select: { id: true, reference: true },
    });
    if (stamped) {
      await notifySuspiciousCall(
        db, tenantId, stamped,
        call.noStart ? "no call was started" : "the call was shorter than the threshold",
      );
    }
  }

  return apiOk({
    message: "logged",
    callId: call.id,
    suspicious: call.suspicious,
    shipmentBooked: confirmed.shipmentBooked,
    followupUserId: confirmed.followupUserId,
  });
});
