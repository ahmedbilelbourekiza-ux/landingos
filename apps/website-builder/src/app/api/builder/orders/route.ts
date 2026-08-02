import { tenantRoute, apiOk, pagination } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * Sales orders — the immutable commercial record of what a customer bought.
 *
 * Was `Order`; renamed in 3.2 because the ERP's operational order is a
 * different model with a different lifecycle. The relationship between the two
 * is Phase 5.4.
 */
export const GET = tenantRoute("website-builder:orders:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const status = searchParams.get("status")?.trim();
  const search = searchParams.get("search")?.trim();

  const where = {
    ...(status ? { status: status as never } : {}),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    (db as any).salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, customerName: true, phone: true, wilaya: true, baladia: true,
        quantity: true, totalPrice: true, status: true, shippingMethod: true,
        createdAt: true,
        landingPage: { select: { id: true, title: true } },
      },
    }),
    (db as any).salesOrder.count({ where }),
  ]);

  return apiOk({ items, page, pageSize, total });
});
