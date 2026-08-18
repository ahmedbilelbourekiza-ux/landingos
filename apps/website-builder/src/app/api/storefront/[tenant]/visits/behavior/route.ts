import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { allowRequest, clientIp, visitLimit } from "@/lib/storefront/rate-limit";
import { VisitBehaviorBody } from "@/lib/storefront/contract";

export const dynamic = "force-dynamic";

/* =============================================================================
 * BH.1 — the exit beacon: in-page behavior lands on the view's OWN row.
 *
 * The visits route's rules, inherited whole: every refusal is a silent 204
 * (a background beacon must never error at a customer, and a distinguishing
 * refusal would be a probe), the per-IP budget is the same bucket the
 * arrival beacon draws from, and everything is bounded at the contract
 * because these values feed the Traffic screen's averages.
 *
 * OPT-IN IS ENFORCED HERE, not just client-side: behavior tracking is
 * per-page and default-off (user decision, BH), and the collector not
 * arming is only politeness — this route re-reads the page's own
 * `behaviorTracking` and refuses the update without it, so a hand-rolled
 * beacon cannot opt a merchant's page in from the outside.
 *
 * UPDATE, never create: a behavior flush for a row that does not exist (or
 * that this tenant's binding cannot see — RLS) writes NOTHING. Re-flushes
 * overwrite: the client's counters are monotonic, so a later flush only
 * ever knows more than an earlier one.
 * ========================================================================== */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  if (!allowRequest("visit", clientIp(req), visitLimit(), 5 * 60 * 1000)) {
    return new NextResponse(null, { status: 204 });
  }

  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return new NextResponse(null, { status: 204 });

  const parsed = VisitBehaviorBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const { viewId, ...behavior } = parsed.data;

  try {
    await withTenant(tenant.id, async (db) => {
      const visit = await (db as any).storefrontVisit.findFirst({
        where: { viewId },
        select: { id: true, pageKind: true, landingPageId: true },
      });
      // Behavior belongs to landing views only — the store home and the
      // category pages have no per-page opt-in to grant it.
      if (!visit || visit.pageKind !== "landing" || !visit.landingPageId) return;

      const setting = await (db as any).landingSetting.findUnique({
        where: { landingPageId: visit.landingPageId },
        select: { behaviorTracking: true },
      });
      if (!setting?.behaviorTracking) return;

      // Only the fields this flush carried — undefined touches nothing, so
      // a partial flush cannot null out an earlier, fuller one.
      await (db as any).storefrontVisit.update({
        where: { id: visit.id },
        data: behavior,
      });
    });
  } catch (error) {
    console.error("[storefront] behavior beacon failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
