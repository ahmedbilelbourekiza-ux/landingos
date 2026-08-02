import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { ALL_AI_PERMISSIONS } from "@/lib/erp/ai";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

const SELECT = {
  id: true, name: true, description: true, providerId: true, model: true,
  systemPrompt: true, permissions: true, enabled: true, role: true, createdAt: true,
} as const;

export const GET = tenantRoute("erp:settings:write", async ({ db }) => {
  const items = await db.aiAgent.findMany({ orderBy: { createdAt: "desc" }, select: SELECT });
  return apiOk({ items: items.map(toJson) });
});

const CreateAgent = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  providerId: z.string().trim().max(64).optional(),
  model: z.string().trim().max(200).optional(),
  systemPrompt: z.string().trim().max(20000).optional(),
  permissions: z.array(z.enum(ALL_AI_PERMISSIONS)).optional(),
  enabled: z.coerce.boolean().optional(),
  role: z.string().trim().max(60).optional(),
});

/**
 * Configure an assistant.
 *
 * The permission list stored here is a REQUEST, not a grant — see lib/erp/ai.ts.
 * It is deliberately NOT validated against the creator's own ceiling, because
 * the clamp is applied per CALLER at use time: a manager may reasonably
 * configure an analytics assistant that an agent will later use with
 * `read_analytics` removed. Validating at creation would tie the assistant to
 * whoever happened to make it.
 */
export const POST = tenantRoute("erp:settings:write", async ({ db, req, session }) => {
  const parsed = CreateAgent.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { permissions, ...rest } = parsed.data;
  const created = await db.aiAgent.create({
    data: {
      ...rest,
      tenantId: session.auth!.tenantId,
      permissions: (permissions ?? []) as never,
    },
    select: SELECT,
  });
  return apiOk(toJson(created), { status: 201 });
});
