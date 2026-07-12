import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/api-response";

// DELETE /api/orders/[id] — delete a single order
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const order = await db.order.findUnique({ where: { id }, select: { id: true } });
    if (!order) return fail("NOT_FOUND", "Order not found", 404);

    await db.order.delete({ where: { id } });
    return ok({ id });
  } catch (error) {
    console.error("[api/orders/[id]] DELETE error:", error);
    return serverError("Failed to delete order");
  }
}
