import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

/**
 * The order lifecycle, unchanged from the legacy implementation.
 *
 * DELIVERED and CANCELLED are terminal. Allowing an edit out of a terminal
 * state would let a delivered order be re-opened, which the financial records
 * downstream have already counted.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

const Body = z.object({
  toStatus: z.enum(["NEW", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"]),
});

export const PATCH = tenantRoute<Params>("website-builder:orders:read", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", "Not a valid order status.");

  const order = await (db as any).salesOrder.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  });
  if (!order) return apiError(404, "NOT_FOUND", "That order does not exist.");

  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(parsed.data.toStatus)) {
    return apiError(
      422,
      "INVALID_TRANSITION",
      `An order cannot move from ${order.status} to ${parsed.data.toStatus}.`,
    );
  }

  // Both writes or neither: a status change with no history entry breaks the
  // audit trail the history table exists to provide. withTenant already opened
  // a transaction, so these two statements are atomic without nesting another.
  await (db as any).salesOrder.updateMany({
    where: { id: params.id },
    data: { status: parsed.data.toStatus },
  });
  await (db as any).salesOrderStatusHistory.create({
    data: {
      orderId: params.id,
      tenantId: session.auth!.tenantId,
      fromStatus: order.status,
      toStatus: parsed.data.toStatus,
    },
  });

  return apiOk({ id: params.id, status: parsed.data.toStatus });
});
