import { tenantRoute, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/** Model-generated analysis. Gated now; wired up when a provider is configured. */
export const POST = tenantRoute("erp:ai:use", async () =>
  apiError(501, "NOT_IMPLEMENTED", "Model analysis is not enabled on this deployment."),
);
