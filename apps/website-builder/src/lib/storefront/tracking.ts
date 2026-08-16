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

/** Ids that no longer resolve are dropped rather than honoured, so deleting an
 *  integration degrades a page to "fewer pixels", never to a broken page. */
function selectedIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  // An explicitly EMPTY selection is honoured as "no tracking on this page" —
  // a merchant who unticks every pixel means it. Only a null column means
  // "inherit the tenant's set".
  return ids;
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
 * set. `selection` is the column value verbatim: NULL (or anything that is
 * not an array — every pre-LB.35 row) inherits the whole active set; an array
 * is a subset; an empty array is "no tracking on this page", honoured.
 */
export function browserIntegrationsFrom(
  all: BrowserIntegrationRow[],
  selection: unknown,
): BrowserIntegration[] {
  const chosen = selectedIds(selection);
  if (chosen === null) return strip(all);
  const wanted = new Set(chosen);
  return strip(all.filter((i) => wanted.has(i.id)));
}

export async function resolveBrowserIntegrations(
  tenantId: string,
  landingPageId?: string,
): Promise<BrowserIntegration[]> {
  return withTenant(tenantId, async (db) => {
    const all = await activeBrowserIntegrationRows(db);

    if (!landingPageId) return browserIntegrationsFrom(all, null);

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
