import "server-only";

/* =============================================================================
 * Where should the console LINK a tenant's public page? (LB.46)
 *
 * The tenant→origin READ direction of the custom-domain story. LB.45 made a
 * verified domain SERVE the shop's own path shape; this is the half that makes
 * the console say so: the pages list's View door and the editor's Copy Link /
 * Open actions build from here. Until now they hard-built the platform shape,
 * and `TenantDomain.isPrimary` was a writer with no functional reader — a gap
 * the handoff recorded as deliberate while no hostname could pass Render's
 * edge. The first real domain closed that premise.
 *
 * PRIMARY AND VERIFIED, both required. Verified-only would link a hostname the
 * merchant never proved; primary is the merchant's own statement of which
 * hostname is THE address when several are linked. No domain → the
 * platform-prefixed path, exactly as before — which is every tenant without a
 * custom domain, so the fallback is the common case, not an edge.
 *
 * The query runs under the caller's tenant binding (RLS): a bound read sees
 * only the tenant's own rows, so this cannot name another shop's hostname.
 * ========================================================================== */

/** The verified primary domain's origin, or null when there is none. */
export async function primaryPublicOrigin(db: unknown): Promise<string | null> {
  const row = await (db as any).tenantDomain.findFirst({
    where: { isPrimary: true, verifiedAt: { not: null } },
    select: { domain: true },
  });
  return row ? `https://${row.domain}` : null;
}

/**
 * One public page's link: absolute on the primary domain (LB.45's bare
 * shape), or the platform-prefixed path when no domain is linked.
 */
export function publicPagePath(
  origin: string | null,
  tenantSlug: string,
  pageSlug: string,
): string {
  return origin ? `${origin}/${pageSlug}` : `/${tenantSlug}/${pageSlug}`;
}
