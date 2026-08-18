import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { allowRequest, clientIp, visitLimit } from "@/lib/storefront/rate-limit";
import { VisitBody } from "@/lib/storefront/contract";
import { deriveSource } from "@/lib/storefront/traffic-source";
import { pruneExpiredVisits, shouldAmortisedPrune } from "@/lib/storefront/visit-retention";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The first-party page-view beacon (AN.1).
 *
 * The draft-capture route's rules, applied to an even smaller write: every
 * refusal — over budget, unknown tenant, junk body, page that is not this
 * tenant's — is a silent 204, because a background beacon must never error at
 * a customer and a distinguishing refusal would make this a probe for which
 * pages exist (the draft route's stated reason, inherited).
 *
 * The channel is DERIVED HERE, server-side, from the forwarded evidence — the
 * client never sends a channel name, so the stored vocabulary cannot be
 * widened from a browser. What CAN arrive from a hostile client is volume and
 * junk evidence; volume is bounded per IP below, and junk derives to "other"
 * with its bounded raw string kept, which is exactly what it is.
 *
 * DELIBERATELY NOT COUNTED: the thank-you page (a confirmation is the end of
 * an order, not traffic), the editor's previews (this route is mounted only
 * by the public storefront), and anything a crawler does without executing
 * the beacon. Merchant self-views DO count — an honest limitation recorded in
 * NEXT_STEPS §AN.1 rather than half-fixed with a heuristic.
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

  const parsed = VisitBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const { token, pageKind, landingPageId, source, isReturning } = parsed.data;
  const derived = deriveSource(source ?? {});

  try {
    await withTenant(tenant.id, async (db) => {
      // A landing view must name a page THIS tenant publishes — the binding
      // scopes the lookup, so another tenant's id simply finds nothing and
      // the whole beacon is dropped rather than recorded page-less (a row
      // that lies about what was seen is worse than no row).
      let pageId: string | null = null;
      if (pageKind === "landing") {
        if (!landingPageId) return;
        const page = await (db as any).landingPage.findFirst({
          where: { id: landingPageId, published: true },
          select: { id: true },
        });
        if (!page) return;
        pageId = page.id;
      }

      await (db as any).storefrontVisit.create({
        data: {
          tenantId: tenant.id,
          landingPageId: pageId,
          pageKind,
          visitorToken: token,
          isReturning,
          sourceChannel: derived.channel,
          sourceDetail: derived.detail,
        },
      });

      // AN.2 — retention rides the traffic that creates the need for it: an
      // active store prunes its own expired rows roughly every fifty views
      // (the rate-limiter's amortised pattern). Tenant-bound, so RLS decides
      // what "expired rows" can possibly mean.
      if (shouldAmortisedPrune()) {
        await pruneExpiredVisits(db);
      }
    });
  } catch (error) {
    console.error("[storefront] visit beacon failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
