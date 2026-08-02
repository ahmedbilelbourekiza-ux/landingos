import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

export const GET = tenantRoute<Params>("website-builder:orders:read", async ({ db, params }) => {
  const order = await (db as any).salesOrder.findUnique({
    where: { id: params.id },
    include: {
      landingPage: { select: { id: true, title: true, slug: true } },
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) return apiError(404, "NOT_FOUND", "That order does not exist.");
  return apiOk(order);
});
