import { NextResponse } from "next/server";

import { withTenant } from "@landingos/db";

import { tenantBySlug } from "@/lib/storefront/resolve-tenant";

export const dynamic = "force-dynamic";

/**
 * Browser pixel ids for this storefront.
 *
 * Ids ONLY. The access tokens stored alongside them are for server-side
 * Conversions API calls and must never reach a browser — a leaked token lets
 * anyone send events as this tenant. The select below is the enforcement, not
 * a convention.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenant: string }> },
) {
  const { tenant: slug } = await ctx.params;
  const tenant = await tenantBySlug(slug);
  // An empty list rather than a 404: a missing pixel must never stop a
  // storefront rendering.
  if (!tenant) return NextResponse.json({ success: true, data: { pixelIds: [] } });

  const [configs, settings] = await withTenant(tenant.id, async (db) => [
    await (db as any).metaPixelConfig.findMany({
      where: { isActive: true },
      select: { pixelId: true },
    }),
    await (db as any).storeSettings.findUnique({
      where: { tenantId: tenant.id },
      select: { metaBrowserPixelId: true },
    }),
  ]);

  // The browser pixel is deliberately independent of the CAPI configs: the
  // storefront keeps firing PageView even if every server-side config is off.
  const ids = new Set<string>(configs.map((c: any) => c.pixelId));
  if (settings?.metaBrowserPixelId) ids.add(settings.metaBrowserPixelId);

  return NextResponse.json({ success: true, data: { pixelIds: [...ids] } });
}
