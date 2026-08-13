import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { asPlatform, withVerifiedDomains } from "@landingos/db";

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

/* -----------------------------------------------------------------------------
 * WHICH HOSTNAME IS THIS REQUEST FOR, AND WHO IS ALLOWED TO SAY SO
 *
 * `x-forwarded-host` is CLIENT INPUT. Render's edge passes a client-supplied
 * one straight through, so trusting it wholesale meant anyone could serve any
 * tenant's storefront from any URL by adding a header — measured, not
 * theorised: `GET /demo` with `X-Forwarded-Host: <victim's verified domain>`
 * rendered the VICTIM's storefront instead of demo's.
 *
 * `host`, by contrast, IS validated at the edge: an unconfigured hostname
 * never reaches the app at all (Render answers 403 `x-render-routing` — the
 * deploy probe proved it), because that header is what the edge routes by.
 *
 * So the rule is: a request that ARRIVED AT the platform's own address is a
 * platform request, whatever a forwarded header claims about it. The forwarded
 * value is honoured only when the request did not arrive at a platform address
 * — the genuine custom-domain shape, where the edge has already accepted the
 * hostname — and even then the value must survive the DB's verified-domain
 * lookup, which is the second gate that has always been there.
 * -------------------------------------------------------------------------- */

/** Hostnames the platform answers on ITSELF, where no custom domain applies. */
function platformHosts(): Set<string> {
  const set = new Set<string>([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "0.0.0.0",
  ]);
  // The deployment's own names, when the environment states them.
  for (const key of ["PUBLIC_HOST", "RENDER_EXTERNAL_HOSTNAME"] as const) {
    const value = process.env[key];
    if (value) set.add(normalizeHost(value) ?? value.toLowerCase());
  }
  return set;
}

function isPlatformHost(host: string): boolean {
  // `*.onrender.com` is always the platform's own surface — the domains route
  // refuses to let a tenant claim one, so a request arriving there is a
  // platform request by construction, with or without PUBLIC_HOST set.
  if (host === "onrender.com" || host.endsWith(".onrender.com")) return true;
  if (host.endsWith(".localhost")) return true;
  return platformHosts().has(host);
}

/**
 * One hostname from one header value: lowercased, port removed, and rejected
 * outright if it is not a plain hostname.
 *
 * A comma-separated value means the header crossed several hops — or that
 * somebody injected one. The LAST entry is the one written by the hop nearest
 * us, so it is the only entry with any claim to trust; taking the first would
 * take precisely the value an attacker prepends.
 */
function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(",");
  const nearest = parts[parts.length - 1].trim().toLowerCase();
  const withoutPort = nearest.replace(/:\d+$/, "");
  if (!withoutPort || withoutPort.length > 253) return null;
  // Hostname charset only: letters, digits, hyphens, dots. No scheme, no path,
  // no whitespace, no credentials — a value carrying any of those is not a
  // hostname and must not become one by truncation.
  if (!/^[a-z0-9.-]+$/.test(withoutPort)) return null;
  return withoutPort;
}

/**
 * The hostname of the current request, without the port — trusted only as far
 * as the header it came from deserves. See the block comment above.
 */
async function currentHost(): Promise<string | null> {
  const h = await headers();
  const direct = normalizeHost(h.get("host"));
  const forwarded = normalizeHost(h.get("x-forwarded-host"));

  // Arrived at the platform's own address: ignore any claim to the contrary.
  if (direct && isPlatformHost(direct)) return direct;

  // Otherwise the edge accepted this hostname; prefer what it routed by.
  return direct ?? forwarded;
}

/**
 * The absolute origin this request arrived at — `https://shop.acme.dz`.
 *
 * Exists because a sitemap is the one thing this app emits that CANNOT be
 * path-relative: the protocol requires absolute `<loc>` values. Everything
 * else — canonicals, nav, Copy Link — stays relative on purpose.
 *
 * It reuses `currentHost()` rather than reading a header itself, which is the
 * whole point: the rule about which header may be believed is stated once,
 * above, and a second reader would be a second chance to get it wrong. A
 * spoofed `X-Forwarded-Host` therefore cannot put another hostname into a
 * merchant's sitemap.
 *
 * The SCHEME is derived from the host rather than from `X-Forwarded-Proto`,
 * deliberately: that header is client input too, and this deployment is
 * https-only everywhere that is not a development machine. Trusting it would
 * add a second spoofable input to gain nothing.
 */
export async function currentOrigin(): Promise<string | null> {
  const host = await currentHost();
  if (!host) return null;
  const local =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  if (!local) return `https://${host}`;

  /* Development only: `currentHost()` strips the port because a domain lookup
   * must not include one, but an origin without it does not resolve on a dev
   * machine. Read back from the raw header rather than threading a second
   * return value through the vetted path, and only for a host already proven
   * local — so this branch cannot run in production. */
  const raw = (await headers()).get("host") ?? "";
  const port = /:(\d+)$/.exec(raw)?.[1];
  return `http://${host}${port ? `:${port}` : ""}`;
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
  // A platform hostname has no custom-domain row by construction, and asking
  // costs a query on every console and API request that is not a storefront.
  if (isPlatformHost(host)) return null;

  // The pre-tenant binding: `tenant_isolation_verified` opens VERIFIED rows
  // only inside this, so the lookup that discovers a tenant can happen before
  // one is bound without widening what any bound read sees.
  const domain = await withVerifiedDomains((db) =>
    (db as any).tenantDomain.findUnique({
      where: { domain: host },
      include: { tenant: true },
    }),
  );

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
