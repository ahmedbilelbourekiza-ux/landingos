import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { readIntegrationLogs } from "@/lib/erp/integration-log";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * What has passed between this company and this model provider — AUDIT.5.
 *
 * The third entity on `IntegrationLog`, after LP.14's carriers and LP.15's sales
 * channels. Without it a failed test is a red tick and nothing else: an operator
 * cannot tell "the key is wrong" from "the base URL points at a host that does
 * not answer", and those have different fixes.
 *
 * `erp:settings:write`, matching the rest of the AI surface — this is diagnostic
 * data about a configured integration and the people who need it are the ones
 * who can change the configuration. The key never reaches the table; `redact`
 * enforces that on the way in.
 */
export const GET = tenantRoute<Params>("erp:settings:write", async ({ db, params, searchParams }) => {
  const provider = await db.aiProvider.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!provider) return apiError(404, "NOT_FOUND", "No such provider.");

  const items = await readIntegrationLogs(
    db,
    "aiProvider",
    params.id,
    Number(searchParams.get("limit")) || 100,
  );
  return apiOk({ items, total: items.length });
});
