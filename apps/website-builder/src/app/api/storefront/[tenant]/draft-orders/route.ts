import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { allowRequest, clientIp, draftLimit } from "@/lib/storefront/rate-limit";
import { DraftBody } from "@/lib/storefront/contract";
import { triggerDraftOrderWebhook } from "@/lib/webhooks/tenant-triggers";
import { dispatchTrackingEvent } from "@/lib/tracking/dispatch";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Abandoned-checkout capture.
 *
 * Called repeatedly as a visitor types, so the token is the upsert key and one
 * visit produces one row rather than hundreds. Deliberately tolerant: this is
 * best-effort telemetry on a half-filled form, and a strict validator would
 * reject exactly the partial input it exists to capture.
 *
 * It records NO prices. A draft is a lead, not a quote — anything monetary is
 * computed at checkout from the tenant's own rows.
 *
 * Every failure is a silent 204. A customer must never see an error from a
 * background capture they did not ask for, and telling a caller why their
 * write was rejected would make this a probe for which pages exist.
 * ========================================================================== */

// The body schema lives in `lib/storefront/contract.ts`, shared with the
// capture hook — the drift this prevents is exactly how this route spent the
// platform port answering 204 to every real capture (B-04).

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  // Over budget answers the same silent 204 as every other refusal here — a
  // background capture must never error at a customer, and a 429 would tell a
  // scraper exactly where the limit sits (LB.6, G-01). Sixty per five minutes
  // absorbs the debounced typing pattern with a wide margin.
  if (!allowRequest("draft", clientIp(req), draftLimit(), 5 * 60 * 1000)) {
    return new NextResponse(null, { status: 204 });
  }

  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return new NextResponse(null, { status: 204 });

  const parsed = DraftBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  // The attribution identifiers are destructured OUT of the stored fields:
  // DraftOrder has no columns for them, and they matter only at the moment a
  // Lead event fires below.
  const { token, landingPageId, fbc, fbp, ttclid, ttp, gaClientId, ...fields } = parsed.data;

  try {
    // The event is decided INSIDE the transaction and fired AFTER it returns:
    // the trigger re-reads through its own binding — a separate connection —
    // so fired from in here it would race the commit and find no row, and the
    // webhook would silently never send (W-01's quieter sibling).
    const fire = await withTenant(tenant.id, async (db) => {
      const page = await (db as any).landingPage.findFirst({
        where: { id: landingPageId, published: true },
        select: { id: true },
      });
      if (!page) return null;

      // What did we know BEFORE this capture? The Lead decision below needs
      // the transition, not the state: a capture is a Lead exactly when it
      // brings the first phone number for this visitor.
      const previous = await (db as any).draftOrder.findUnique({
        where: { token },
        select: { phone: true },
      });

      const draft = await (db as any).draftOrder.upsert({
        where: { token },
        update: fields,
        create: { ...fields, token, landingPageId: page.id, tenantId: tenant.id },
        select: { id: true, notifiedAt: true },
      });

      // A Lead is the capture that FIRST carries a phone — which is usually
      // NOT the first capture: the debounce fires after the name field, two
      // seconds before the customer types their number. Firing Lead only on
      // draft_order.created lost every such lead (readiness audit).
      const leadArrived = Boolean(fields.phone) && !previous?.phone;

      // `draft_order.created` exactly once per visitor — notifiedAt is the
      // guard. Later captures are `draft_order.updated`: an opt-in event for
      // receivers that want to watch a lead warm up. The client debounces and
      // skips identical snapshots, which bounds the volume.
      if (!draft.notifiedAt) {
        await (db as any).draftOrder.update({
          where: { id: draft.id },
          data: { notifiedAt: new Date() },
        });
        return { event: "draft_order.created" as const, id: draft.id, leadArrived };
      }
      return { event: "draft_order.updated" as const, id: draft.id, leadArrived };
    });

    if (fire) {
      triggerDraftOrderWebhook(fire.event, tenant.id, fire.id);
      // A captured phone number is a LEAD — the standard event ad platforms
      // optimise lead campaigns on. Once per visitor: the draft id is the
      // dedup key, and the phone-transition guard above means later
      // keystrokes update the lead rather than creating new ones (LB.5).
      if (fire.leadArrived && fields.phone) {
        dispatchTrackingEvent(tenant.id, {
          name: "Lead",
          eventId: fire.id,
          contentId: landingPageId,
          customer: { name: fields.customerName ?? null, phone: fields.phone },
          context: {
            ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: req.headers.get("user-agent"),
            fbc: fbc ?? null,
            fbp: fbp ?? null,
            ttclid: ttclid ?? null,
            ttp: ttp ?? null,
            gaClientId: gaClientId ?? null,
          },
        });
      }
    }
  } catch (error) {
    console.error("[storefront] draft capture failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
