import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

const SELECT = {
  id: true, name: true, type: true, baseUrl: true, defaultModel: true,
  temperature: true, maxTokens: true, timeoutMs: true,
  active: true, isDefault: true, lastTestAt: true, lastTestOk: true, createdAt: true,
} as const;

/**
 * Model providers.
 *
 * `apiKey` is absent from the select, not masked in a later step. A key that is
 * never loaded cannot be leaked by a logger, a spread, or a field added to the
 * response six months from now — and this one bills the tenant per token.
 *
 * Manager-only: configuring a provider means choosing what the company spends
 * money on.
 */
export const GET = tenantRoute("erp:settings:write", async ({ db }) => {
  const items = await db.aiProvider.findMany({ orderBy: { createdAt: "desc" }, select: SELECT });
  return apiOk({ items: items.map(toJson) });
});

const CreateProvider = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["openai-compat", "gemini", "anthropic"]),
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(500).optional(),
  defaultModel: z.string().trim().max(200).optional(),
});

export const POST = tenantRoute("erp:settings:write", async ({ db, req, session }) => {
  const parsed = CreateProvider.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const created = await db.aiProvider.create({
    data: { ...parsed.data, tenantId: session.auth!.tenantId },
    select: SELECT,
  });
  return apiOk(toJson(created), { status: 201 });
});
