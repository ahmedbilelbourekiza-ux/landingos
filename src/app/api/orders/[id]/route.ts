import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/api-response";

// GET /api/orders/[id] — full order with landing page details for the details view
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const order = await db.order.findUnique({
      where: { id },
      include: {
        landingPage: {
          select: {
            id: true,
            title: true,
            slug: true,
            media: { where: { placement: "GALLERY" }, take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "asc" },
          select: { id: true, fromStatus: true, toStatus: true, createdAt: true },
        },
      },
    });

    if (!order) return fail("NOT_FOUND", "Order not found", 404);

    const data = {
      id: order.id,
      orderNumber: order.id.slice(-8).toUpperCase(),
      customerName: order.customerName,
      phone: order.phone,
      wilaya: order.wilaya,
      baladia: order.baladia,
      address: order.address,
      notes: order.notes,
      quantity: order.quantity,
      variants: JSON.parse(order.variants) as { name: string; value: string }[],
      productPrice: order.productPrice.toNumber(),
      shippingPrice: order.shippingPrice.toNumber(),
      totalPrice: order.totalPrice.toNumber(),
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      landing: order.landingPage
        ? {
            id: order.landingPage.id,
            title: order.landingPage.title,
            slug: order.landingPage.slug,
            thumbnail: order.landingPage.media[0]?.url ?? "",
          }
        : null,
      statusHistory: order.statusHistory.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        createdAt: h.createdAt.toISOString(),
      })),
    };

    return ok(data);
  } catch (error) {
    console.error("[api/orders/[id]] GET error:", error);
    return serverError("Failed to fetch order");
  }
}

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
