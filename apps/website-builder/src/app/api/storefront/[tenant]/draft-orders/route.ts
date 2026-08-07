import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
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
  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return new NextResponse(null, { status: 204 });

  const parsed = DraftBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const { token, landingPageId, ...fields } = parsed.data;

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

      const draft = await (db as any).draftOrder.upsert({
        where: { token },
        update: fields,
        create: { ...fields, token, landingPageId: page.id, tenantId: tenant.id },
        select: { id: true, notifiedAt: true },
      });

      // `draft_order.created` exactly once per visitor — notifiedAt is the
      // guard. Later captures are `draft_order.updated`: an opt-in event for
      // receivers that want to watch a lead warm up. The client debounces and
      // skips identical snapshots, which bounds the volume.
      if (!draft.notifiedAt) {
        await (db as any).draftOrder.update({
          where: { id: draft.id },
          data: { notifiedAt: new Date() },
        });
        return { event: "draft_order.created" as const, id: draft.id };
      }
      return { event: "draft_order.updated" as const, id: draft.id };
    });

    if (fire) {
      triggerDraftOrderWebhook(fire.event, tenant.id, fire.id);
      // A captured phone number is a LEAD — the standard event ad platforms
      // optimise lead campaigns on. Once per visitor, like the webhook: later
      // keystrokes update the lead, they are not new ones (LB.5).
      if (fire.event === "draft_order.created" && fields.phone) {
        dispatchTrackingEvent(tenant.id, {
          name: "Lead",
          eventId: fire.id,
          contentId: landingPageId,
          customer: { name: fields.customerName ?? null, phone: fields.phone },
          context: {
            ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: req.headers.get("user-agent"),
          },
        });
      }
    }
  } catch (error) {
    console.error("[storefront] draft capture failed", error);
  }

  return new NextResponse(null, { status: 204 });
}
