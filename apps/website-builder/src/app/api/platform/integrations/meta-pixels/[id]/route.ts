import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  pixelId: z.string().trim().regex(/^\d{5,25}$/, "a Meta pixel id is numeric").optional(),
  accessToken: z.string().trim().min(10).max(500).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = tenantRoute<Params>("platform:integrations:manage", async ({ db, req, params }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  const { count } = await (db as any).metaPixelConfig.updateMany({ where: { id: params.id }, data: parsed.data });
  if (count === 0) return apiError(404, "NOT_FOUND", "That pixel does not exist.");
  return apiOk({ id: params.id });
});

export const DELETE = tenantRoute<Params>("platform:integrations:manage", async ({ db, params }) => {
  const { count } = await (db as any).metaPixelConfig.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That pixel does not exist.");
  return apiOk({ id: params.id });
});
