import { NextResponse } from "next/server";

import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant, currentOrigin } from "@/lib/storefront/resolve-tenant";

export const dynamic = "force-dynamic";

/* =============================================================================
 * A tenant's sitemap — LB.39, and it is LB.37's rule stated a second way.
 *
 * LB.37 settled WHICH storefront pages may be indexed; a sitemap is the same
 * decision written where a crawler reads it, so the two must not be able to
 * disagree. The set here is exactly LB.37's indexable set and nothing else:
 *
 *   included   the store home, every VISIBLE category, every PUBLISHED page
 *   excluded   thank-you (LB.37 marks it `noindex` — it carries a customer's
 *              name, wilaya and total), drafts and archived pages (404s to the
 *              public, and an archived page must stop selling), and the
 *              console, which is not under this layout at all
 *
 * The exclusions are not filters bolted on afterwards: each is the SAME
 * predicate the page itself uses — `published: true AND status: PUBLISHED` for
 * a product, `isVisible: true` for a category. A page that 404s therefore
 * cannot be advertised here. A sitemap listing a 404 is worse than no sitemap;
 * it spends a crawler's budget and teaches it this host is unreliable.
 *
 * A ROUTE HANDLER AND NOT `sitemap.ts`, AND THAT WAS MEASURED. Next's metadata
 * convention does not pass route params to the sitemap function: placed at
 * `[tenant]/sitemap.ts` it is invoked with `undefined` and dies destructuring
 * it (500, reproduced). The documented way to vary one is `generateSitemaps`,
 * which enumerates ids up front — for this app that means listing every
 * tenant, publishing the customer roster to anyone who asks for it. A handler
 * takes `params` the same way the four storefront routes already do.
 *
 * WHY IT LIVES UNDER `[tenant]` AND NOT AT THE ROOT. The platform host is one
 * app serving many shops. `/sitemap.xml` there would be either every tenant's
 * pages in one file — the same roster leak — or nothing at all, and neither is
 * a shop's sitemap. Under the tenant segment each merchant gets their own at
 * `/{tenant}/sitemap.xml`, read through the same `withTenant` binding as every
 * other storefront query, so a bug here cannot reach another tenant's rows.
 *
 * CUSTOM DOMAINS ARE DELIBERATELY NOT SPECIAL-CASED. `currentOrigin()` is
 * whatever host the request arrived at, so this same route emits
 * `https://shop.acme.dz/acme/...` when reached through a linked domain — and
 * the tenant prefix is right there, because the root REDIRECTS a custom domain
 * to `/{slug}` rather than serving at `/` (`app/page.tsx`). Whether that prefix
 * should exist at all is LB.14a.2, "one front door per tenant identity", which
 * is scoped and unbuilt. A sitemap must describe the URLs that answer TODAY.
 *
 * `Cache-Control` is NOT set here on purpose: `next.config.ts`'s storefront
 * rule already matches this path and gives it `private, max-age=60,
 * must-revalidate` (LB.14a). That is the right answer for a sitemap — it
 * carries no price and no order, so nothing about it can go stale in a way
 * that costs anyone money — and setting a second value here is how the two
 * would drift apart.
 * ========================================================================== */

/** XML's five, because a slug is user-controlled text going into a document. */
const esc = (s: string) =>
  s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );

interface Entry {
  readonly loc: string;
  readonly lastmod?: Date;
  readonly changefreq: string;
  readonly priority: string;
}

const render = (entries: readonly Entry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries
    .map(
      (e) =>
        `  <url>\n` +
        `    <loc>${esc(e.loc)}</loc>\n` +
        (e.lastmod ? `    <lastmod>${e.lastmod.toISOString()}</lastmod>\n` : "") +
        `    <changefreq>${e.changefreq}</changefreq>\n` +
        `    <priority>${e.priority}</priority>\n` +
        `  </url>\n`,
    )
    .join("") +
  `</urlset>\n`;

const xml = (body: string, status = 200) =>
  new NextResponse(body, {
    status,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenant: string }> },
) {
  const { tenant: slug } = await ctx.params;
  const tenant = await resolveStorefrontTenant(slug);
  const origin = await currentOrigin();

  // An unknown tenant is a 404, like every other storefront route — not an
  // empty sitemap, which would tell a crawler the shop exists and sells
  // nothing. Without an origin there are no absolute URLs to emit, and the
  // protocol has no way to say "I do not know"; that is a 404 too.
  if (!tenant || !origin) return xml(render([]), 404);

  const base = `${origin}/${tenant.slug}`;

  const [pages, categories] = await withTenant(tenant.id, async (db) => [
    await (db as any).landingPage.findMany({
      // The storefront's own predicate, not a looser one — see the header.
      where: { published: true, status: "PUBLISHED" },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    await (db as any).category.findMany({
      where: { isVisible: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  /* The home has no `updatedAt` of its own, so it borrows the newest thing it
   * links to — which is what "this shop changed" actually means. Both queries
   * are already sorted, so this reads two heads rather than scanning. A static
   * or invented date would be worse than omitting the field: it trains a
   * crawler to stop believing the ones that are true. */
  const newest = [pages[0]?.updatedAt, categories[0]?.updatedAt]
    .filter(Boolean)
    .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] as Date | undefined;

  const entries: Entry[] = [
    // Highest, because it is the one URL that stays meaningful after a product
    // is retired.
    { loc: base, lastmod: newest, changefreq: "daily", priority: "1.0" },
    ...categories.map((c: { slug: string; updatedAt: Date }) => ({
      loc: `${base}/category/${c.slug}`,
      lastmod: c.updatedAt,
      changefreq: "weekly",
      priority: "0.5",
    })),
    ...pages.map((p: { slug: string; updatedAt: Date }) => ({
      loc: `${base}/${p.slug}`,
      lastmod: p.updatedAt,
      // Price and availability are what move on a landing page, and they are
      // the same two things LB.14a refuses to let a shared cache hold.
      changefreq: "daily",
      priority: "0.8",
    })),
  ];

  return xml(render(entries));
}
