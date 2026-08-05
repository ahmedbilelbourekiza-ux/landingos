import { tenantRoute, apiOk } from "@/lib/api/route";
import { readBilling } from "@/lib/platform/billing";

export const dynamic = "force-dynamic";

/* =============================================================================
 * GET /api/platform/billing — Phase 7.2.
 *
 * `platform:billing:read` is on the SENSITIVE list, so no role glob reaches it:
 * OWNER and ADMIN hold it through a bare `*`, and a MANAGER — who runs a call
 * centre day to day — does not decide what the company pays for. Like the team
 * surface it is NOT entitlement-gated (`productOf("platform:…")` is null), so a
 * company whose subscription lapsed still manages its own billing; otherwise a
 * bounced invoice removes the ability to fix the bounced invoice.
 * ========================================================================== */

export const GET = tenantRoute("platform:billing:read", async ({ db }) => {
  return apiOk(await readBilling(db));
});
