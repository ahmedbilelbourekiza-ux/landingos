/* =============================================================================
 * INV.2 — the ONE name a chosen variant combination goes by.
 *
 * NO DIRECTIVE, DELIBERATELY — neither `server-only` nor `"use client"`. The
 * checkout writes this name on the server, the ERP's variant matrix generates
 * the same name in the browser, and the suite exercises it in bare node. A
 * value exported from a `"use client"` module is a client reference on the
 * server, and a `server-only` module cannot be imported into the browser
 * bundle, so anything all three need lives in a module carrying neither. Same
 * rule as `stock-level.ts`, `edit-field.ts` and `calc.ts`.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * `FulfillmentOrder.productVariant` is a STRING, and `applyMovement` finds a
 * variant BY NAME. So the storefront and the catalogue have to agree, exactly,
 * on what a combination is called — and until INV.2 they did not agree because
 * the storefront never wrote the column at all. Every storefront sale reached
 * the ERP naming no variant, which is what made INV.1's silent corruption
 * reachable on the main path rather than in some corner.
 *
 * THE FORMAT IS NOT A NEW INVENTION. It is the one the ERP's matrix generator
 * already produces (`variant-matrix.tsx`): the option VALUES, joined by " / ",
 * in the order the options are defined. That file states the reason and it is
 * the reason this module is careful about order — a catalogue that grows both
 * "M / Blue" and "Blue / M" has two rows holding separate stock for one real
 * thing, and no amount of later matching repairs it.
 *
 * ORDER IS THEREFORE LOAD-BEARING, and it was not being maintained. The
 * checkout read a page's variants with no `orderBy`, so which axis came first
 * in the snapshot was whatever Postgres happened to return. `displayOrder` is
 * the builder's own definition order — the variants PUT assigns it from array
 * position, group by group — so sorting by it here reproduces exactly what the
 * merchant sees in the editor, and what the matrix will be generated from.
 *
 * ONE VALUE PER AXIS. The matrix is a cross product: a row IS one value from
 * each axis. If a selection somehow carries two values for one axis the first
 * in definition order wins, because a name with two sizes in it matches no
 * catalogue row and silently moves no stock — the failure this whole slice
 * exists to end. It is not reachable from the storefront picker today; it is
 * handled because being wrong here is expensive and being defensive is free.
 * ========================================================================== */

/** What the ERP's matrix generator joins option values with. */
export const VARIANT_LABEL_SEPARATOR = " / ";

export interface ChosenOption {
  /** The axis — "Size", "Colour". */
  readonly name: string;
  /** The value on that axis — "M", "Blue". */
  readonly value: string;
  /** The builder's definition order. Absent on already-stored snapshots. */
  readonly displayOrder?: number | null;
}

/**
 * The catalogue name for a chosen combination — "M / Blue", or "" for none.
 *
 * The empty string is meaningful and is the right answer for a product with no
 * variants: it is what `resolveStockLines` already passes for a product-level
 * movement, and after INV.1 that is only a coherent request when the catalogue
 * row genuinely has no variants.
 */
export function canonicalVariantLabel(chosen: readonly ChosenOption[]): string {
  if (!Array.isArray(chosen) || chosen.length === 0) return "";

  /* Stable by definition order. `displayOrder` is absent on rows read back out
     of an old snapshot, and a missing value must not reorder the ones that do
     have it — so absent sorts as "stay where you are" via the index tiebreak
     rather than as 0, which would hoist it to the front. */
  const ordered = chosen
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const ao = a.option.displayOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.option.displayOrder ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map((entry) => entry.option);

  const seenAxes = new Set<string>();
  const values: string[] = [];
  for (const option of ordered) {
    const axis = String(option.name ?? "").trim();
    const value = String(option.value ?? "").trim();
    // A blank value names nothing; including it would produce " / Blue".
    if (!value) continue;
    // One value per axis — see the header.
    const key = axis.toLowerCase();
    if (axis && seenAxes.has(key)) continue;
    if (axis) seenAxes.add(key);
    values.push(value);
  }

  return values.join(VARIANT_LABEL_SEPARATOR);
}

/**
 * The same name, from a stored `variants` Json snapshot.
 *
 * `SalesOrder.variants` and `DraftOrder.variants` hold `[{name, value}]` and
 * carry no `displayOrder`, so a snapshot's own array order is all there is —
 * which is exactly why the checkout must store it ordered (it now does). Kept
 * separate from the function above so the unsafe cast lives in one place.
 */
export function variantLabelFromSnapshot(snapshot: unknown): string {
  if (!Array.isArray(snapshot)) return "";
  return canonicalVariantLabel(
    snapshot.filter((row): row is ChosenOption => Boolean(row) && typeof row === "object"),
  );
}
