import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug, storefrontPageUrl } from "@/lib/storefront/resolve-tenant";
import { allowRequest, clientIp, endUserIp, funnelLimit } from "@/lib/storefront/rate-limit";
import { FunnelEventBody } from "@/lib/storefront/contract";
import { dispatchTrackingEvent } from "@/lib/tracking/dispatch";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The funnel relay (CAPI.1) — the server half of ViewContent, AddToCart and
 * InitiateCheckout.
 *
 * Before this route those three existed only as browser pixel calls, so an ad
 * blocker or a dropped connection erased them, and Meta's Event Match Quality
 * saw no server event to pair them with. The browser now mints one event id,
 * fires fbq with it, and posts the same id here; Meta and TikTok keep one copy.
 *
 * Same tolerance rules as the visit beacon and draft capture: every refusal is
 * a silent 204 — a tracking side-channel must never error at a customer, and a
 * distinguishing answer would make this a probe for which pages exist.
 *
 * What the server decides, not the browser:
 *   - value/currency/title come from the landing page row (no fake baskets);
 *   - the page must be this tenant's and published;
 *   - event_source_url is rebuilt from the vetted origin + slug (LB.43);
 *   - the client IP is the END USER's or nothing (SEC.10);
 *   - recipients are the page's own pixel selection, Meta + TikTok only (GA4
 *     has no dedup key for these events and would double count).
 * ========================================================================== */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  if (!allowRequest("funnel", clientIp(req), funnelLimit(), 5 * 60 * 1000)) {
    return new NextResponse(null, { status: 204 });
  }

  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return new NextResponse(null, { status: 204 });

  const parsed = FunnelEventBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new NextResponse(null, { status: 204 });
  const input = parsed.data;

  try {
    const page: any = await withTenant(tenant.id, (db) =>
      (db as any).landingPage.findFirst({
        where: { id: input.landingPageId, published: true, status: "PUBLISHED" },
        select: {
          id: true, slug: true, title: true, price: true, currency: true,
          trackingIntegrationIds: true,
        },
      }),
    );
    if (!page) return new NextResponse(null, { status: 204 });

    // ViewContent is one unit by definition; the other two carry the basket
    // size the shopper had chosen when they fired.
    const quantity = input.name === "ViewContent" ? 1 : (input.quantity ?? 1);
    const unit = Number(page.price);
    const pageUrl = await storefrontPageUrl(tenant, page.slug as string);

    // After the read returned (its own binding), never awaited — the
    // dispatchTrackingEvent rule.
    dispatchTrackingEvent(
      tenant.id,
      {
        name: input.name,
        eventId: input.eventId,
        value: Number.isFinite(unit) ? unit * quantity : undefined,
        currency: page.currency as string,
        contentId: page.id as string,
        contentName: page.title as string,
        quantity,
        context: {
          ip: endUserIp(req),
          userAgent: req.headers.get("user-agent"),
          fbc: input.fbc ?? null,
          fbp: input.fbp ?? null,
          ttclid: input.ttclid ?? null,
          ttp: input.ttp ?? null,
          url: pageUrl,
        },
      },
      { providers: ["meta", "tiktok"], pageSelection: page.trackingIntegrationIds },
    );
  } catch (error) {
    console.error("[storefront] funnel relay failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
