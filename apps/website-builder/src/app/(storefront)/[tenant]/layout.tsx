import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant } from "@/lib/storefront/resolve-tenant";
import { TrackingScripts, type BrowserIntegration } from "@/components/landing/tracking-scripts";

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
