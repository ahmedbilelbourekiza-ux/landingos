import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant } from "@/lib/storefront/resolve-tenant";
import { toLandingPageData, toThemeData } from "@/lib/landing/mappers";
import { LandingTemplate } from "@/components/landing/landing-template";
import { StorefrontApiProvider } from "@/lib/storefront/api-base";

export const dynamic = "force-dynamic";

/* =============================================================================
 * A published landing page (M-17).
 *
 * The renderer is the SAME LandingTemplate the legacy /l/[slug] route used and
 * the editor previews — moved, not rewritten. What changed is that the tenant
 * comes from the URL and the query is bound to it.
 *
 * `published: true` is not redundant beside the binding. The binding decides
 * WHOSE rows these are; publication decides which of them a stranger may see.
 * Dropping it would serve every tenant's drafts to the public.
 * ========================================================================== */

async function load(tenantSlug: string, pageSlug: string) {
  const tenant = await resolveStorefrontTenant(tenantSlug);
  if (!tenant) return null;

  const page = await withTenant(tenant.id, (db) =>
    (db as any).landingPage.findFirst({
      where: { slug: pageSlug, published: true, status: "PUBLISHED" },
      include: {
        media: { orderBy: { displayOrder: "asc" } },
        variants: { orderBy: { displayOrder: "asc" } },
        features: { orderBy: { displayOrder: "asc" } },
        reviews: { orderBy: { displayOrder: "asc" } },
        faqs: { orderBy: { displayOrder: "asc" } },
        setting: true,
        theme: true,
      },
    }),
  );

  return page ? { tenant, page } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}): Promise<Metadata> {
  const { tenant, slug } = await params;
  const found = await load(tenant, slug);
  if (!found) return { title: "Not found" };

  return {
    title: found.page.seoTitle || found.page.title,
    description: found.page.seoDescription || found.page.description || undefined,
    // A storefront IS meant to be indexed, unlike the console, which sets
    // noindex in the root layout.
    robots: { index: true, follow: true },
  };
}

export default async function StorefrontLandingPage({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}) {
  const { tenant: tenantSlug, slug } = await params;
  const found = await load(tenantSlug, slug);
  // An unpublished page and a page belonging to another tenant get the same
  // answer: it does not exist here.
  if (!found) notFound();

  return (
    <div data-tenant={found.tenant.slug} data-page-slug={found.page.slug}>
      {/* Every request the template makes — the wilaya list, draft capture,
          checkout — goes to THIS tenant's storefront API. Without the provider
          the purchase form would post to whatever base it defaulted to, which
          is how a checkout ends up filed under the wrong company. */}
      <StorefrontApiProvider base={`/api/storefront/${found.tenant.slug}`}>
        {/* toLandingPageData, not toPreviewState: the latter is the EDITOR's
            shape and the template takes the public one. Passing the wrong
            mapper compiles fine and throws at render. */}
        <LandingTemplate page={toLandingPageData(found.page)} theme={toThemeData(found.page.theme)} />
      </StorefrontApiProvider>
    </div>
  );
}
