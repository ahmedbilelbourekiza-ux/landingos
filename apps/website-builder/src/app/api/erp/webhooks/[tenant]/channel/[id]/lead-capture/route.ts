import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";

import { nextReference } from "@/lib/erp/ids";
import { normalizePhone } from "@/lib/erp/phone";
import { autoAssignOnCreate } from "@/lib/erp/assign";
import { logIntegration } from "@/lib/erp/integration-log";
import { notifyNewOrder } from "@/lib/erp/notify";

export const dynamic = "force-dynamic";

type Params = { tenant: string; id: string };

/* =============================================================================
 * A phone number typed into a checkout form and not submitted — LP.20, R19.
 *
 * The legacy built this after confirming, against its own six real-webhook
 * tests, that **no LightFunnels event exposes a phone number before the order is
 * either completed or genuinely abandoned-and-forgotten**. A visitor who types
 * their number and then closes the tab is a callable lead worth real money, and
 * every event-based route misses them.
 *
 * So it bypasses the platform's event system: a small script on the checkout
 * page posts here the moment something phone-shaped is typed.
 *
 * -----------------------------------------------------------------------------
 * D-LP.20.1 — THIS ENDPOINT HAS NO SIGNATURE, DELIBERATELY, AND IS THEREFORE
 * NARROW BY CONSTRUCTION.
 *
 * The caller is JavaScript on a public page. A webhook secret would have to be
 * embedded in that page, which is not a secret. The legacy says the same thing.
 *
 * What that costs is stated rather than glossed: **anybody who knows the URL can
 * create abandoned leads in this tenant's book.** Four things bound the damage,
 * and they are the design rather than an afterthought:
 *
 *   - it can only ever create an `abandoned` row. Not a confirmed order, not a
 *     price, not a product from the catalogue — `price` is forced to zero and
 *     `status` to `abandoned`, so nothing it makes can be mistaken for a sale or
 *     reach the revenue figures.
 *   - it accepts FOUR text fields and nothing else. There is no allow-list to
 *     get wrong because there is no spread: each field is read by name.
 *   - a channel with `webhookEnabled: false` is refused, so a tenant who is
 *     being abused turns it off from the screen LP.15 built.
 *   - every call is written to the integration log, so abuse is visible rather
 *     than inferred from a queue full of junk.
 *
 * D-LP.20.2 — THE 24-HOUR MERGE WINDOW
 *
 * A checkout page fires this on every keystroke-debounce: name, then phone, then
 * wilaya. Without a merge that is four leads for one person. The legacy merges
 * into an existing abandoned row for the same phone and channel **within 24
 * hours**, filling only the fields that are still blank — the same
 * never-overwrite rule the import follows (D-LP.19.3) — and 24 hours because a
 * customer who comes back the next day is a second attempt worth knowing about.
 *
 * D-LP.20.3 — CROSS-ORIGIN BY DESIGN, AND ONLY THIS ROUTE
 *
 * The script runs on the storefront's own domain, so the browser sends a
 * preflight. `OPTIONS` answers it and the response carries `*`, because the
 * caller is a public page on a domain this system does not know. That is
 * acceptable HERE and nowhere else on the platform: the endpoint is
 * unauthenticated by design, so there is no ambient credential for a cross-origin
 * request to abuse — which is exactly the property that makes CORS matter
 * elsewhere.
 * ========================================================================== */

/** How long a lead may be topped up rather than duplicated. */
const MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  // No credentials, ever. `*` and credentials are incompatible by
  // specification, and stating it is cheaper than relying on that.
  "access-control-max-age": "86400",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const ok = (body: Record<string, unknown>) =>
  NextResponse.json(body, { headers: CORS });

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { tenant: slug, id: channelId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: CORS });
  }

  const text = (key: string, max: number) => String(body[key] ?? "").trim().slice(0, max);

  const phone = normalizePhone(text("phone", 40));
  // Nothing usable yet. Answered 200 rather than refused: the script fires on
  // every debounce and a 4xx in a browser console teaches somebody to remove
  // the snippet.
  if (!phone || phone.length < 8) return ok({ received: true, lead: false });

  const tenant = await asPlatform().tenant.findUnique({
    where: { slug: slug.toLowerCase() },
    select: { id: true, status: true, deletedAt: true },
  });
  // The same answer for an unknown tenant and a disabled channel: this endpoint
  // must not be usable to enumerate customers of the platform.
  if (!tenant || tenant.deletedAt || tenant.status !== "ACTIVE") return ok({ received: true });

  return withTenant(tenant.id, async (db) => {
    const channel = await db.salesChannel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true, platform: true, active: true, webhookEnabled: true },
    });
    if (!channel || !channel.active || !channel.webhookEnabled) return ok({ received: true });

    const client = text("name", 160);
    const product = text("product", 300);
    const wilaya = text("wilaya", 120);
    const commune = text("commune", 120);
    const pageUrl = text("pageUrl", 300);

    await logIntegration(db, tenant.id, {
      entity: "salesChannel",
      entityId: channel.id,
      event: "lead_capture",
      result: "success",
      message: pageUrl || null,
      // The fields, not the values: a lead capture carries a stranger's phone
      // number and this table is readable by anybody who can configure a
      // channel.
      request: { fields: Object.keys(body).sort() },
    });

    const since = new Date(Date.now() - MERGE_WINDOW_MS);
    const existing = await db.fulfillmentOrder.findFirst({
      where: {
        salesChannelId: channel.id,
        phoneNormalized: phone,
        orderType: "abandoned",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, client: true, product: true, wilaya: true, commune: true },
    });

    if (existing) {
      // Fill the blanks only — the same never-overwrite rule the import
      // follows. A later keystroke must not blank a field an earlier one set.
      const patch: Record<string, string> = {};
      if (client && !existing.client) patch.client = client;
      if (product && !existing.product) patch.product = product;
      if (wilaya && !existing.wilaya) patch.wilaya = wilaya;
      if (commune && !existing.commune) patch.commune = commune;

      if (Object.keys(patch).length) {
        await db.fulfillmentOrder.update({ where: { id: existing.id }, data: patch });
      }
      return ok({ received: true, lead: true, merged: true });
    }

    let agentUserId: string | null = null;
    try {
      agentUserId = await autoAssignOnCreate(db, tenant.id);
    } catch (error) {
      // Never a non-2xx: a page script that gets one stops running.
      console.error("[lead-capture] auto-assign failed", error);
    }

    const created = await db.fulfillmentOrder.create({
      data: {
        tenantId: tenant.id,
        reference: await nextReference(db, tenant.id, "order"),
        salesChannelId: channel.id,
        salesChannelName: channel.name,
        platform: channel.platform,
        source: "lead_capture",
        client,
        phone: text("phone", 40),
        phoneNormalized: phone,
        wilaya,
        commune,
        product,
        quantity: 1,
        // Forced. Nothing this endpoint creates may look like money.
        price: 0,
        orderType: "abandoned",
        status: "abandoned",
        note: pageUrl ? `Lead captured before checkout — ${pageUrl}` : "Lead captured before checkout",
        agentUserId,
      },
      select: { id: true, reference: true, client: true, phone: true, agentUserId: true },
    });

    // The ka-ching family for this is `abandoned` (LP.11), because a lead that
    // walked away is a different urgency from a sale that landed.
    await notifyNewOrder(db, tenant.id, created, "abandoned_cart");

    return ok({ received: true, lead: true, created: true });
  });
}
