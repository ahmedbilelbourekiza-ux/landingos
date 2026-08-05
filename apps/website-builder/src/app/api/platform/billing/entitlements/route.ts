import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { normaliseEntitlements, setEntitlements } from "@/lib/platform/billing";

export const dynamic = "force-dynamic";

/* =============================================================================
 * PUT /api/platform/billing/entitlements — Phase 7.2.
 *
 * Sets the tenant's entitlement set. The valuable property the whole slice
 * exists for: `resolveSession` re-reads `Subscription` on every request, so a
 * change here takes effect on the caller's NEXT call — drop `product.erp` and
 * every ERP route 403s immediately, with no re-login and no cache flush.
 *
 * The body is validated against the registry's known product entitlements. An
 * unknown key is refused rather than silently stored: a typo held in the row
 * and then doing nothing is worse than a named refusal.
 * ========================================================================== */

const Body = z.object({
  entitlements: z.array(z.string()),
});

export const PUT = tenantRoute("platform:billing:write", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const entitlements = normaliseEntitlements(parsed.data.entitlements);
  if (entitlements === null) {
    return apiError(
      422,
      "INVALID_INPUT",
      "One or more entitlements are not recognised product entitlements.",
    );
  }

  const view = await setEntitlements(
    db,
    session.auth!.tenantId,
    entitlements,
    session.user.id,
  );
  return apiOk(view);
});
