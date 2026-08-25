import "server-only";

import type { TenantDb } from "@landingos/db";

import { LANDING_PLATFORM } from "./from-landing";
// VAR.2 — the pure half (`refuseIfOutOfStock`) lives in `variant-axes.ts`;
// a `server-only` module cannot be imported by the bare-node suite.
import {
  axesFromMatrix,
  combinationsFromMatrix,
  type VariantLevels,
  type MatrixRow,
} from "./variant-axes";
export { refuseIfOutOfStock, offerableCombination } from "./variant-axes";
export type { VariantLevels } from "./variant-axes";

/* =============================================================================
 * VAR.2 (addition A) — the inventory gate.
 *
 * THE TOGGLE IS THE FEATURE, not a compromise on it. The merchant asked for
 * out-of-stock combinations to grey out on the storefront AND asked that the
 * whole rule be optional, for a reason worth writing down: a new product or a
 * new variant is routinely tested before it has ever been sent to the Manager
 * or given any stock. Enforced always, that test is impossible — the page
 * would refuse every order for a product whose levels nobody has entered yet.
 * So `LandingSetting.inventoryEnforcement` defaults to OFF and every page
 * behaves exactly as it does today until a merchant decides otherwise.
 *
 * WHERE THE STOCK LIVES, and why this module is the only one that knows: the
 * levels are on `CatalogProduct.variants`, reached through the
 * `CatalogProductLink` row the send writes. A page that has never been sent
 * has no link, therefore no levels, therefore nothing to enforce — and that
 * reads as "sell freely", the same answer as the toggle being off. That is
 * deliberate: turning enforcement on early is harmless rather than a trap that
 * silently closes a shop.
 *
 * ENFORCED TWICE, like `behaviorTracking` before it. The storefront greys out
 * what cannot be bought, and the checkout refuses it. The first is courtesy
 * and can be bypassed by anyone with a stale tab or a terminal; the second is
 * the guarantee.
 * ========================================================================== */

/**
 * The levels this page sells against, or an unenforced answer.
 *
 * Read inside the caller's transaction, like `hasProduct`: `CatalogProduct` is
 * RLS-scoped, so an unbound client would read nothing and every combination
 * would silently look out of stock — the failure mode that must not happen
 * here, because it would close a working shop.
 */
export async function variantLevelsFor(
  db: TenantDb,
  landingPageId: string,
  enforcementOn: boolean,
): Promise<VariantLevels> {
  /* VAR.1 (fuller scope) — read the matrix WHATEVER the toggle says.
   *
   * It used to return here when enforcement was off, because the only reason
   * to look was stock. The Manager is now the ongoing source of truth for
   * WHICH combinations exist, and that is not a stock question — a manager who
   * deletes a variant has stopped making it, and the shop must stop offering
   * it whether or not the merchant also asked for levels to be enforced.
   *
   * ONE statement, not two. The link and the product it points at are read
   * together, so this costs the storefront a single extra SELECT on the
   * critical path rather than the two a separate lookup would add — the same
   * arithmetic LB.51 was decided on (D-PM.1.3: the query count IS the
   * latency). A page with no link pays that one statement and nothing else.
   */
  const link = (await db.catalogProductLink.findFirst({
    where: { platform: LANDING_PLATFORM, externalProductId: landingPageId },
    select: { product: { select: { variants: true, optionDefs: true } } },
  })) as { product: { variants: unknown; optionDefs: unknown } | null } | null;

  const rows = (Array.isArray(link?.product?.variants) ? link!.product!.variants : []) as MatrixRow[];
  if (!link?.product || !rows.length) {
    /* No link, or a linked product with no matrix at all. Both mean "there is
     * nothing here to consult", which must read as "sell freely" — anything
     * else would close a working shop over a bookkeeping gap. `combinations`
     * is left UNDEFINED rather than empty for exactly that reason. */
    return { stock: {}, enforced: false };
  }

  const stock: Record<string, number> = {};
  for (const row of rows) {
    const name = String(row.name ?? "");
    if (name) stock[name] = Number(row.stock ?? 0);
  }

  const defs = Array.isArray(link.product.optionDefs)
    ? (link.product.optionDefs as { name?: string }[])
    : null;

  return {
    stock,
    // Stock is gated only when the merchant asked for it (VAR.2's toggle).
    enforced: enforcementOn,
    // The offer follows the matrix unconditionally.
    combinations: combinationsFromMatrix(rows),
    axes: axesFromMatrix(rows, defs),
  };
}
