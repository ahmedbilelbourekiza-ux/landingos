import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { ALL_AI_PERMISSIONS } from "@/lib/erp/ai";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * One assistant — LP.17, restoring R10's CRUD half.
 *
 * `POST /ai/agents` existed and nothing could edit or remove what it created, so
 * an assistant configured with the wrong system prompt was permanent.
 *
 * The permission list stored here stays a REQUEST rather than a grant, exactly
 * as it is at creation: the clamp is applied per CALLER at use time
 * (`clampPermissions`), so a manager may configure an analytics assistant that an
 * agent later uses with `read_analytics` removed. Validating it against the
 * EDITOR's ceiling would tie the assistant to whoever last touched it, which is
 * a different rule from the one the read path applies.
 */
const SELECT = {
  id: true, name: true, description: true, providerId: true, model: true,
  systemPrompt: true, permissions: true, enabled: true, role: true, createdAt: true,
} as const;

const UpdateAgent = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  providerId: z.string().trim().max(64).optional(),
  model: z.string().trim().max(200).optional(),
  systemPrompt: z.string().trim().max(20000).optional(),
  permissions: z.array(z.enum(ALL_AI_PERMISSIONS)).optional(),
  enabled: z.coerce.boolean().optional(),
  role: z.string().trim().max(60).optional(),
});

export const PUT = tenantRoute<Params>("erp:settings:write", async ({ db, req, params }) => {
  const parsed = UpdateAgent.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const existing = await db.aiAgent.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "No such assistant.");

  const { permissions, ...rest } = parsed.data;
  const updated = await db.aiAgent.update({
    where: { id: params.id },
    data: { ...rest, ...(permissions ? { permissions: permissions as never } : {}) },
    select: SELECT,
  });
  return apiOk(toJson(updated));
});

export const DELETE = tenantRoute<Params>("erp:settings:write", async ({ db, params }) => {
  const existing = await db.aiAgent.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "No such assistant.");
  await db.aiAgent.delete({ where: { id: params.id } });
  return apiOk({ id: params.id, deleted: true });
});
