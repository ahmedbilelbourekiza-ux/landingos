import { tenantRoute, apiOk } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * The nine-slot attempts matrix.
 *
 * Three calls a day for three days is the call-centre's own escalation rule:
 * after the ninth unanswered attempt an order stops being worked and becomes
 * unreachable. The grid is what an agent looks at to know where they are in
 * that sequence, so the shape is fixed at nine whether or not nine calls exist
 * — a matrix that grows with the data would not show the remaining attempts,
 * which is the half an agent actually needs.
 */
const SLOTS = 9;

export const GET = tenantRoute<Params>("erp:orders:read", async ({ db, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const calls = await db.orderCall.findMany({
    where: { orderId: params.id, result: { not: null } },
    orderBy: [{ time: "asc" }, { id: "asc" }],
    select: { result: true, time: true, suspicious: true },
  });

  const matrix = Array.from({ length: SLOTS }, (_, i) => {
    const call = calls[i];
    return call
      ? { slot: i + 1, used: true, result: call.result, at: call.time?.toISOString() ?? null, suspicious: call.suspicious }
      : { slot: i + 1, used: false, result: null, at: null, suspicious: null };
  });

  return apiOk({ matrix, totalCalls: calls.length, remaining: Math.max(0, SLOTS - calls.length) });
});
