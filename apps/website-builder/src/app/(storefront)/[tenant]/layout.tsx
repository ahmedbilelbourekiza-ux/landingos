import type { Metadata } from "next";

import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant } from "@/lib/storefront/resolve-tenant";

/* The tenant's favicon (B4) — `StoreSettings.favicon` was accepted and
 * stored since the port and served to nobody. Declared at the LAYOUT so
 * every storefront page — home, category, product, thank-you — carries the
 * tenant's icon without any page remembering to, the same argument as the
 * tracking scripts below. Absent, the browser falls back to the platform
 * default exactly as before. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
  const { tenant: slug } = await params;
  const tenant = await resolveStorefrontTenant(slug);
  if (!tenant) return {};
  const settings = (await withTenant(tenant.id, (db) =>
    (db as any).storeSettings.findUnique({
      where: { tenantId: tenant.id },
      select: { favicon: true },
    }),
  )) as { favicon: string | null } | null;
  return settings?.favicon ? { icons: { icon: settings.favicon } } : {};
}

/* =============================================================================
 * The storefront layout.
 *
 * IT NO LONGER MOUNTS THE TRACKING LOADER, and the reason is worth stating
 * because LB.5 deliberately put it here. LB.5's goal was that analytics load
 * on every storefront page without any page remembering to mount it — the
 * pre-LB.5 Meta loader was mounted by nothing (BUILDER_AUDIT §2). But a layout
 * in the App Router cannot see its child segment's params: it can name the
 * tenant and never the PAGE. While the mount lived here, "this pixel belongs
 * to this product" was unexpressible, and every storefront page fired every
 * pixel the tenant owned (LB.35).
 *
 * So the mount moved down to the four storefront routes, and LB.5's guarantee
 * moved with it — from placement into a TEST that asserts all four routes
 * still emit the loader. The invariant is now stated rather than implied, and
 * `resolveStorefrontTenant` is cache()d so the extra resolution costs nothing.
 *
 * What remains here is the tenant's favicon, which genuinely belongs to every
 * page and needs no per-page knowledge.
 * ========================================================================== */

export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
