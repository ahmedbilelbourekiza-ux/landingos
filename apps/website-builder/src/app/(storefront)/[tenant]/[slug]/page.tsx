import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant, storefrontHref } from "@/lib/storefront/resolve-tenant";
import { resolveStoreName } from "@/lib/storefront/store-identity";
import { toLandingPageData, toThemeData } from "@/lib/landing/mappers";
import { LandingTemplate } from "@/components/landing/landing-template";
import { StorefrontApiProvider } from "@/lib/storefront/api-base";
import { ViewContentTracker } from "@/components/landing/tracking-scripts";

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

  const [page, store] = await withTenant(tenant.id, async (db) => [
    await (db as any).landingPage.findFirst({
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
    // The tenant's public identity (B4) — nav brand, footer, socials, the
    // floating WhatsApp number — read here because the template deliberately
    // reads no settings itself.
    await (db as any).storeSettings.findUnique({
      where: { tenantId: tenant.id },
      select: {
        storeName: true, storeDescription: true, logo: true,
        facebook: true, instagram: true, tiktok: true, whatsapp: true, telegram: true,
      },
    }),
  ]);

  // ALWAYS a store identity, even with no settings row. The old `store ? … :
  // null` handed the template a null, and the template's fallback was the
  // PLATFORM's wordmark and copyright — on a real shop's page, linking to the
  // platform console. Both production tenants had a null row when this was
  // measured. `resolveStoreName` also absorbs the other half of the leak: the
  // `storeName` column is NOT NULL defaulting to the platform's own name, so
  // the previous `?? tenant.name` could never fire.
  const storeData = {
    name: resolveStoreName(store?.storeName, tenant.name),
    description: store?.storeDescription ?? null,
    logo: store?.logo ?? null,
    facebook: store?.facebook ?? null,
    instagram: store?.instagram ?? null,
    tiktok: store?.tiktok ?? null,
    whatsapp: store?.whatsapp ?? null,
    telegram: store?.telegram ?? null,
    homePath: `/${tenantSlug}`,
  };

  return page ? { tenant, page, store: storeData } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}): Promise<Metadata> {
  const { tenant, slug } = await params;
  const found = await load(tenant, slug);
  if (!found) return { title: "Not found" };

  const title = found.page.seoTitle || found.page.title;
  const description = found.page.seoDescription || found.page.description || undefined;
  // The hero image — the first GALLERY media — is what a shared link shows.
  // For a product sold through ads, the link preview IS the ad creative half
  // the time (LB.6).
  const hero = found.page.media.find((m: any) => m.placement === "GALLERY");
  const path = `/${found.tenant.slug}/${found.page.slug}`;

  return {
    title,
    description,
    // A storefront IS meant to be indexed, unlike the console, which sets
    // noindex in the root layout.
    robots: { index: true, follow: true },
    // Path-only canonical: correct relative to whichever host served it, so a
    // custom domain canonicalises to itself rather than to the platform.
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ar_DZ",
      ...(hero ? { images: [{ url: hero.url, alt: hero.altText ?? title }] } : {}),
    },
    twitter: {
      card: hero ? "summary_large_image" : "summary",
      title,
      description,
      ...(hero ? { images: [hero.url] } : {}),
    },
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

  // Product structured data, so search results can carry the price. Values
  // come from the same row the page renders — never a second computation.
  const hero = found.page.media.find((m: any) => m.placement === "GALLERY");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: found.page.title,
    ...(found.page.description ? { description: found.page.description } : {}),
    ...(hero ? { image: [hero.url] } : {}),
    offers: {
      "@type": "Offer",
      price: String(found.page.price),
      priceCurrency: found.page.currency,
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <div data-tenant={found.tenant.slug} data-page-slug={found.page.slug}>
      <script
        type="application/ld+json"
        // Serialized server-side from our own row; the replace hardens against
        // a description containing a literal </script>.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {/* Every request the template makes — the wilaya list, draft capture,
          checkout — goes to THIS tenant's storefront API. Without the provider
          the purchase form would post to whatever base it defaulted to, which
          is how a checkout ends up filed under the wrong company. */}
      <StorefrontApiProvider
        base={`/api/storefront/${found.tenant.slug}`}
        pageBase={found.tenant.viaCustomDomain ? "" : storefrontHref(found.tenant)}
      >
        {/* ViewContent from the PUBLIC route only — the editor preview reuses
            the same template, and previewing your own page must not look like
            a customer visit in an ad platform's reporting. */}
        <ViewContentTracker
          contentId={found.page.id}
          contentName={found.page.title}
          value={Number(found.page.price)}
          currency={found.page.currency}
        />
        {/* toLandingPageData, not toPreviewState: the latter is the EDITOR's
            shape and the template takes the public one. Passing the wrong
            mapper compiles fine and throws at render. */}
        <LandingTemplate
          page={toLandingPageData(found.page)}
          theme={toThemeData(found.page.theme)}
          store={found.store}
        />
      </StorefrontApiProvider>
    </div>
  );
}
