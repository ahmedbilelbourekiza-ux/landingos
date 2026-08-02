import { tenantRoute, apiOk } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Mark the moment an agent starts dialling.
 *
 * This is what makes call duration measurable, and duration is what makes the
 * suspicious-call flag mean anything: without a start time, "confirmed" is a
 * claim with nothing behind it. An agent who never calls this and logs results
 * anyway is flagged separately (`noStart`), so a manager can tell "hung up in
 * four seconds" from "never dialled at all".
 */
export const POST = tenantRoute<Params>("erp:orders:write", async ({ db, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const started = new Date();
  await db.fulfillmentOrder.update({
    where: { id: params.id },
    data: { pendingCallStart: started },
  });
  return apiOk({ startedAt: started.toISOString() });
});
