import "server-only";

import type { Prisma, TenantDb } from "@landingos/db";

/* =============================================================================
 * What the catalogue is filtered by — LB.19.
 *
 * ONE function, called by the products SCREEN and by `GET /api/erp/products`.
 * Both of them built this `where` by hand, in two places, under a comment that
 * said "the same shape GET /api/erp/products builds, so the screen and the
 * endpoint cannot disagree about what a search matches". It was a copy, and a
 * copy is a promise nobody enforces: the moment one side gained a filter the
 * other would answer a different question about the same URL.
 *
 * This is the shape `orderFilters` already has for orders, for the same reason.
 *
 * `archived` stays a separate VIEW rather than a filter that widens the default
 * one — archiving is how the ERP removes a product without destroying the
 * history that references it, so the active list must never include archived
 * rows by accident.
 * ========================================================================== */

export function productWhere(params: URLSearchParams): Prisma.CatalogProductWhereInput {
  const get = (k: string) => params.get(k)?.trim() || undefined;

  const where: Prisma.CatalogProductWhereInput = {
    archived: params.get("archived") === "true",
  };

  const search = get("search");
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { reference: { contains: search, mode: "insensitive" } },
    ];
  }

  /* Exact match, not `contains`. The value comes from the list of categories
   * the catalogue actually uses, so a substring match would make "Skin" also
   * select "Skincare" and quietly report the wrong count — and the filter is
   * offered as a CHOICE, so there is nothing to be lenient about. */
  const category = get("category");
  if (category) where.category = category;

  const niche = get("niche");
  if (niche) where.niche = niche;

  return where;
}

/**
 * The categories this tenant's catalogue actually uses, with how many products
 * carry each.
 *
 * DERIVED, NOT STORED, and that is the whole design decision here — see the
 * note on `CatalogProduct.niche`/`category`/`supplier` in the schema, which
 * chose free text over relations deliberately: "a niche list is a handful of
 * words per tenant, and a Supplier table would be a migration plus RLS plus a
 * management screen for something no route needs to join on". LB.19 does not
 * overturn that. It closes the gap the decision left open — the field was
 * unguided, so a merchant typing "Skincare", "skincare" and "Skin care" got
 * three categories and no way to see that they had — by showing what is
 * already in use wherever the field is offered.
 *
 * A `groupBy` rather than a `findMany` + reduce: the count comes from the
 * database rather than from however many rows one page happened to load.
 */
export interface ProductCategory {
  readonly name: string;
  readonly count: number;
}

/**
 * One reader for both classification columns, because `niche` has exactly the
 * same problem and the same fix — and two near-identical functions is how the
 * second one stops matching the first.
 */
export async function productClassification(
  db: TenantDb,
  field: "category" | "niche",
  opts: { archived?: boolean } = {},
): Promise<ProductCategory[]> {
  const rows = await db.catalogProduct.groupBy({
    by: [field],
    where: { archived: opts.archived ?? false, [field]: { not: null } },
    _count: { _all: true },
  });

  return (rows as Array<Record<string, unknown> & { _count: { _all: number } }>)
    // The column is nullable AND the create route writes `input.category ?? ""`,
    // so both kinds of empty have to go. Filtered in code rather than in the
    // query, which keeps the groupBy a single indexed pass.
    .map((r) => ({ name: String(r[field] ?? "").trim(), count: r._count._all }))
    .filter((r) => r.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function productCategories(
  db: TenantDb,
  opts: { archived?: boolean } = {},
): Promise<ProductCategory[]> {
  return productClassification(db, "category", opts);
}
