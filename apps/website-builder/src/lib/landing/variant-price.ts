/* =============================================================================
 * VP.1 — a variant option's OWN price, and the one rule that reads it.
 *
 * NO DIRECTIVE, for the reason `variant-label.ts` states: the storefront's
 * order store computes the unit price in the browser, the checkout computes it
 * on the server, and the suite exercises the rule in bare node. A module all
 * three import can carry neither `server-only` nor `"use client"`.
 *
 * -----------------------------------------------------------------------------
 * THE RULE
 *
 *   base = the own price of the chosen option that has one, else the product
 *          price;
 *   unit = base + the `extraPrice` of every chosen option.
 *
 * `extraPrice` keeps its meaning (an add-on) and every existing page prices
 * exactly as it did, because no existing row has an own price. An option with
 * an own price carries no add-on — the variants PUT zeroes it — so "+ extras"
 * never double-counts the row that set the base.
 *
 * ONE AXIS. "Size: M = 2800" and "Colour: Gold = 3100" chosen together have no
 * honest answer, so own prices may live on one axis per page (the PUT refuses
 * a second). Should data ever hold two anyway, the FIRST chosen option in
 * display order wins — both callers pass the selection in that order, so the
 * page and the charge still agree.
 *
 * WHY THE ARITHMETIC IS NOT HERE. The browser works in numbers and the checkout
 * in Decimal (M-06), so this module decides WHICH figures count and each caller
 * adds them in its own arithmetic. `unitPriceNumber` is the browser's half.
 * ========================================================================== */

type Money = number | string | { toString(): string };

/** Empty means "use the product price". Zero is a real price. */
export function hasOwnPrice(price: Money | null | undefined): boolean {
  return price !== null && price !== undefined && String(price).trim() !== "";
}

/** The chosen option that sets the base price, or null for the product price. */
export function ownPriceOption<T extends { price?: Money | null }>(
  chosenInDisplayOrder: readonly T[],
): T | null {
  return chosenInDisplayOrder.find((o) => hasOwnPrice(o.price)) ?? null;
}

/** The axes (folded names) that carry at least one own price, first-seen order. */
export function axesWithOwnPrice(
  rows: readonly { name: string; price?: Money | null }[],
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (!hasOwnPrice(row.price)) continue;
    const axis = row.name.trim().toLowerCase();
    if (!out.includes(axis)) out.push(axis);
  }
  return out;
}

/** The unit price in plain numbers — the storefront's display arithmetic. */
export function unitPriceNumber(
  productPrice: number,
  chosenInDisplayOrder: readonly { price?: number | null; extraPrice: number }[],
): number {
  const own = ownPriceOption(chosenInDisplayOrder);
  const base = own ? Number(own.price) : productPrice;
  return chosenInDisplayOrder.reduce((sum, o) => sum + (o.extraPrice || 0), base);
}
