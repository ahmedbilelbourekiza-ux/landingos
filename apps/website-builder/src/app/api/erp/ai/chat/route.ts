import { tenantRoute, apiError } from "@/lib/api/route";
import { ceilingFor } from "@/lib/erp/ai";
import { readPlatformAiProvider } from "@/lib/platform/platform-ai";

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
export const POST = tenantRoute("erp:ai:use", async ({ session }) => {
  // PF.1 — the platform's provider, not a tenant row. Absent = AI off.
  const provider = await readPlatformAiProvider();
  if (!provider) {
    return apiError(501, "NO_AI_PROVIDER", "AI is not enabled on this platform.");
  }
  return apiError(501, "NOT_IMPLEMENTED", "Model calls are not enabled on this deployment.", {
    permissions: ceilingFor(session),
  });
});
