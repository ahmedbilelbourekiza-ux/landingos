import "server-only";

import type { TenantDb } from "@landingos/db";

import { nextReference } from "./ids";
import { normalizeProductName } from "./product-match";

/* =============================================================================
 * A landing page becomes a catalogue product — LB.21.
 *
 * THE GAP THIS CLOSES. A merchant builds a product in the builder and it exists
 * nowhere in the Manager until somebody retypes it. Everything the ERP does
 * with a product then fails quietly: `fulfilmentFromSale` writes the product's
 * NAME onto the order, `productOrderMatcher` looks that name up in the
 * catalogue, and with no row to find, the product's lifetime counters never
 * move, no cost basis exists, and stock cannot be tracked for the thing the
 * company actually sells.
 *
 * IDEMPOTENCY IS THE WHOLE DESIGN, because "upload all my products" is a button
 * somebody will press twice. `CatalogProductLink` already models exactly this —
 * "this catalogue row IS that external product" — so a link with
 * `platform: "landingos"` and `externalProductId: <landingPageId>` is the key.
 * Second run finds the link and updates rather than inserting a twin.
 *
 * THE DUPLICATE-NAME RULE IS LOAD-BEARING, and it is why this is not a plain
 * `create`. `duplicateProductNames` exists because two catalogue rows answering
 * to one normalised name make every order naming it attributable to NEITHER —
 * the counters stay still and revenue would be counted twice, once per row. A
 * naive importer would produce exactly that on the first run, for every product
 * a merchant had already typed in by hand. So an unlinked row with the same
 * normalised name is ADOPTED — linked and updated — rather than duplicated.
 *
 * WHAT IT DOES NOT OVERWRITE. On adoption, only fields the landing page is the
 * authority for are touched, and the ERP's own columns are left alone:
 * `costPrice`, `packagingCost`, `stock`, `threshold`, `supplier` are operational
 * facts a manager maintains, and a re-import that reset a cost basis to zero
 * would silently corrupt every profit figure derived from it. That is the same
 * failure the create route once had and the schema still warns about.
 * ========================================================================== */

export const LANDING_PLATFORM = "landingos";

export interface LandingForImport {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly price: unknown;
  readonly media: readonly { url: string }[];
}

export type ImportOutcome = "created" | "adopted" | "updated";

export interface ImportResult {
  readonly landingPageId: string;
  readonly productId: string;
  readonly outcome: ImportOutcome;
}

/**
 * Publish one landing page into the catalogue.
 *
 * Returns which of the three things happened, because the screen reports it and
 * "created 3, updated 12" is a materially different sentence from "created 15".
 */
export async function catalogProductFromLanding(
  db: TenantDb,
  tenantId: string,
  page: LandingForImport,
): Promise<ImportResult> {
  // What the landing page is the authority for. Deliberately NOT the whole
  // product — see the header.
  const fromPage = {
    name: page.title,
    description: page.description ?? "",
    price: page.price as never,
    image: page.media[0]?.url ?? "",
  };

  // 1. Already linked? Then this is a re-publish and the row is known.
  const link = await db.catalogProductLink.findFirst({
    where: { platform: LANDING_PLATFORM, externalProductId: page.id },
    select: { productId: true },
  });
  if (link) {
    await db.catalogProduct.update({ where: { id: link.productId }, data: fromPage });
    return { landingPageId: page.id, productId: link.productId, outcome: "updated" };
  }

  /* 2. An unlinked row already answering to this name? Adopt it.
   *
   * Compared on the NORMALISED name, which is what the order matcher uses — so
   * "Montre Élégante Pro" and "montre elegante pro" are the same product here
   * for the same reason they are the same product there. Read and compared in
   * code rather than matched in SQL because the normalisation is the ERP's
   * own (accents, punctuation, case) and duplicating it as a query expression
   * would be a second copy free to drift. */
  const wanted = normalizeProductName(page.title);
  let productId: string | null = null;
  if (wanted) {
    const candidates = await db.catalogProduct.findMany({
      where: { archived: false },
      select: { id: true, name: true },
    });
    const matches = candidates.filter((c) => normalizeProductName(c.name) === wanted);
    // Exactly one, or none. TWO already-ambiguous rows are left alone: adopting
    // one of them would pick a winner arbitrarily and make the ambiguity
    // permanent, and the catalogue screen already flags them for a human.
    if (matches.length === 1) productId = matches[0].id;
  }

  if (productId) {
    await db.catalogProduct.update({ where: { id: productId }, data: fromPage });
    await db.catalogProductLink.create({
      data: {
        tenantId,
        productId,
        platform: LANDING_PLATFORM,
        externalProductId: page.id,
      },
    });
    return { landingPageId: page.id, productId, outcome: "adopted" };
  }

  // 3. Nothing to adopt: a new catalogue row.
  const created = await db.catalogProduct.create({
    data: {
      tenantId,
      reference: await nextReference(db, tenantId, "product"),
      ...fromPage,
      // The page's address is the closest thing it has to a merchant-facing
      // code, and it is unique per tenant by construction.
      sku: page.slug,
    },
    select: { id: true },
  });

  await db.catalogProductLink.create({
    data: {
      tenantId,
      productId: created.id,
      platform: LANDING_PLATFORM,
      externalProductId: page.id,
    },
  });

  // The catalogue's own timeline, the same event the create route writes.
  await db.catalogProductEvent.create({
    data: { tenantId, productId: created.id, eventType: "created" },
  });

  return { landingPageId: page.id, productId: created.id, outcome: "created" };
}
