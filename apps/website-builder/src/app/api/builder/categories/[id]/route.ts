import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

const PatchCategory = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  icon: z.string().trim().max(80).optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
  isVisible: z.coerce.boolean().optional(),
});

export const PATCH = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, params }) => {
  const parsed = PatchCategory.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  // updateMany rather than update: it matches nothing for another tenant's id
  // instead of throwing a Prisma "record not found", which is the difference
  // between a clean 404 and a 500.
  const { count } = await (db as any).category.updateMany({
    where: { id: params.id },
    data: parsed.data,
  });
  if (count === 0) return apiError(404, "NOT_FOUND", "That category does not exist.");
  return apiOk({ id: params.id });
});

export const DELETE = tenantRoute<Params>("website-builder:pages:write", async ({ db, params }) => {
  const { count } = await (db as any).category.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That category does not exist.");
  return apiOk({ id: params.id });
});
