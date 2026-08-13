import { withTenant } from "@landingos/db";

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

export async function resolveBrowserIntegrations(
  tenantId: string,
  landingPageId?: string,
): Promise<BrowserIntegration[]> {
  return withTenant(tenantId, async (db) => {
    const all = await (db as any).trackingIntegration.findMany({
      where: { isActive: true },
      // Public ids and non-secret settings ONLY — this select is what keeps
      // server credentials out of the HTML.
      select: { id: true, provider: true, publicId: true, settings: true },
      orderBy: { createdAt: "asc" },
    });

    if (!landingPageId) return strip(all);

    const page = await (db as any).landingPage.findUnique({
      where: { id: landingPageId },
      select: { trackingIntegrationIds: true },
    });

    const chosen = selectedIds(page?.trackingIntegrationIds);
    // NULL — the column's default and every pre-LB.35 row — means the page
    // inherits the tenant's whole active set, which is exactly what it did
    // before the column existed.
    if (chosen === null) return strip(all);

    const wanted = new Set(chosen);
    return strip(all.filter((i: any) => wanted.has(i.id)));
  });
}

/** The loader takes only what a browser may see; `id` is ours, not its. */
function strip(rows: any[]): BrowserIntegration[] {
  return rows.map((r) => ({ provider: r.provider, publicId: r.publicId, settings: r.settings }));
}
