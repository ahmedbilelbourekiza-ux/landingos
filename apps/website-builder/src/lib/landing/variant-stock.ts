import { canonicalVariantLabel } from "../erp/variant-label.ts";

/* =============================================================================
 * VS.1 — the variant editor shows the Manager's stock where the merchant edits
 * variants.
 *
 * NO DIRECTIVE, for the reason `variant-label.ts` states: the editor's server
 * loader, the stock route and the bare-node suite all import this.
 *
 * WHY IT EXISTS. A merchant typed stock counts into the variant row's add-on
 * box — the only number box there besides the price — so setting an own price
 * "reset stock to 0" (it cleared the add-on, by design), and an unpublished
 * page carried "+20 DA" on both colours. The builder had no stock field at all;
 * stock lives on the Manager's variant matrix (`CatalogProduct.variants`).
 *
 * THE THREE CASES, decided on the server:
 *   - "none":     no Manager for this shop/person — nothing is shown.
 *   - "unlinked": the page has never been sent to the Manager — a note and,
 *                 when allowed, the send button. No stock column.
 *   - "linked":   the Manager's levels for this page's product. The EDITOR
 *                 then decides by the groups on screen: ONE group → a Stock
 *                 column (each option IS one catalogue row); two or more →
 *                 stock is per COMBINATION ("M / Blue"), which no single row
 *                 can hold, so a link to the Manager's variant editor instead.
 *
 * WRITES ARE MOVEMENTS. A typed level is turned into a delta against the
 * STORED level on the server and applied through `applyMovement` with reason
 * `page_editor` — the same level→delta conversion the Manager's own variant
 * editor makes (`variant_edit`, D-LP.18.1). No level is ever written as a bare
 * column, so the ledger and the FIFO basis keep adding up.
 * ========================================================================== */

export type VariantStockContext =
  | { readonly mode: "none" }
  | { readonly mode: "unlinked"; readonly canSend: boolean }
  | {
      readonly mode: "linked";
      readonly productId: string;
      /** May this person record a stock movement (erp:inventory:write)? */
      readonly canWrite: boolean;
      /** May this person re-send the page (adds options the Manager lacks)? */
      readonly canSend: boolean;
      /** Level per catalogue name, from the Manager's matrix. */
      readonly levels: Readonly<Record<string, number>>;
    };

/** The ledger reason every builder stock edit carries. */
export const STOCK_REASON = "page_editor";

/** The catalogue name a ONE-group option is stocked under ("500g"). */
export function stockKey(groupName: string, value: string): string {
  return canonicalVariantLabel([{ name: groupName, value }]);
}

/** Levels by catalogue name, read off a stored matrix. Junk rows are skipped. */
export function levelsFromMatrix(rows: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows as { name?: unknown; stock?: unknown }[]) {
    const name = typeof row?.name === "string" ? row.name : "";
    if (name) out[name] = Math.max(0, Math.trunc(Number(row.stock ?? 0)) || 0);
  }
  return out;
}

/** Distinct option-group names of flat variant rows, folded like the PUT. */
export function groupCount(rows: readonly { name: string }[]): number {
  return new Set(rows.map((r) => r.name.trim().toLowerCase()).filter(Boolean)).size;
}

/** A typed stock level: a whole number ≥ 0, or null when it is not one. */
export function readLevel(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  return Number(t);
}
