import { tenantRoute, apiOk } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * The full call history for one order.
 *
 * This is the detail view, and it is the ONLY place the history is attached —
 * the list deliberately carries a count instead, because joining it per row is
 * what made the list quadratic.
 *
 * `noStart` is derived on read rather than stored: it is simply "a result was
 * recorded with no start time", and storing a second column that says what two
 * existing columns already say is a third thing that can disagree with them.
 */
export const GET = tenantRoute<Params>("erp:orders:read", async ({ db, session, params }) => {
  const { order, denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const calls = await db.orderCall.findMany({
    where: { orderId: params.id },
    orderBy: [{ time: "asc" }, { id: "asc" }],
    select: {
      id: true, time: true, callStartTime: true, duration: true, threshold: true,
      suspicious: true, result: true, note: true, noteType: true, agentUserId: true,
    },
  });

  return apiOk({
    orderId: order.id,
    currentStatus: order.status,
    calls: calls.map((c) => ({
      ...(toJson(c) as object),
      noStart: Boolean(c.result) && !c.callStartTime,
    })),
  });
});
