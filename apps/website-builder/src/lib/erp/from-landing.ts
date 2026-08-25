import "server-only";

import type { TenantDb } from "@landingos/db";

import { nextReference } from "./ids";
import { normalizeProductName } from "./product-match";
import { rollUp } from "./inventory";
// VAR.1 — the shared vocabulary: the builder's axes, the ERP's matrix.
// VAR.2 — `reconcileMatrix` and `MatrixOutcome` live in the shared module,
// not here: they are PURE, and a `server-only` module cannot be imported by
// the bare-node suite that tests them (the rule zcode-dev-loop records).
import {
  axesFromLandingVariants,
  matrixFromLandingVariants,
  reconcileMatrix,
  type StoredVariant,
  type MatrixOutcome,
} from "./variant-axes";

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
  /* VAR.2 — the page's option rows, in definition order. The send used to
   * carry none, which is the reported bug: the merchant retyped every variant
   * on the ERP side, and (INV.2) storefront orders named none of them anyway,
   * so the retyping bought a display and not tracking. */
  readonly variants?: readonly { name: string; value: string; displayOrder?: number | null }[];
  /* CAT.1 — the page's category, by NAME. The platform has had two category
   * systems since LB.19 — the builder's `Category` table and the ERP's free
   * text `CatalogProduct.category` — and the send mapped nothing between
   * them, so the Manager's category filter was permanently empty for every
   * product the builder created. Free text is the ERP's own decision (a
   * relation there "would be a migration plus RLS plus a management screen
   * for something no route needs to join on"), so this copies the NAME and
   * changes neither model. */
  readonly category?: { name: string } | null;
}

export type ImportOutcome = "created" | "adopted" | "updated";

export interface ImportResult {
  readonly landingPageId: string;
  readonly productId: string;
  readonly outcome: ImportOutcome;
  /** VAR.2 — absent when the page sells no options, or on adoption. */
  readonly matrix?: MatrixOutcome;
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
    /* CAT.1 — see `LandingForImport.category`. Only written when the page HAS
     * one: an empty string would clear a category a manager set on the ERP
     * side by hand, which is the class of overwrite this file's header
     * refuses for `costPrice` and `supplier`. */
    ...(page.category?.name ? { category: page.category.name } : {}),
  };

  /* VAR.2 — the matrix this page now implies. Empty for a page selling no
   * options, in which case everything below leaves `variants` alone and the
   * product keeps its single unnamed level. */
  const wantedMatrix = matrixFromLandingVariants(page.variants ?? []);

  // 1. Already linked? Then this is a re-publish and the row is known.
  const link = await db.catalogProductLink.findFirst({
    where: { platform: LANDING_PLATFORM, externalProductId: page.id },
    select: { productId: true },
  });
  if (link) {
    /* A RE-SEND RECONCILES, IT DOES NOT REPLACE. The stored matrix carries
     * levels, SKUs and photographs the merchant maintains on the ERP side;
     * overwriting it with a freshly generated one would zero every level with
     * no movement row behind it — the loss D-LP.18.2 refuses.
     *
     * Nothing happens at all when the page sells no options: a merchant who
     * never used variants in the builder must not have a hand-built ERP matrix
     * quietly emptied by a re-publish. */
    let matrix: MatrixOutcome | undefined;
    let variantsPatch: Record<string, unknown> = {};
    if (wantedMatrix.length) {
      const current = await db.catalogProduct.findUnique({
        where: { id: link.productId },
        select: { variants: true },
      });
      const stored = (Array.isArray(current?.variants) ? current!.variants : []) as StoredVariant[];
      const merged = reconcileMatrix(stored, wantedMatrix);
      matrix = merged.outcome;
      variantsPatch = {
        variants: merged.next as never,
        optionDefs: axesFromLandingVariants(page.variants ?? []) as never,
        // The roll-up follows the array, as everywhere else stock is written.
        stock: rollUp(merged.next as never[], 0),
      };
    }
    await db.catalogProduct.update({
      where: { id: link.productId },
      data: { ...fromPage, ...variantsPatch },
    });
    return { landingPageId: page.id, productId: link.productId, outcome: "updated", matrix };
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
    /* VAR.2 — ADOPTION DOES NOT TOUCH THE MATRIX, deliberately.
     *
     * This row was typed by a human before the builder ever knew about it, and
     * whatever variants it holds are the warehouse's real inventory with real
     * levels behind them. The page's axes are a guess at the same thing, and
     * generating over them would either zero those levels or leave two naming
     * schemes fighting over one shelf. The merchant can regenerate from the
     * variant editor once they have looked at both — which is a decision, and
     * decisions of that size are not made by a re-publish. */
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
      /* VAR.2 — the matrix, generated. EVERY combination starts at zero and
       * receives its opening stock as a movement (INV.3), because a number
       * invented here would be stock the warehouse never counted. `stock`
       * stays 0 for the same reason it always did. */
      ...(wantedMatrix.length
        ? {
            variants: wantedMatrix.map((w) => ({
              name: w.name, sku: "", image: "", stock: 0, threshold: 0, options: w.options,
            })) as never,
            optionDefs: axesFromLandingVariants(page.variants ?? []) as never,
          }
        : {}),
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

  return {
    landingPageId: page.id,
    productId: created.id,
    outcome: "created",
    ...(wantedMatrix.length
      ? { matrix: { added: wantedMatrix.length, removed: 0, keptHoldingStock: [] } }
      : {}),
  };
}
