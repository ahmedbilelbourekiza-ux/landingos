import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { resolveStorefrontTenant, storefrontHref } from "@/lib/storefront/resolve-tenant";
import { ThemeProvider } from "@/components/landing/theme-provider";
import { StorefrontTracking } from "@/components/landing/storefront-tracking";
import { DEFAULT_THEME } from "@/types/theme";

export const dynamic = "force-dynamic";

/* =============================================================================
 * A category listing.
 *
 * `/[tenant]/category/[slug]` is a STATIC segment inside the tenant, so it can
 * never be shadowed by a product whose slug happens to be "category" — Next
 * prefers the static match. That is also why "category" is on the reserved
 * tenant-slug list: at the root it would collide with a company of that name.
 * ========================================================================== */

/**
 * The category's own name as the title, which the layout's template turns into
 * "Montres · Boutique Nour". Before this, every category on every shop served
 * the platform's default title and `noindex` — so a merchant's whole catalogue
 * structure was both anonymous and invisible to search.
 *
 * An invisible or missing category returns bare metadata rather than a name:
 * the page 404s below, and a 404 must fall back to the root's noindex instead
 * of advertising a category that is not on sale.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}): Promise<Metadata> {
  const { tenant: tenantSlug, slug } = await params;
  const tenant = await resolveStorefrontTenant(tenantSlug);
  if (!tenant) return {};

  const category = (await withTenant(tenant.id, (db) =>
    (db as any).category.findFirst({
      where: { slug, isVisible: true },
      select: { name: true, description: true },
    }),
  )) as { name: string; description: string | null } | null;
  if (!category) return { robots: { index: false, follow: false } };

  return {
    title: category.name,
    ...(category.description ? { description: category.description } : {}),
    alternates: { canonical: storefrontHref(tenant, `/category/${slug}`) },
  };
}

export default async function StorefrontCategoryPage({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}) {
  const { tenant: tenantSlug, slug } = await params;
  const tenant = await resolveStorefrontTenant(tenantSlug);
  if (!tenant) notFound();

  const locale = isLocale(tenant.locale) ? tenant.locale : DEFAULT_LOCALE;

  const category = await withTenant(tenant.id, (db) =>
    (db as any).category.findFirst({
      where: { slug, isVisible: true },
      select: {
        id: true,
        name: true,
        description: true,
        landingPages: {
          where: { published: true, status: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            currency: true,
            media: {
              where: { placement: "GALLERY" },
              orderBy: { displayOrder: "asc" },
              take: 1,
              select: { url: true, altText: true },
            },
          },
        },
      },
    }),
  );

  if (!category) notFound();

  return (
    // Same scope as the store home: the merchant's canvas, not the visitor's
    // OS preference. See the home page for why DEFAULT_THEME and not a store
    // theme — StoreSettings has no theme field yet.
    <ThemeProvider theme={DEFAULT_THEME}>
      {/* LB.35 — the tenant's whole active set; a category is a listing, not
          one product. */}
      <StorefrontTracking tenantId={tenant.id} />
      <main className="mx-auto max-w-6xl px-4 py-10" data-tenant={tenant.slug}>
        <h1 className="text-2xl font-semibold">{category.name}</h1>
        {category.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{category.description}</p>
        ) : null}

        {category.landingPages.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul
            className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="category-products"
          >
            {category.landingPages.map((p: any) => (
              <li key={p.id}>
                <Link
                  href={storefrontHref(tenant, `/${p.slug}`)}
                  data-product-slug={p.slug}
                  className="block overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
                >
                  {p.media[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.media[0].url}
                      alt={p.media[0].altText ?? p.title}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-full bg-muted" />
                  )}
                  <div className="p-3">
                    <span className="block font-medium">{p.title}</span>
                    <span className="mt-1 block tabular-nums">
                      {formatMoney(String(p.price), locale, p.currency)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </ThemeProvider>
  );
}
