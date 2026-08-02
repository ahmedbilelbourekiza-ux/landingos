import { NextResponse } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";

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
  _req: Request,
  ctx: { params: Promise<{ tenant: string }> },
) {
  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "That store does not exist." } },
      { status: 404 },
    );
  }

  const items = await withTenant(tenant.id, async (db) => {
    const prices = await (db as any).tenantDeliveryPrice.findMany();
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

  return NextResponse.json({ success: true, data: { items } });
}
