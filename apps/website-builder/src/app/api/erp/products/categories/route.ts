import { tenantRoute, apiOk } from "@/lib/api/route";
import { productCategories } from "@/lib/erp/product-filters";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The categories this tenant's catalogue actually uses — LB.19.
 *
 * ITS OWN ROUTE rather than a field on `GET /api/erp/products`, because it
 * answers a question about the WHOLE catalogue and that list is one page of it:
 * deriving the set from `items` would report the categories on page 1 and call
 * them the categories.
 *
 * DERIVED, NOT STORED. `CatalogProduct.category` is free text by an explicit
 * schema decision — "a niche list is a handful of words per tenant, and a
 * Supplier table would be a migration plus RLS plus a management screen for
 * something no route needs to join on". LB.19 does not overturn that; it makes
 * the values already in use visible wherever the field is offered, so a
 * merchant stops inventing "Skincare", "skincare" and "Skin care" by accident.
 *
 * Static segment, so it resolves ahead of `products/[id]`. Product ids are
 * cuids, so no real product is shadowed by the word "categories".
 *
 * Read permission is the catalogue's own: knowing which categories exist is
 * knowing what is in the catalogue.
 * ========================================================================== */

export const GET = tenantRoute("erp:products:read", async ({ db, searchParams }) => {
  // `archived` is honoured for the same reason the list honours it: the
  // archived view is a different catalogue, and offering a category that
  // selects nothing there would be a filter that lies.
  const archived = searchParams.get("archived") === "true";
  return apiOk({ items: await productCategories(db, { archived }) });
});
