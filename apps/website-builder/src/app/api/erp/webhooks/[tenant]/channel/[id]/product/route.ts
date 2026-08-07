import { NextResponse, type NextRequest } from "next/server";

import { asPlatform, withTenant } from "@landingos/db";

import { verifySignature } from "@/lib/erp/webhooks";
import { getChannelAdapter } from "@/lib/erp/channel-adapters";
import { logIntegration } from "@/lib/erp/integration-log";
import { nextReference } from "@/lib/erp/ids";
import { toDecimal } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { tenant: string; id: string };

/* =============================================================================
 * A product created on the storefront — LP.20, R19.
 *
 * Saves the manual catalogue entry a tenant would otherwise do twice: once on
 * Shopify and once here. More importantly it creates the LINK — a
 * `CatalogProductLink` row tying this catalogue product to the platform's own
 * product id — and that link is what LP.16a made `sales-summary` match on
 * FIRST and EXCLUSIVELY. Without it, revenue attribution falls back to matching
 * a product NAME, which is the defect that cost a product with a `™` in its
 * name all of its revenue.
 *
 * -----------------------------------------------------------------------------
 * IT NEVER UPDATES AN EXISTING PRODUCT.
 *
 * A product already linked to this external id is left exactly as it is, and the
 * response says `duplicate`. That is the legacy's rule and it is the right one:
 * the catalogue here carries `costPrice`, `packagingCost` and a stock ledger
 * that the storefront knows nothing about, and a `products/update` webhook
 * echoing a retail price back over a cost basis would silently corrupt every
 * margin, every FIFO lot and every saved P&L.
 *
 * IT CREATES NO STOCK. A new product arrives at zero and takes its opening stock
 * as a movement, like everything else (D-LP.18.1). A webhook that set a level
 * would be a level with no movement row behind it.
 *
 * THE SIGNATURE IS CHECKED, unlike the lead-capture route beside it. This one is
 * called by the PLATFORM, not by a page script, so a secret is a real secret and
 * failing closed costs nothing.
 * ========================================================================== */

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { tenant: slug, id: channelId } = await ctx.params;

  // The raw bytes, before parsing. The HMAC is over exactly these.
  const raw = await req.text();

  const tenant = await asPlatform().tenant.findUnique({
    where: { slug: slug.toLowerCase() },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt || tenant.status !== "ACTIVE") {
    return NextResponse.json({ received: true });
  }

  return withTenant(tenant.id, async (db) => {
    const channel = await db.salesChannel.findUnique({
      where: { id: channelId },
      select: {
        id: true, name: true, platform: true, webhookSecret: true,
        webhookEnabled: true, active: true,
      },
    });
    if (!channel || !channel.active || !channel.webhookEnabled) {
      return NextResponse.json({ received: true });
    }

    const verdict = verifySignature(channel.platform, channel.webhookSecret, raw, req.headers);
    if (verdict === "missing" || verdict === "invalid") {
      await logIntegration(db, tenant.id, {
        entity: "salesChannel",
        entityId: channel.id,
        event: "webhook_rejected",
        result: "failure",
        message: `Signature ${verdict}.`,
        request: { kind: "product", platform: channel.platform },
      });
      // 200, so the platform does not disable the endpoint. See
      // `webhook-route.ts` for why a rejected payload is acknowledged.
      return NextResponse.json({ received: true });
    }

    let body: Record<string, unknown>;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    const adapter = getChannelAdapter(channel.platform);
    // No adapter means no reliable way to read this platform's product shape.
    // Refusing to guess is the D-LP.2 rule: a catalogue row invented from a
    // misread payload is worse than no row, because somebody prices from it.
    if (!adapter?.parseProduct) {
      await logIntegration(db, tenant.id, {
        entity: "salesChannel",
        entityId: channel.id,
        event: "webhook_unparsed",
        result: "failure",
        message: "No product integration exists for this platform on this deployment.",
        request: { kind: "product", platform: channel.platform },
      });
      return NextResponse.json({ received: true, created: false });
    }

    const parsed = adapter.parseProduct(body);
    if (!parsed) {
      await logIntegration(db, tenant.id, {
        entity: "salesChannel",
        entityId: channel.id,
        event: "webhook_unparsed",
        result: "failure",
        message: "The payload carried no product this adapter recognises.",
        request: { kind: "product", platform: channel.platform },
      });
      return NextResponse.json({ received: true, created: false });
    }

    // Dedup by the LINK, per tenant and per channel — the same key
    // `product-match.ts` reads first when attributing revenue.
    const already = await db.catalogProductLink.findFirst({
      where: {
        salesChannelId: channel.id,
        platform: channel.platform ?? "",
        externalProductId: parsed.externalId,
      },
      select: { productId: true },
    });
    if (already) {
      return NextResponse.json({
        received: true,
        created: false,
        duplicate: true,
        productId: already.productId,
      });
    }

    const product = await db.catalogProduct.create({
      data: {
        tenantId: tenant.id,
        reference: await nextReference(db, tenant.id, "product"),
        name: parsed.name,
        sku: parsed.sku ?? "",
        price: toDecimal(parsed.price) ?? undefined,
        image: parsed.image ?? "",
        // Variants arrive as names only, with no stock: a level here would be a
        // level with no movement row behind it (D-LP.18.1). The variant editor
        // is where they take their opening stock.
        variants: parsed.variants.map((v) => ({
          name: v.name,
          sku: v.sku ?? "",
          stock: 0,
          threshold: 0,
        })) as never,
        stock: 0,
        threshold: 0,
      },
      select: { id: true, name: true },
    });

    await db.catalogProductLink.create({
      data: {
        tenantId: tenant.id,
        productId: product.id,
        salesChannelId: channel.id,
        platform: channel.platform ?? "",
        externalProductId: parsed.externalId,
      },
    });

    await logIntegration(db, tenant.id, {
      entity: "salesChannel",
      entityId: channel.id,
      event: "webhook_product_created",
      result: "success",
      message: product.name,
      request: { kind: "product", externalId: parsed.externalId },
    });

    return NextResponse.json({ received: true, created: true, productId: product.id });
  });
}
