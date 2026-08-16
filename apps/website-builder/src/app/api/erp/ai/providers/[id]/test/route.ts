import { withTenant } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { testAiConnection } from "@/lib/erp/ai-connection";
import { logIntegration } from "@/lib/erp/integration-log";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * Test Connection for a model provider — AUDIT.5.
 *
 * The writer for `lastTestAt` / `lastTestOk`, which three readers have been
 * rendering since LP.17 and nothing has ever set. See `ai-connection.ts` for why
 * LP.17's stated reason for deferring this ("testing a provider means calling a
 * model") turned out not to describe the legacy it was describing.
 *
 * THE THREE PHASES, D-LP.5.1, the same shape as `carriers/[id]/test`:
 *   plan   — read the config INSIDE the transaction
 *   call   — contact the provider in NO transaction, through `afterCommit`
 *   record — write the outcome in a fresh, short one
 *
 * `apiKey` IS loaded here — one of exactly TWO routes in the AI surface that
 * load it (the other is LB.24's `/api/builder/landings/generate`, which spends
 * it). Every other route leaves it out of its select on purpose so a key cannot
 * leak through a response; this one needs it to authenticate and **never puts it
 * in the response or the log** — `logIntegration.redact` strips it by key even if
 * a future edit passes it, and the URL recorded for Gemini is deliberately the
 * one without the query string.
 * ========================================================================== */

export const POST = tenantRoute<Params>("erp:settings:write", async ({ db, session, params, afterCommit }) => {
  const provider = await db.aiProvider.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, type: true, baseUrl: true,
      apiKey: true, defaultModel: true, timeoutMs: true,
    },
  });
  if (!provider) return apiError(404, "NOT_FOUND", "No such provider.");

  const tenantId = session.auth!.tenantId;
  const cfg = {
    type: provider.type,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultModel: provider.defaultModel,
    timeoutMs: provider.timeoutMs,
  };

  afterCommit(async () => {
    const result = await testAiConnection(cfg);
    const testedAt = new Date();

    await withTenant(tenantId, async (tx) => {
      await tx.aiProvider.update({
        where: { id: params.id },
        data: { lastTestAt: testedAt, lastTestOk: result.ok },
      });
      await logIntegration(tx, tenantId, {
        entity: "aiProvider",
        entityId: params.id,
        event: result.ok ? "test_connection" : "auth_error",
        result: result.ok ? "success" : "failure",
        message: result.message,
        // The endpoint and the type. Never the key, and never the model output.
        request: { url: result.url ?? null, type: provider.type, method: "test" },
        response: { ok: result.ok },
      });
    });

    return apiOk({
      ok: result.ok,
      message: result.message,
      type: provider.type,
      testedAt: testedAt.toISOString(),
    });
  });

  // Replaced by `afterCommit`. Returned so the handler has a value either way.
  return apiOk({ ok: false, message: "" });
});
