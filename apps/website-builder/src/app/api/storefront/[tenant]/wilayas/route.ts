import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { deliveryPricesFor } from "@/lib/storefront/delivery";
import { NEVER_CACHE, withCachePolicy } from "@/lib/storefront/cache-policy";

export const dynamic = "force-dynamic";

/**
 * Destinations this tenant will actually deliver to.
 *
 * Only wilayas that HAVE a price. Listing all 58 and then rejecting half of
 * them at checkout wastes the customer's time; a shorter list that always
 * works is the better product. Communes come with each one, so the address
 * form needs no second request.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string }> },
) {
  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) {
    return withCachePolicy(
      NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "That store does not exist." } },
        { status: 404 },
      ),
      NEVER_CACHE,
    );
  }

  /* LB.20 — which product is being quoted for. Optional, so a caller that does
     not send it gets the company's rates exactly as before; the storefront's
     purchase form sends it, which is what makes a per-product price visible in
     the destination dropdown BEFORE checkout rather than as a surprise at the
     end. */
  const landingPageId = req.nextUrl.searchParams.get("landingPageId")?.trim() || null;

  const items = await withTenant(tenant.id, async (db) => {
    // The same resolver the checkout charges from.
    const priceMap = await deliveryPricesFor(db as never, landingPageId);
    const prices = [...priceMap.values()];
    if (prices.length === 0) return [];

    const wilayas = await (db as any).wilaya.findMany({
      where: { id: { in: prices.map((p: any) => p.wilayaId) } },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        nameAr: true,
        baladias: { orderBy: { name: "asc" }, select: { id: true, name: true, nameAr: true } },
      },
    });

    const byId = new Map(prices.map((p: any) => [p.wilayaId, p]));
    return wilayas.map((w: any) => {
      const p: any = byId.get(w.id);
      return {
        ...w,
        // Decimal as a string, so a price never passes through a JS float on
        // its way to the browser (M-06).
        homePrice: String(p.homePrice),
        deskPrice: p.deskPrice == null ? null : String(p.deskPrice),
      };
    });
  });

  /* NEVER_CACHE, and this is the response the whole policy was written for:
   * `homePrice`/`deskPrice` here are the numbers the destination dropdown
   * shows, produced by the SAME `deliveryPricesFor` the checkout charges from
   * (D-LB.20.1). A cache holding this answer makes the quote and the charge
   * disagree from outside the code, which is the one divergence that rule
   * exists to prevent. Until now this route sent no `Cache-Control` at all,
   * which lets a shared cache pick its own freshness (RFC 9111 §4.2.2). */
  return withCachePolicy(NextResponse.json({ success: true, data: { items } }), NEVER_CACHE);
}
