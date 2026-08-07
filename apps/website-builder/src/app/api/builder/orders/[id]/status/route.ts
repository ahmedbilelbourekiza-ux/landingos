import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { triggerOrderWebhook } from "@/lib/webhooks/tenant-triggers";

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

export const PATCH = tenantRoute<Params>("website-builder:orders:read", async ({ db, req, params, session, afterCommit }) => {
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

  // order.updated / order.cancelled were declared and offered to subscribers
  // since the port, and nothing ever fired them — the status change IS the
  // update a CRM cares about (LB.3, W-02's class). After commit, so the
  // trigger's own read sees the new status.
  const tenantId = session.auth!.tenantId;
  const event = parsed.data.toStatus === "CANCELLED" ? "order.cancelled" : "order.updated";
  afterCommit(async () => {
    triggerOrderWebhook(event, tenantId, params.id);
  });

  return apiOk({ id: params.id, status: parsed.data.toStatus });
});
