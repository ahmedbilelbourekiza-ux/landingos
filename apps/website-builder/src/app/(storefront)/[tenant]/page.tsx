import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { resolveStorefrontTenant, storefrontHref } from "@/lib/storefront/resolve-tenant";
import { ThemeProvider } from "@/components/landing/theme-provider";
import { StorefrontTracking } from "@/components/landing/storefront-tracking";
import { VisitBeacon } from "@/components/landing/visit-beacon";
import { DEFAULT_THEME } from "@/types/theme";

export const dynamic = "force-dynamic";

/* =============================================================================
 * A tenant's storefront homepage (M-17).
 *
 * Anonymous: the caller is a customer. The tenant comes from the URL — a path
 * slug, or a verified custom domain — and every read below filters on
 * PUBLICATION as well as the tenant binding, because binding to a tenant must
 * never be the same thing as being allowed to see their drafts.
 * ========================================================================== */

/**
 * Title and `robots` come from the storefront layout — the shop's own name and
 * `index: true`, where this page used to inherit the platform's internal
 * tagline and `noindex`. What only this route can state is its canonical, and
 * it deliberately sets no `title`: the layout's DEFAULT is already the store
 * name, and setting one here would run it through the layout's own template
 * and render "Shop · Shop".
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
  const { tenant: slug } = await params;
  const tenant = await resolveStorefrontTenant(slug);
  if (!tenant) return {};
  return { alternates: { canonical: storefrontHref(tenant) } };
}

export default async function StorefrontHome({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await resolveStorefrontTenant(slug);
  if (!tenant) notFound();

  const locale = isLocale(tenant.locale) ? tenant.locale : DEFAULT_LOCALE;

  const [pages, categories] = await withTenant(tenant.id, async (db) => [
    await (db as any).landingPage.findMany({
      where: { published: true, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true, title: true, slug: true, price: true, oldPrice: true, currency: true,
        media: {
          where: { placement: "GALLERY" },
          orderBy: { displayOrder: "asc" },
          take: 1,
          select: { url: true, altText: true },
        },
      },
    }),
    await (db as any).category.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true },
    }),
  ]);

  return (
    // Scoped to DEFAULT_THEME: a storefront is the merchant's surface, so it
    // must never follow the visitor's OS dark mode (next-themes stamps `.dark`
    // on <html> for every route). There is no store-level theme row yet —
    // when StoreSettings grows one, it slots in here in place of the default.
    <ThemeProvider theme={DEFAULT_THEME}>
      {/* LB.35 — the tenant's whole active set: a store home is not one
          product, so it has no per-page selection to make. */}
      <StorefrontTracking tenantId={tenant.id} />
      {/* AN.1 — home traffic counts too, page-less. */}
      <VisitBeacon endpoint={`/api/storefront/${tenant.slug}/visits`} pageKind="home" />
      <main className="mx-auto max-w-6xl px-4 py-10" data-tenant={tenant.slug}>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>

        {categories.length ? (
          <nav className="mt-4 flex flex-wrap gap-2" aria-label="Categories">
            {categories.map((c: any) => (
              <Link
                key={c.id}
                href={storefrontHref(tenant, `/category/${c.slug}`)}
                className="rounded-full border border-border px-3 py-1 text-sm"
              >
                {c.name}
              </Link>
            ))}
          </nav>
        ) : null}

        {pages.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground">No products are published yet.</p>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="storefront-products">
            {pages.map((p: any) => (
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
