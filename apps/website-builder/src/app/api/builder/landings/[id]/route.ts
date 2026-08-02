import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * A single landing page.
 *
 * Fetching by id needs no tenant check in the query: the binding means another
 * tenant's id simply does not resolve, so this returns 404 rather than leaking
 * that the row exists elsewhere.
 */
export const GET = tenantRoute<Params>("website-builder:read", async ({ db, params }) => {
  const page = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    include: {
      category: { select: { id: true, name: true } },
      media: { orderBy: { displayOrder: "asc" } },
      variants: { orderBy: { displayOrder: "asc" } },
      features: { orderBy: { displayOrder: "asc" } },
      reviews: { orderBy: { displayOrder: "asc" } },
      faqs: { orderBy: { displayOrder: "asc" } },
      setting: true,
    },
  });

  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");
  return apiOk(page);
});

export const DELETE = tenantRoute<Params>("website-builder:pages:write", async ({ db, params }) => {
  const { count } = await (db as any).landingPage.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That page does not exist.");
  return apiOk({ id: params.id });
});
