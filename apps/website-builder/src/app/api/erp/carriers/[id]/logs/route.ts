import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { readIntegrationLogs } from "@/lib/erp/integration-log";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * What has happened between this company and this carrier — LP.14, R3.
 *
 * `IntegrationLog` was migrated with its indexes and had **no reader and no
 * writer**. Without it the only evidence of a failing integration is a parcel
 * that did not book, and the only diagnosis available to an operator is "try
 * again".
 *
 * `erp:shipments:write` rather than a read permission, deliberately: this is
 * diagnostic data about a configured integration — URLs, adapter keys, a
 * carrier's own refusal messages — and the people who need it are the ones who
 * can change the configuration. Credentials never reach the table at all; see
 * `redact`.
 */
export const GET = tenantRoute<Params>("erp:shipments:write", async ({ db, params, searchParams }) => {
  const carrier = await db.carrier.findUnique({ where: { id: params.id }, select: { id: true } });
  // 404 for a carrier this tenant does not have — confirming a row exists
  // elsewhere is itself information.
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  const items = await readIntegrationLogs(
    db,
    "carrier",
    params.id,
    Number(searchParams.get("limit")) || 100,
  );
  return apiOk({ items, total: items.length });
});
