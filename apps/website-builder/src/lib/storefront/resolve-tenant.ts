import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { asPlatform } from "@landingos/db";

/* =============================================================================
 * Which tenant is this storefront request for? (M-17)
 *
 * Two ways in, per decision D2:
 *
 *   path prefix   landingos.app/acme/winter-jacket
 *   custom domain shop.acme.dz/winter-jacket
 *
 * A custom domain WINS. A tenant who has linked their own hostname expects it
 * to be theirs entirely, and honouring a path prefix on it would let anyone
 * serve another tenant's storefront from that company's domain — which is
 * worse than a bug, it is someone else's brand on your address.
 *
 * Anonymous by design. There is no session here: the caller is a customer, and
 * the tenant comes from the URL. That is safe because tenant BINDING and
 * tenant AUTHORITY are different things — binding to a tenant grants no more
 * than the published rows that tenant chose to make public, and every read
 * below filters on publication in addition to the binding.
 * ========================================================================== */

export interface StorefrontTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly locale: string;
  readonly currency: string;
  /** True when reached through a linked custom domain rather than /slug. */
  readonly viaCustomDomain: boolean;
}

/**
 * Paths the platform owns at the URL root. A tenant slug may never be one of
 * these, or the company would shadow the platform for everybody (R-08).
 *
 * Short, and that is the point: moving product consoles under /console took
 * every product path out of this namespace, so a tenant CAN now be called
 * "builder" or "erp".
 */
export const RESERVED_TENANT_SLUGS: readonly string[] = [
  "console",
  "api",
  "login",
  "logout",
  "signup",
  "invite",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  // Retained while the legacy dashboard still exists. Removed with it.
  "dashboard",
  "l",
  "category",
  "thank-you",
  "preview",
  "uploads",
  "products",
  "avatars",
];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUGS.includes(slug.toLowerCase());
}

/** The hostname of the current request, without the port. */
async function currentHost(): Promise<string | null> {
  const h = await headers();
  const raw = h.get("x-forwarded-host") ?? h.get("host");
  return raw ? raw.split(":")[0].toLowerCase() : null;
}

/**
 * Resolve a tenant from a linked, VERIFIED custom domain.
 *
 * Verification is not decoration: without it, anyone could point a hostname at
 * the platform and claim it, and traffic for that name would be served as
 * their storefront.
 *
 * `cache` dedupes within a request — a page, its layout and its metadata all
 * ask this, and it should be one query.
 */
export const tenantByDomain = cache(async (): Promise<StorefrontTenant | null> => {
  const host = await currentHost();
  if (!host) return null;

  const domain = await asPlatform().tenantDomain.findUnique({
    where: { domain: host },
    include: { tenant: true },
  });

  if (!domain || !domain.verifiedAt) return null;
  if (domain.tenant.deletedAt || domain.tenant.status !== "ACTIVE") return null;

  const t = domain.tenant;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    locale: t.locale,
    currency: t.currency,
    viaCustomDomain: true,
  };
});

/** Resolve a tenant from a path slug. */
export const tenantBySlug = cache(async (slug: string): Promise<StorefrontTenant | null> => {
  if (!slug || isReservedSlug(slug)) return null;

  const t = await asPlatform().tenant.findUnique({ where: { slug: slug.toLowerCase() } });
  // A suspended tenant's storefront goes dark. Their data survives, their
  // console still opens, but customers stop being able to order — which is
  // what "suspended" has to mean for a business that stopped paying.
  if (!t || t.deletedAt || t.status !== "ACTIVE") return null;

  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    locale: t.locale,
    currency: t.currency,
    viaCustomDomain: false,
  };
});

/**
 * The tenant for this storefront request: custom domain first, then the path.
 */
export async function resolveStorefrontTenant(
  slugFromPath?: string,
): Promise<StorefrontTenant | null> {
  const byDomain = await tenantByDomain();
  if (byDomain) return byDomain;
  return slugFromPath ? tenantBySlug(slugFromPath) : null;
}

/** Build a storefront URL that is correct for however this tenant was reached. */
export function storefrontHref(tenant: StorefrontTenant, path = ""): string {
  const suffix = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return tenant.viaCustomDomain ? suffix || "/" : `/${tenant.slug}${suffix}`;
}
