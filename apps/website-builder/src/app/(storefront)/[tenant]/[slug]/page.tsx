import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant, storefrontHref } from "@/lib/storefront/resolve-tenant";
import { resolveStoreName } from "@/lib/storefront/store-identity";
import { storefrontStoreSettings } from "@/lib/storefront/store-settings";
import {
  activeBrowserIntegrationRows,
  browserIntegrationsFrom,
} from "@/lib/storefront/tracking";
import { toLandingPageData, toThemeData } from "@/lib/landing/mappers";
import { LandingTemplate } from "@/components/landing/landing-template";
import { StorefrontApiProvider } from "@/lib/storefront/api-base";
import { ViewContentTracker } from "@/components/landing/tracking-scripts";
import { StorefrontTracking } from "@/components/landing/storefront-tracking";
import { VisitBeacon } from "@/components/landing/visit-beacon";

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
 *
 * `cache()` around load (LB.51): generateMetadata and the page component both
 * need this data and previously each ran the whole query set — the statement
 * census measured every relation SELECT arriving at the database TWICE per
 * request. Per-request dedup only, like resolveStorefrontTenant; the next
 * request reads fresh, so LB.14a's cross-request rule is untouched. The
 * tracking rows ride in the same transaction for the same reason: they were a
 * separate transaction AFTER the page resolved — round trips appended to the
 * critical path for two reads the page's own transaction could carry.
 * ========================================================================== */

const load = cache(async (tenantSlug: string, pageSlug: string) => {
  const tenant = await resolveStorefrontTenant(tenantSlug);
  if (!tenant) return null;

  const [[page, integrationRows], store] = await Promise.all([
    withTenant(tenant.id, async (db) => [
      await (db as any).landingPage.findFirst({
        // One SQL statement for the page and its seven relations instead of
        // eight — on the pinned transaction, round trips ARE the latency
        // (D-PM.1.3). Opt-in per query via the relationJoins preview flag.
        relationLoadStrategy: "join",
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
      // The pixels this page may fire (LB.35). Same transaction, one query —
      // the selection itself is applied below, outside the transaction, by
      // the same function resolveBrowserIntegrations uses.
      await activeBrowserIntegrationRows(db),
    ]),
    // The tenant's public identity (B4) — nav brand, footer, socials, the
    // floating WhatsApp number — read here because the template deliberately
    // reads no settings itself. Shared with the layout's generateMetadata
    // through the request-scoped cache: one SELECT serves both.
    storefrontStoreSettings(tenant.id),
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
    // storefrontHref, NOT the raw path param: on a custom domain the param is
    // LB.45's rewrite sentinel, and the brand link rendered `/__domain__` —
    // found in the served accessibility tree (LB.48).
    homePath: storefrontHref(tenant),
  };

  if (!page) return null;

  return {
    tenant,
    page,
    store: storeData,
    // Resolved here so the component mount needs no second transaction; the
    // selection function is the one resolveBrowserIntegrations itself uses.
    integrations: browserIntegrationsFrom(integrationRows, page.trackingIntegrationIds),
  };
});

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
  /* `storefrontHref`, not a hand-built `/${slug}/${page}`. The path this page
   * lives at depends on how the tenant was REACHED — LB.31's helper already
   * knows that, and every link the storefront emits goes through it. The
   * hand-built version claimed in a comment to be "correct relative to
   * whichever host served it"; being relative was true, being the right PATH
   * was not, since a custom domain drops the tenant prefix. A canonical is the
   * one link that must agree with the others. */
  const path = storefrontHref(found.tenant, `/${found.page.slug}`);

  return {
    title,
    description,
    // A storefront IS meant to be indexed, unlike the console, which sets
    // noindex in the root layout. The storefront layout now states this for
    // the whole subtree; kept here because this page's own answer should not
    // depend on a parent for something this consequential.
    robots: { index: true, follow: true },
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ar_DZ",
      // Re-stated because a page's `openGraph` REPLACES the layout's rather
      // than merging into it, so the layout's siteName would be dropped here.
      siteName: found.store.name,
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
      {/* LB.35 — the pixels linked to THIS product, which is the selection the
          layout could not express. A page with no selection inherits the
          tenant's active set, exactly as before. Pre-resolved inside load()'s
          own transaction (LB.51), so this mount costs no second one. */}
      <StorefrontTracking
        tenantId={found.tenant.id}
        landingPageId={found.page.id}
        integrations={found.integrations}
      />
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
        {/* AN.1 — the first-party view count, same public-route-only rule.
            Unconditional on purpose: a merchant with no pixel configured
            still gets to know how many people saw their page. BH.1 — the
            behavior collector arms only when THIS page opted in (per-page,
            default off; the server enforces it again). */}
        <VisitBeacon
          endpoint={`/api/storefront/${found.tenant.slug}/visits`}
          pageKind="landing"
          landingPageId={found.page.id}
          collectBehavior={found.page.setting?.behaviorTracking ?? false}
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
