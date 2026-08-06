import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { readIntegrationLogs } from "@/lib/erp/integration-log";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * What has passed between this company and this storefront — LP.15, R8.
 *
 * `IntegrationLog` got its first writer in LP.14 for carriers; `salesChannel` is
 * the other half of the enum and had none. It is the only place an operator can
 * find out WHY an order never arrived: a webhook whose signature did not verify,
 * a payload no adapter recognised, an access token the platform rejected. The
 * alternative diagnosis is "orders stopped", which is what a tenant reports
 * three days later.
 *
 * `erp:settings:write`, matching the rest of the channel surface: this is
 * diagnostic data about a configured integration, and the people who need it are
 * the ones who can change the configuration. Credentials never reach the table —
 * see `redact`.
 */
export const GET = tenantRoute<Params>("erp:settings:write", async ({ db, params, searchParams }) => {
  const channel = await db.salesChannel.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!channel) return apiError(404, "NOT_FOUND", "No such sales channel.");

  const items = await readIntegrationLogs(
    db,
    "salesChannel",
    params.id,
    Number(searchParams.get("limit")) || 100,
  );
  return apiOk({ items, total: items.length });
});
