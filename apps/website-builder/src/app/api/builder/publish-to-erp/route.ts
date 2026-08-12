import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { hasProduct } from "@/lib/erp/from-sale";
import { catalogProductFromLanding, type ImportResult } from "@/lib/erp/from-landing";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Publish landing pages into the Manager's catalogue — LB.21.
 *
 * ONE route, two scopes, because "all my products" and "this one" are the same
 * operation over a different set — and two routes would be two places for the
 * adoption rule to live.
 *
 * GATED ON THE ERP ENTITLEMENT, not merely on a permission. A builder-only
 * tenant has no catalogue to publish INTO, and `hasProduct` is the same check
 * the checkout uses before writing a fulfilment record (the M-05 architecture
 * standalone mode depends on). Without it this route would create ERP rows for
 * a company that never bought the ERP.
 *
 * WRITE PERMISSION IS THE CATALOGUE'S, not the builder's: this creates and
 * updates `CatalogProduct`, so it asks for what `POST /api/erp/products` asks
 * for. A person who may edit landing pages but not the catalogue must not be
 * able to write to it sideways through the builder (D-06.2).
 *
 * PUBLISHED PAGES ONLY on the "all" path. A draft is not a product the company
 * sells yet, and filling the catalogue with half-written experiments is how a
 * merchant stops trusting it. Naming ONE page publishes it regardless — an
 * explicit choice is an explicit choice.
 * ========================================================================== */

const Body = z.object({
  scope: z.enum(["all", "one"]),
  landingPageId: z.string().trim().min(1).max(64).optional(),
});

const PAGE_LIMIT = 200;

export const POST = tenantRoute("erp:products:write", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { scope, landingPageId } = parsed.data;
  if (scope === "one" && !landingPageId) {
    return apiError(422, "INVALID_INPUT", "Name the page to publish.");
  }

  const tenantId = session.auth!.tenantId;
  if (!(await hasProduct(db, "erp"))) {
    // Its own code: this is not "that failed", it is "this company does not
    // have the Manager", and the message says so.
    return apiError(409, "NO_ERP", "This company does not have the Manager.");
  }

  const pages = await db.landingPage.findMany({
    where:
      scope === "one"
        ? { id: landingPageId }
        : // Published only — see the header.
          { published: true },
    orderBy: { createdAt: "asc" },
    take: PAGE_LIMIT,
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      price: true,
      // The hero is the first media row, which is the same rule the editor and
      // the storefront use.
      media: { orderBy: { displayOrder: "asc" }, take: 1, select: { url: true } },
    },
  });

  if (scope === "one" && pages.length === 0) {
    // Another tenant's id does not resolve under the binding, so this is a 404
    // rather than a leak that the row exists elsewhere.
    return apiError(404, "NOT_FOUND", "That page does not exist.");
  }

  /* Sequential, not `Promise.all`. `withTenant` opens an interactive
     transaction and the client it hands back queues everything on ONE
     connection, so parallelism here buys nothing and only makes the reference
     counter contend with itself (D-PM.1.3). */
  const results: ImportResult[] = [];
  for (const page of pages) {
    results.push(await catalogProductFromLanding(db, tenantId, page));
  }

  return apiOk({
    // Counted by outcome, because "created 3, updated 12" is a materially
    // different sentence from "published 15" and the merchant is entitled to
    // know which of their catalogue rows this touched.
    created: results.filter((r) => r.outcome === "created").length,
    adopted: results.filter((r) => r.outcome === "adopted").length,
    updated: results.filter((r) => r.outcome === "updated").length,
    items: results,
  });
});
