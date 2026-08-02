import { tenantRoute, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * The streaming endpoint SEC-03 was filed against.
 *
 * It was unauthenticated, and with `agentId` omitted it fell back to an
 * assistant holding every permission including `read_customers` — so a stranger
 * could have the model read out the customer database on the owner's token
 * budget. GET, so a bare URL was enough.
 *
 * It is behind `tenantRoute` now, which means a session, an active tenant, the
 * entitlement and the permission, in that order. The exfiltration path is
 * closed whether or not a model is ever wired up behind it.
 */
export const GET = tenantRoute("erp:ai:use", async () =>
  apiError(501, "NOT_IMPLEMENTED", "Model streaming is not enabled on this deployment."),
);
