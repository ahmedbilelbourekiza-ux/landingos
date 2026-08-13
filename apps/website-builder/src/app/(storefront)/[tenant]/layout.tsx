import type { Metadata } from "next";

import { withTenant } from "@landingos/db";

import { resolveStorefrontTenant } from "@/lib/storefront/resolve-tenant";
import { resolveStoreName } from "@/lib/storefront/store-identity";

/* =============================================================================
 * WHOSE IDENTITY A STOREFRONT PAGE WEARS IN ITS <head>.
 *
 * LB.31 closed this in the BODY — nav brand, footer, socials — and left the
 * head untouched, so the same leak survived one layer up where it is harder to
 * see and further-reaching. Measured on a real published page in production:
 *
 *   <title>Montre en cuir · LandingOS</title>
 *   robots: noindex, nofollow          (store home and category)
 *   description: the platform's own internal tagline
 *
 * Both come from the ROOT layout, whose comment reads "Internal admin tool —
 * never indexed" — true when this app was only a console, and inherited by
 * every storefront page ever since.
 *
 * THE ROOT STAYS noindex ON PURPOSE. It is the fail-closed default: anything
 * new is invisible to search until it says otherwise, and the console has no
 * robots declaration of its own — it relies on exactly that inheritance. So
 * the storefront opts IN here rather than the root opting out, which also
 * means a future route under this layout is public by construction while a
 * future route anywhere else is not.
 *
 * DECLARED AT THE LAYOUT, for the same reason the favicon below is: home,
 * category, product and thank-you all need a merchant identity, and a default
 * repeated in four pages is four chances to forget one. Pages override what is
 * genuinely theirs — the product its own title, the thank-you its `noindex`.
 *
 * The `template` matters as much as the default. The root's is
 * `%s · LandingOS`, and it applies to any child that sets a title string — so
 * the product page, which HAS always set its own correct title, still served
 * the platform's name appended to it. Replacing the template here fixes every
 * page that sets a title, including ones not written yet.
 * ========================================================================== */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
  const { tenant: slug } = await params;
  const tenant = await resolveStorefrontTenant(slug);
  // No tenant means a 404, and a 404 inherits the root's noindex. Returning
  // the merchant defaults here would advertise a shop that does not exist.
  if (!tenant) return {};

  const settings = (await withTenant(tenant.id, (db) =>
    (db as any).storeSettings.findUnique({
      where: { tenantId: tenant.id },
      select: { favicon: true, storeName: true, storeDescription: true },
    }),
  )) as { favicon: string | null; storeName: string | null; storeDescription: string | null } | null;

  // The same resolver the nav and footer use (LB.31): an absent row and an
  // untouched `storeName` default both mean "no name chosen", and the honest
  // answer to both is the tenant's own name — never the platform's.
  const storeName = resolveStoreName(settings?.storeName, tenant.name);

  return {
    /* `absolute`, NOT `default` — measured, and the first attempt was wrong.
     * A `default` is still the title of a segment that HAS a parent template,
     * so the root's `%s · LandingOS` wrapped it and the store home served
     * "Shop A Store · LandingOS" — the platform's name back in the tab by the
     * very metadata meant to remove it. `absolute` is the one form that ends
     * template resolution upward, and it takes a `template` for children in
     * the same object, so both halves stay declared in one place. */
    title: { absolute: storeName, template: `%s · ${storeName}` },
    description: settings?.storeDescription ?? undefined,
    /* A storefront is a shop. It is meant to be found — the product page has
     * said so since it was written; home and category never did and were
     * therefore excluded from search entirely. */
    robots: { index: true, follow: true },
    openGraph: { siteName: storeName },
    ...(settings?.favicon ? { icons: { icon: settings.favicon } } : {}),
  };
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
