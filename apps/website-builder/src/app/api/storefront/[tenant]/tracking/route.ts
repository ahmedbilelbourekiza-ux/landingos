import { NextResponse } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";
import { NEVER_CACHE, withCachePolicy } from "@/lib/storefront/cache-policy";

export const dynamic = "force-dynamic";

/**
 * The browser-side tracking configuration for one storefront (LB.5).
 *
 * PUBLIC IDS ONLY, plus non-secret settings (a Google Ads conversion label is
 * printed into every advertiser's page source; it is not a secret). The
 * select below is the enforcement: `serverToken` and `testCode` never appear
 * in it, so they cannot reach a browser however this route evolves.
 *
 * An empty list rather than a 404 for an unknown store — a missing pixel must
 * never stop a storefront rendering.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenant: string }> },
) {
  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  if (!tenant) return withCachePolicy(NextResponse.json({ success: true, data: { items: [] } }), NEVER_CACHE);

  const items = await withTenant(tenant.id, (db) =>
    (db as any).trackingIntegration.findMany({
      where: { isActive: true },
      select: { provider: true, publicId: true, settings: true },
      orderBy: { createdAt: "asc" },
    }),
  );

  /* NEVER_CACHE — a pixel the merchant removed must stop firing, a pixel
     they added must start, and a shared copy of this answer would name the
     tenant's advertising setup to whoever can read that cache. */
  return withCachePolicy(NextResponse.json({ success: true, data: { items } }), NEVER_CACHE);
}
