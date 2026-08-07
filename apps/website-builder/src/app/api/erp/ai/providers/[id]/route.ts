import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * One model provider — LP.17, restoring R10's CRUD half.
 *
 * `POST /ai/providers` existed and nothing could edit or remove what it created,
 * so a provider added with a typo in its base URL was permanent and a key that
 * leaked could not be rotated from the console. The legacy has `PUT`, `DELETE`,
 * `/default` and `/test`; the first three are here.
 *
 * `/test` was NOT, and the reason given here was WRONG — see AUDIT.5. It said
 * "testing a provider means calling a model, which needs an adapter layer this
 * deployment does not have", and the legacy's own adapters say otherwise: two of
 * the three test with `GET /models`, a credential check that runs no inference.
 * The rule the sentence was applying is still right (a button that reports
 * success without contacting anything is the fabricated-tracking-number lie);
 * the premise it applied it to did not survive re-reading the source. It lives at
 * `[id]/test/route.ts` now, with `[id]/logs` for why a test failed.
 * ========================================================================== */

const SELECT = {
  id: true, name: true, type: true, baseUrl: true, defaultModel: true,
  temperature: true, maxTokens: true, timeoutMs: true,
  active: true, isDefault: true, lastTestAt: true, lastTestOk: true, createdAt: true,
} as const;

const UpdateProvider = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.string().trim().max(500).optional(),
  // Absent means "leave it"; an empty string is not accepted as a way to blank
  // one, because a provider with no key is indistinguishable from a broken one.
  apiKey: z.string().trim().min(1).max(500).optional(),
  defaultModel: z.string().trim().max(200).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxTokens: z.coerce.number().int().min(1).max(200_000).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(600_000).optional(),
  active: z.coerce.boolean().optional(),
});

export const PUT = tenantRoute<Params>("erp:settings:write", async ({ db, req, params }) => {
  const parsed = UpdateProvider.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  // `type` is deliberately not editable. It decides which adapter would be used
  // and which fields mean what; changing it in place turns a configured provider
  // into a differently-shaped one with the old provider's credentials in it.
  const existing = await db.aiProvider.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "No such provider.");

  const updated = await db.aiProvider.update({
    where: { id: params.id },
    data: parsed.data,
    select: SELECT,
  });
  return apiOk(toJson(updated));
});

export const DELETE = tenantRoute<Params>("erp:settings:write", async ({ db, params }) => {
  const existing = await db.aiProvider.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "No such provider.");

  // Assistants pointing at it are left in place with a dangling `providerId`
  // rather than cascade-deleted. An assistant is a prompt and a permission set
  // somebody wrote; removing a billing account must not destroy it, and the
  // screen shows the assistant as unconfigured, which is what it now is.
  await db.aiProvider.delete({ where: { id: params.id } });
  return apiOk({ id: params.id, deleted: true });
});
