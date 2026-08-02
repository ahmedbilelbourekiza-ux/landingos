import { tenantRoute, apiError } from "@/lib/api/route";
import { ceilingFor } from "@/lib/erp/ai";

export const dynamic = "force-dynamic";

/**
 * Ask an assistant something.
 *
 * NOT IMPLEMENTED, and answering 501 rather than 404 on purpose: the route
 * exists, it is gated, and the gate is the half that SEC-03 was about. Calling
 * a model needs a configured provider and a real key, which is deployment
 * configuration rather than a port — but leaving the path unrouted would mean
 * the "every AI route requires a session" contract had a hole in it exactly
 * where the original vulnerability was.
 */
export const POST = tenantRoute("erp:ai:use", async ({ db, session }) => {
  const provider = await db.aiProvider.findFirst({
    where: { active: true },
    select: { id: true },
  });
  if (!provider) {
    return apiError(501, "NO_AI_PROVIDER", "No model provider is configured for this company.");
  }
  return apiError(501, "NOT_IMPLEMENTED", "Model calls are not enabled on this deployment.", {
    permissions: ceilingFor(session),
  });
});
