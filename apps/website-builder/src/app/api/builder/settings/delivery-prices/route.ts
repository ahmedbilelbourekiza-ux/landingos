import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * Per-wilaya delivery prices for this tenant.
 *
 * Was GlobalDeliveryPrice — "global" meaning global to the one store that
 * existed. Under multi-tenancy these are one company's prices, and the old
 * name would have actively misled. The wilaya list itself stays shared
 * platform reference data.
 */
export const GET = tenantRoute("website-builder:read", async ({ db }) => {
  const [wilayas, prices] = await Promise.all([
    (db as any).wilaya.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, nameAr: true } }),
    (db as any).tenantDeliveryPrice.findMany(),
  ]);

  const byWilaya = new Map(prices.map((p: any) => [p.wilayaId, p]));
  return apiOk({
    items: wilayas.map((w: any) => ({
      ...w,
      homePrice: byWilaya.get(w.id)?.homePrice ?? null,
      deskPrice: byWilaya.get(w.id)?.deskPrice ?? null,
    })),
  });
});

const Body = z.object({
  items: z.array(
    z.object({
      wilayaId: z.coerce.number().int(),
      homePrice: z.coerce.number().nonnegative(),
      deskPrice: z.coerce.number().nonnegative().nullable().optional(),
    }),
  ).max(100),
});

export const PUT = tenantRoute("website-builder:settings:write", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const tenantId = session.auth!.tenantId;

  // Upsert per row rather than delete-then-insert: a wilaya the caller did not
  // mention keeps its price instead of silently becoming unpriced, which would
  // break checkout for that region.
  // Sequential inside the tenant transaction withTenant already opened.
  for (const row of parsed.data.items) {
    await (db as any).tenantDeliveryPrice.upsert({
      where: { tenantId_wilayaId: { tenantId, wilayaId: row.wilayaId } },
      update: { homePrice: row.homePrice, deskPrice: row.deskPrice ?? null },
      create: { tenantId, wilayaId: row.wilayaId, homePrice: row.homePrice, deskPrice: row.deskPrice ?? null },
    });
  }

  return apiOk({ updated: parsed.data.items.length });
});
