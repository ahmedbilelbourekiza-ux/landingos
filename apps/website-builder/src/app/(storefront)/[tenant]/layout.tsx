import type { Metadata } from "next";

import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant } from "@/lib/storefront/resolve-tenant";
import { TrackingScripts, type BrowserIntegration } from "@/components/landing/tracking-scripts";

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
 * The storefront layout (LB.5).
 *
 * This layout exists for ONE reason: analytics must load on every storefront
 * page — home, category, product, thank-you — without any page remembering
 * to mount it. The old Meta loader was mounted by nothing precisely because
 * there was no layout to own it (BUILDER_AUDIT §2).
 *
 * The integration list is read HERE, server-side, and passed as props: the
 * loader has no client fetch to drift from an API shape, and the pixels render
 * in the same pass as the content. `resolveStorefrontTenant` is cache()d, so
 * the page's own resolution is the same query.
 * ========================================================================== */

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await resolveStorefrontTenant(slug);

  // Unknown store: the page itself 404s; the layout adds nothing.
  if (!tenant) return <>{children}</>;

  const integrations: BrowserIntegration[] = await withTenant(tenant.id, (db) =>
    (db as any).trackingIntegration.findMany({
      where: { isActive: true },
      // Public ids and non-secret settings ONLY — this select is what keeps
      // server credentials out of the HTML.
      select: { provider: true, publicId: true, settings: true },
      orderBy: { createdAt: "asc" },
    }),
  );

  return (
    <>
      {integrations.length > 0 && <TrackingScripts integrations={integrations} />}
      {children}
    </>
  );
}
