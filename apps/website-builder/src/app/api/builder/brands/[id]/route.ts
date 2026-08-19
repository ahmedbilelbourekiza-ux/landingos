import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

const PatchBrand = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  logo: z.string().trim().max(2000).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  isVisible: z.coerce.boolean().optional(),
  /** SET semantics: the stored links become exactly this list. Omitted =
   * links untouched; empty array = unlink everything. */
  categoryIds: z.array(z.string()).max(50).optional(),
});

export const PATCH = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = PatchBrand.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { categoryIds, ...data } = parsed.data;
  const tenantId = session.auth!.tenantId;

  if (categoryIds?.length) {
    const found = await (db as any).category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true },
    });
    if (found.length !== new Set(categoryIds).size) {
      return apiError(422, "INVALID_REFERENCE", "One of those categories does not exist.");
    }
  }

  // updateMany, the categories route's rule: another tenant's id matches
  // nothing — a clean 404, not a Prisma throw. A body carrying ONLY
  // categoryIds has no columns to update, and updateMany with empty data
  // reports zero rows — so existence is asked directly on that path.
  if (Object.keys(data).length) {
    const { count } = await (db as any).brand.updateMany({
      where: { id: params.id },
      data,
    });
    if (count === 0) return apiError(404, "NOT_FOUND", "That brand does not exist.");
  } else {
    const exists = await (db as any).brand.findFirst({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) return apiError(404, "NOT_FOUND", "That brand does not exist.");
  }

  if (categoryIds) {
    // Replace-the-set inside the wrapper's one transaction: both statements
    // commit together or neither does.
    await (db as any).brandCategory.deleteMany({ where: { brandId: params.id } });
    if (categoryIds.length) {
      await (db as any).brandCategory.createMany({
        data: [...new Set(categoryIds)].map((categoryId) => ({
          tenantId,
          brandId: params.id,
          categoryId,
        })),
      });
    }
  }

  return apiOk({ id: params.id });
});

export const DELETE = tenantRoute<Params>("website-builder:pages:write", async ({ db, params }) => {
  // Pages survive by schema (brandId SetNull); the join rows cascade. The
  // LB.34 rule holds: nothing reachable from a brand can shred an order.
  const { count } = await (db as any).brand.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That brand does not exist.");
  return apiOk({ id: params.id });
});
