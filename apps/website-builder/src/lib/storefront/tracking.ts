import { withTenant, type TenantDb } from "@landingos/db";

import type { BrowserIntegration } from "@/components/landing/tracking-scripts";

/* =============================================================================
 * Which tracking integrations fire on a given storefront page (LB.35).
 *
 * WHY THIS IS NOT IN THE LAYOUT ANY MORE. LB.5 mounted the loader in
 * `[tenant]/layout.tsx` so no page could forget it, and that instinct was
 * right — the pre-LB.5 Meta loader was mounted by nothing. But a layout in the
 * App Router cannot see its child segment's params, so it can name the tenant
 * and never the PAGE. As long as the mount lived there, "this pixel belongs to
 * this product" was unexpressible: every storefront page fired every pixel the
 * tenant owned.
 *
 * The mount therefore moved down to the four storefront routes, and LB.5's
 * guarantee moved from placement to a TEST that asserts all four still emit
 * the loader. A test states the invariant out loud; a layout only implied it.
 *
 * `landingPageId` is optional because three of those four routes are not a
 * product: the store home, a category listing and the thank-you page have no
 * per-page selection to make and take the tenant's whole active set.
 *
 * SPLIT INTO QUERY + SELECTION (LB.51): the product page already holds an open
 * tenant transaction AND the page row when it needs this list, so opening a
 * second transaction here to re-read both was pure round-trip cost on the
 * critical path. The query (`activeBrowserIntegrationRows`) and the selection
 * (`browserIntegrationsFrom`) are exported separately so that page can run the
 * one query inside its own transaction and apply the same selection — one
 * definition of each, per the quote=charge rule, so the two paths cannot
 * drift. `resolveBrowserIntegrations` remains the whole story for the three
 * routes that have no transaction of their own.
 * ========================================================================== */

/**
 * The pixels a page reports to — STRICTLY the ones ticked on it (PX.1).
 *
 * Until PX.1 a NULL column meant "inherit every active pixel the company
 * owns", the editor's default. That sent one brand's Purchases into another
 * brand's dataset whenever a store ran more than one, so the rule is now
 * absolute: a page reports to the integrations listed on it and to nothing
 * else. NULL (every pre-PX.1 row, and the old "All of your tracking" mode),
 * an empty array, or anything that is not an array all mean NONE.
 *
 * Ids that no longer resolve are dropped by the callers' `id IN (...)`
 * filter, so deleting an integration degrades a page to "fewer pixels",
 * never to a broken page.
 */
export function selectedIntegrationIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** A TrackingIntegration row as the browser resolution reads it. */
export interface BrowserIntegrationRow {
  readonly id: string;
  readonly provider: string;
  readonly publicId: string;
  readonly settings: Record<string, unknown> | null;
}

/**
 * The tenant's active integrations, on a client the caller already holds.
 * Public ids and non-secret settings ONLY — this select is what keeps server
 * credentials out of the HTML.
 */
export async function activeBrowserIntegrationRows(db: TenantDb): Promise<BrowserIntegrationRow[]> {
  return (db as any).trackingIntegration.findMany({
    where: { isActive: true },
    select: { id: true, provider: true, publicId: true, settings: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Apply a page's `trackingIntegrationIds` selection to the tenant's active
 * set: exactly the ticked ones, and none when nothing is ticked (PX.1).
 */
export function browserIntegrationsFrom(
  all: BrowserIntegrationRow[],
  selection: unknown,
): BrowserIntegration[] {
  const wanted = new Set(selectedIntegrationIds(selection));
  return strip(all.filter((i) => wanted.has(i.id)));
}

export async function resolveBrowserIntegrations(
  tenantId: string,
  landingPageId?: string,
): Promise<BrowserIntegration[]> {
  return withTenant(tenantId, async (db) => {
    // No page, no pixels (PX.1): the store home and category listings belong
    // to no single product, and "every pixel the company owns" is exactly
    // the fan-out PX.1 removed.
    if (!landingPageId) return [];
    const all = await activeBrowserIntegrationRows(db);

    const page = await (db as any).landingPage.findUnique({
      where: { id: landingPageId },
      select: { trackingIntegrationIds: true },
    });

    return browserIntegrationsFrom(all, page?.trackingIntegrationIds);
  });
}

/** The loader takes only what a browser may see; `id` is ours, not its. */
function strip(rows: BrowserIntegrationRow[]): BrowserIntegration[] {
  return rows.map((r) => ({ provider: r.provider, publicId: r.publicId, settings: r.settings }));
}
