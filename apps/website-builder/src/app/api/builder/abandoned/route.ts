import { tenantRoute, apiOk, pagination } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * Abandoned checkouts — visitors who started the order form and never
 * submitted. Contains recovered phone numbers, so it is gated behind the same
 * permission as orders rather than plain read.
 */
export const GET = tenantRoute("website-builder:orders:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);

  // A draft that later became an order is not abandoned — it was a lead that
  // took a while. Excluding them is what makes this list actionable.
  const where = searchParams.get("includeConverted") === "1" ? {} : { convertedOrderId: null };

  const [items, total] = await Promise.all([
    (db as any).draftOrder.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      select: {
        id: true, customerName: true, phone: true, wilaya: true, baladia: true,
        quantity: true, totalPrice: true, createdAt: true, updatedAt: true,
        convertedOrderId: true, convertedAt: true,
        landingPage: { select: { id: true, title: true } },
      },
    }),
    (db as any).draftOrder.count({ where }),
  ]);

  return apiOk({ items, page, pageSize, total });
});
