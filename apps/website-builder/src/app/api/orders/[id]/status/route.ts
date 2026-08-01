import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { triggerOrderWebhook } from "@/lib/webhooks/triggers";

// Valid status transitions. Each status maps to the set of statuses it can
// transition to. CANCELLED is terminal — no transitions out. DELIVERED is
// terminal — no transitions out. Any status except DELIVERED can go to
// CANCELLED.
const VALID_TRANSITIONS: Record<string, string[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

const statusSchema = z.object({
  toStatus: z.enum(["NEW", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"]),
});

// PATCH /api/orders/[id]/status — transition the order to a new status.
// Validates the transition is allowed, updates the order, and creates a
// timestamped history entry. Returns the updated order + full history.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const order = await db.order.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!order) return fail("NOT_FOUND", "Order not found", 404);

    // Validate transition
    const allowed = VALID_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(parsed.data.toStatus)) {
      return fail(
        "INVALID_TRANSITION",
        `Cannot transition from ${order.status} to ${parsed.data.toStatus}`,
        422,
      );
    }

    // Update order + create history entry in a transaction
    const [updatedOrder] = await db.$transaction([
      db.order.update({
        where: { id },
        data: { status: parsed.data.toStatus },
        select: { id: true, status: true, updatedAt: true },
      }),
      db.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: parsed.data.toStatus,
        },
      }),
    ]);

    // Outgoing CRM webhook. A cancellation gets its own dedicated event so a
    // CRM can react to it specifically; every other transition is an update.
    // Fire-and-forget — a webhook problem must not fail the status change.
    triggerOrderWebhook(
      parsed.data.toStatus === "CANCELLED" ? "order.cancelled" : "order.updated",
      id,
    );

    // Return updated order + full history
    const history = await db.orderStatusHistory.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        createdAt: true,
      },
    });

    return ok({
      order: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        updatedAt: updatedOrder.updatedAt.toISOString(),
      },
      history: history.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        createdAt: h.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[api/orders/[id]/status] PATCH error:", error);
    return serverError("Failed to update order status");
  }
}
