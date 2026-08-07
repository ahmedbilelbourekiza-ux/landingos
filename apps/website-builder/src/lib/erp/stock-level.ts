/* =============================================================================
 * How bad is this stock level — PM.5.
 *
 * NO DIRECTIVE, DELIBERATELY. The products screen, the inventory screen, the
 * order detail and the dashboard are server components; the variant editor is a
 * client one; and all five have to answer the same question about the same
 * number. A value exported from a `"use client"` module is a client reference on
 * the server, and a `server-only` module cannot be imported into the browser
 * bundle — so anything both sides need lives in a module carrying neither. Same
 * rule as `edit-field.ts`, `notify-vocab.ts` and `styles.ts`.
 *
 * -----------------------------------------------------------------------------
 * WHY THREE STATES AND NOT THE LEGACY'S ONE
 *
 * The legacy asks `stock <= threshold` and paints the number red. That is one
 * bit for two situations a warehouse treats completely differently: a variant at
 * 18 against a threshold of 24 is a restock to schedule, and a variant at 0 is
 * an order the call centre is about to confirm and cannot ship. Both were the
 * same red, so the second was invisible inside a list of the first — which is
 * how "low stock" becomes a warning people stop reading.
 *
 *   out       nothing left. Confirming an order for it promises a delivery the
 *             warehouse cannot make.
 *   critical  at or under HALF the threshold — the restock is late, not due.
 *   low       at or under the threshold — the restock is due.
 *   ok        nothing to say.
 *
 * A threshold of zero means the tenant has not set one, so only `out` can be
 * judged. Inventing a default here would put every product with no threshold
 * onto a warning list nobody asked for.
 * ========================================================================== */

export const STOCK_SEVERITIES = ["out", "critical", "low", "ok"] as const;
export type StockSeverity = (typeof STOCK_SEVERITIES)[number];

/** The status-vocabulary tone each level renders in. */
export const STOCK_TONE: Record<StockSeverity, "danger" | "warning" | "success" | "neutral"> = {
  out: "danger",
  critical: "danger",
  low: "warning",
  ok: "success",
};

export function stockLevel(stock: number, threshold: number): StockSeverity {
  const level = Number(stock) || 0;
  const limit = Number(threshold) || 0;
  if (level <= 0) return "out";
  if (limit <= 0) return "ok";
  // `× 2 <=` rather than `<= limit / 2`, so a threshold of 25 puts 12 in
  // critical and 13 in low without a floating-point comparison deciding it.
  if (level * 2 <= limit) return "critical";
  if (level <= limit) return "low";
  return "ok";
}

/** True where the level is worth marking at all. */
export function isStockAlert(severity: StockSeverity): boolean {
  return severity !== "ok";
}
