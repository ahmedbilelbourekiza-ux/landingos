import type { MetadataRoute } from "next";

import { tenantByDomain, currentOrigin } from "@/lib/storefront/resolve-tenant";

export const dynamic = "force-dynamic";

/* =============================================================================
 * /robots.txt — LB.40, and it REPLACES a static file that said the opposite.
 *
 * WHAT WAS THERE. `public/robots.txt`, five blocks, every one of them
 * `Allow: /` — Googlebot, Bingbot, Twitterbot, facebookexternalhit and `*`.
 * So the platform invited every crawler into `/console` and `/api` while
 * LB.37's root layout was busy telling each page `noindex`. Not a live
 * incident: robots.txt governs CRAWLING and the meta governs INDEXING, so the
 * console was fetched and then correctly not indexed. But it spent crawl
 * budget on auth-gated redirects and, worse, on `/api` — where the checkout
 * route keeps a per-IP rate limit that a crawler has no business consuming.
 *
 * IT ALSO COULD NOT SAY THE ONE THING WORTH SAYING. A static file is the same
 * on every hostname, and this app answers on two KINDS of hostname whose
 * correct robots.txt differs — which is the whole reason this is now a route.
 *
 *   THE PLATFORM HOST is one app serving many shops, so it names NO sitemap.
 *   The only file it could name is one listing every tenant, which publishes
 *   the customer roster at a guessable URL — the same objection that kept the
 *   sitemap out of the root in LB.39. A crawler still finds each shop by
 *   following links into it; it just is not handed the directory.
 *
 *   A VERIFIED CUSTOM DOMAIN is one shop, and there the ambiguity does not
 *   exist: the host belongs to that merchant, so robots.txt names THEIR
 *   sitemap and nobody else's. This is the case LB.39 identified as the one
 *   where a root robots.txt is unambiguously worth having.
 *
 * The Sitemap URL is BARE (`/sitemap.xml`) since LB.45: a custom domain's
 * paths are the shop's own — the rewrites serve the bare shape and the pages
 * declare it canonical, so this file must name the same URL. (It used to be
 * `/{slug}/sitemap.xml`, matching the pre-LB.45 root redirect.)
 *
 * `Disallow` AND the meta `noindex` are kept together on purpose, because they
 * are not the same instruction and neither replaces the other. A disallowed
 * page can still be indexed URL-only if something links to it, which is why
 * LB.37's `noindex` stays; and a `noindex` page still costs a fetch, which is
 * why the disallow is here. The console keeps both.
 *
 * ONE THING THAT MADE THIS INERT UNTIL IT WAS FOUND: Next serves `public/`
 * BEFORE app routes, so this file did nothing at all while
 * `public/robots.txt` still existed. It was deleted in the same commit, and
 * the test asserts the SERVED body rather than this module — that ordering is
 * invisible from here, and reading the response is the only way to know which
 * one won. It is the same "declared and inert" shape LB.14a caught.
 * ========================================================================== */

/** Machine and auth-gated surfaces. Nothing here is for a search result. */
const PRIVATE_PATHS = ["/console/", "/api/"];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await tenantByDomain();
  const origin = await currentOrigin();

  const rules = {
    userAgent: "*",
    allow: "/",
    disallow: PRIVATE_PATHS,
  };

  // Only a verified custom domain has exactly one shop behind it, and only
  // then is there a single sitemap this host may honestly name.
  if (tenant && origin) {
    return { rules, sitemap: `${origin}/sitemap.xml` };
  }

  return { rules };
}
