import { VARIANT_LABEL_SEPARATOR, canonicalVariantLabel, type ChosenOption } from "./variant-label.ts";

/* =============================================================================
 * VAR.1 — the shared option vocabulary: the builder owns the AXES, the ERP
 * owns the generated MATRIX.
 *
 * NO DIRECTIVE, for the reason `variant-label.ts` states: the ERP's matrix
 * editor generates in the browser, the send path generates on the server, and
 * the suite exercises both in bare node. A module all three import can carry
 * neither `server-only` nor `"use client"`.
 *
 * -----------------------------------------------------------------------------
 * THE TWO MODELS, AND WHY NEITHER IS WRONG
 *
 * `LandingVariant` is flat rows of `(name, value, extraPrice, displayOrder)` —
 * "Size: M" is one row, "Colour: Blue" is another. Three colours and five
 * sizes are EIGHT rows. It describes what a customer PICKS.
 *
 * `CatalogProduct.variants` is an array of concrete SKUs, each with its own
 * stock, threshold, SKU code and photograph. The same product is FIFTEEN
 * entries. It describes what sits on a SHELF.
 *
 * Neither is a worse version of the other, which is why this slice does not
 * make one into the other. The builder keeps describing choices; the ERP keeps
 * describing inventory; and the cross product between them is generated once,
 * here, from a vocabulary they now share.
 *
 * THE MIGRATION THIS SLICE DOES NOT NEED, and the measurement behind that:
 * the builder ALREADY stores the axes. `LandingVariant` rows carry the axis in
 * `name`, the value in `value`, and definition order in `displayOrder` — which
 * the variants PUT assigns from array position, group by group. So the axis
 * list is a GROUPING of rows that already exist, not a column that has to be
 * added. `optionDefs` stays the ERP's own storage of the same vocabulary,
 * written when a matrix is generated.
 *
 * ORDER IS THE LOAD-BEARING PART. A variant's catalogue name is its values
 * joined in DEFINITION order, and `variant-matrix.tsx` says why: a catalogue
 * that grows both "M / Blue" and "Blue / M" holds separate stock for one real
 * thing, and nothing downstream can repair that. So the axis order here comes
 * from `displayOrder`, the value order within an axis comes from
 * `displayOrder`, and `matrixName` is the ONE place the join happens — shared
 * with `canonicalVariantLabel`, which builds the same string from the other
 * end (a customer's selection at checkout). The two must agree exactly or
 * stock moves against a variant nobody sold.
 * ========================================================================== */

/** One axis of choice: "Size", with its values in definition order. */
export interface OptionAxis {
  readonly name: string;
  readonly values: readonly string[];
}

/** A builder variant row, as much of it as the axes care about. */
export interface LandingVariantRow {
  readonly name: string;
  readonly value: string;
  readonly displayOrder?: number | null;
}

/** One generated combination: the catalogue name plus which values it is. */
export interface VariantCombination {
  readonly name: string;
  readonly options: Readonly<Record<string, string>>;
}

/** Blank axis names and values describe nothing and are dropped everywhere. */
const usableAxes = (axes: readonly OptionAxis[]): OptionAxis[] =>
  axes
    .map((axis) => ({ name: axis.name.trim(), values: axis.values.filter((v) => v && v.trim()) }))
    .filter((axis) => axis.name && axis.values.length);

/**
 * The catalogue name for one combination — "M / Blue".
 *
 * The ONE join, shared with `canonicalVariantLabel`. A combination generated
 * here and a selection made at checkout have to produce the identical string,
 * because `applyMovement` finds a variant BY NAME and a mismatch moves no
 * stock while looking like it worked (INV.1's silent failure, one layer up).
 */
export function matrixName(
  axes: readonly OptionAxis[],
  options: Readonly<Record<string, string>>,
): string {
  return usableAxes(axes)
    .map((axis) => options[axis.name])
    .filter((value) => value && value.trim())
    .join(VARIANT_LABEL_SEPARATOR);
}

/**
 * The axes a landing page sells, from its flat variant rows.
 *
 * Grouped by axis name, first appearance wins the ordering, and both the axes
 * and the values inside them follow `displayOrder` — the merchant's own order
 * in the editor. Case-insensitive on the axis key so "Colour" and "colour"
 * are one axis rather than two that generate a nonsense cross product; the
 * FIRST spelling is the one kept, because that is the one the merchant typed
 * when they created the group.
 */
export function axesFromLandingVariants(rows: readonly LandingVariantRow[]): OptionAxis[] {
  const ordered = [...rows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ao = a.row.displayOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.row.displayOrder ?? Number.POSITIVE_INFINITY;
      return ao !== bo ? ao - bo : a.index - b.index;
    })
    .map((entry) => entry.row);

  const byKey = new Map<string, { name: string; values: string[] }>();
  for (const row of ordered) {
    const name = String(row.name ?? "").trim();
    const value = String(row.value ?? "").trim();
    if (!name || !value) continue;
    const key = name.toLowerCase();
    const axis = byKey.get(key) ?? { name, values: [] };
    // A value repeated on one axis is one choice, not two. The variants PUT
    // already refuses an exact duplicate; this also folds a case variant.
    if (!axis.values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      axis.values.push(value);
    }
    byKey.set(key, axis);
  }
  return [...byKey.values()];
}

/**
 * Every purchasable combination of the axes — the matrix.
 *
 * The cross product in axis order, so "M / Blue" is generated and "Blue / M"
 * is not. Returns names and option maps only: stock, threshold, SKU and the
 * photograph belong to whatever already holds them, and this function must
 * never be the thing that decides a level. Callers merge onto existing rows —
 * a generator that replaced them would silently zero every level it
 * regenerated, which is a stock loss with no movement row behind it and
 * exactly what D-LP.18.1 forbids.
 */
export function matrixFromAxes(axes: readonly OptionAxis[]): VariantCombination[] {
  const usable = usableAxes(axes);
  if (!usable.length) return [];

  let combos: Record<string, string>[] = [{}];
  for (const axis of usable) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of axis.values) next.push({ ...combo, [axis.name]: value });
    }
    combos = next;
  }

  return combos.map((options) => ({ name: matrixName(usable, options), options }));
}

/**
 * The matrix a landing page implies, in one step.
 *
 * What the send path (VAR.2) will generate from, and the reason this module
 * exists rather than two half-implementations either side of the boundary.
 */
export function matrixFromLandingVariants(
  rows: readonly LandingVariantRow[],
): VariantCombination[] {
  return matrixFromAxes(axesFromLandingVariants(rows));
}

/* -----------------------------------------------------------------------------
 * VAR.2 (addition A) — which choices the warehouse can actually honour
 * -------------------------------------------------------------------------- */

/** Levels by catalogue name, as the storefront receives them. */
export type StockByVariant = Readonly<Record<string, number>>;

/**
 * Could a customer still buy this option, given what they have already chosen?
 *
 * THE QUESTION IS PER COMBINATION, NOT PER VALUE, which is the whole difficulty
 * of greying out a matrix: "Blue" is not out of stock, "M / Blue" is. So this
 * builds the combination the customer WOULD have if they clicked this option —
 * their current choices on every other axis, this value on this one — and asks
 * whether that specific row has anything left.
 *
 * An axis they have not touched yet falls back to its first value, which is
 * what the purchase form itself submits for an untouched axis. That keeps the
 * greying consistent with what would actually be ordered.
 *
 * UNKNOWN IS AVAILABLE, deliberately, and it is the safe direction here: a
 * combination missing from the map means the catalogue has no row by that name
 * — a page whose axes have changed since it was last sent, or one never sent at
 * all — and refusing to sell it would take a working product off sale over a
 * bookkeeping gap. The checkout still refuses a combination it can see is
 * empty, so the guarantee lives where it can be trusted rather than here.
 */
export function isCombinationAvailable(
  axes: readonly OptionAxis[],
  selected: Readonly<Record<string, string>>,
  stock: StockByVariant | null,
  axisName: string,
  value: string,
): boolean {
  if (!stock) return true; // enforcement off — nothing to say
  const usable = usableAxes(axes);
  if (!usable.length) return true;

  const options: Record<string, string> = {};
  for (const axis of usable) {
    options[axis.name] =
      axis.name === axisName ? value : selected[axis.name] ?? axis.values[0] ?? "";
  }

  const name = matrixName(usable, options);
  if (!name) return true;
  const level = stock[name];
  return level === undefined ? true : level > 0;
}

/** The level for a fully chosen combination, or null when it is not known. */
export function stockForSelection(
  axes: readonly OptionAxis[],
  selected: Readonly<Record<string, string>>,
  stock: StockByVariant | null,
): number | null {
  if (!stock) return null;
  const usable = usableAxes(axes);
  if (!usable.length) return null;
  const options: Record<string, string> = {};
  for (const axis of usable) options[axis.name] = selected[axis.name] ?? axis.values[0] ?? "";
  const level = stock[matrixName(usable, options)];
  return level === undefined ? null : level;
}

/** What a re-send did to a product's matrix, so the screen can say so. */
export interface MatrixOutcome {
  readonly added: number;
  readonly removed: number;
  /** Combinations the axes no longer describe but which still hold stock. */
  readonly keptHoldingStock: readonly string[];
}

/* -----------------------------------------------------------------------------
 * VAR.2 — the matrix, reconciled
 * -------------------------------------------------------------------------- */

export interface StoredVariant {
  name?: string;
  sku?: string | null;
  image?: string | null;
  stock?: number | null;
  threshold?: number | null;
  options?: Record<string, string> | null;
}

/**
 * Merge the matrix a page now implies onto the one the catalogue already holds.
 *
 * THE RULE, and it is the whole of this function: **a combination that still
 * holds stock is never removed.** D-LP.18.2 refuses exactly this on the
 * variant editor — "the ERP silently dropped it, and the stock went with it:
 * no movement row, no reason, and a cost basis that no longer adds up" — and a
 * re-send is a far easier way to trigger it than the editor, because the
 * merchant is thinking about the landing page and not about the warehouse.
 * Renaming a colour in the builder must not be able to delete stock.
 *
 * So: combinations the axes still describe are KEPT, exactly as stored, with
 * their levels, SKUs and photographs. New ones are appended at ZERO — a new
 * variant receives its opening stock as a movement like everything else
 * (INV.3), never as a number this function invents. Combinations the axes no
 * longer describe are dropped only when empty, and reported when not.
 */
export function reconcileMatrix(
  stored: readonly StoredVariant[],
  wanted: readonly { name: string; options: Readonly<Record<string, string>> }[],
): { next: StoredVariant[]; outcome: MatrixOutcome } {
  const byName = new Map(stored.map((v) => [String(v.name ?? ""), v]));
  const wantedNames = new Set(wanted.map((w) => w.name));

  const next: StoredVariant[] = wanted.map((w) => {
    const existing = byName.get(w.name);
    if (existing) {
      // Kept whole. Only the option map is refreshed, because that is the one
      // part the axes are authoritative for.
      return { ...existing, options: w.options };
    }
    return { name: w.name, sku: "", image: "", stock: 0, threshold: 0, options: w.options };
  });

  const keptHoldingStock: string[] = [];
  let removed = 0;
  for (const v of stored) {
    const name = String(v.name ?? "");
    if (wantedNames.has(name)) continue;
    if (Number(v.stock ?? 0) !== 0) {
      // Survives, at the end, so nothing is lost and the merchant is told.
      next.push(v);
      keptHoldingStock.push(name);
    } else {
      removed += 1;
    }
  }

  const added = next.filter((v) => !byName.has(String(v.name ?? ""))).length;
  return { next, outcome: { added, removed, keptHoldingStock } };
}


export interface VariantLevels {
  /** Level per catalogue name — "M / Blue" → 3. Empty when nothing is linked. */
  readonly stock: Record<string, number>;
  /** True when STOCK is gated, i.e. the toggle is on AND a product is linked. */
  readonly enforced: boolean;
  /* VAR.1 (fuller scope) — every combination the Manager's matrix holds, which
   * is what the shop may offer at all. Undefined when no product is linked:
   * "no matrix to consult" and "an empty matrix" are different answers, and
   * only the second should stop a page selling. */
  readonly combinations?: ReadonlySet<string>;
  /** The axes the matrix describes, when one is linked. */
  readonly axes?: readonly OptionAxis[];
}

/**
 * May this order be taken? `null` when yes; the refused name when no.
 *
 * UNKNOWN IS ALLOWED, and only here does that need defending. A combination
 * missing from the map means the catalogue has no row by that name — a page
 * whose axes changed since it was last sent, most often — and refusing it
 * would take a working product off sale over a bookkeeping gap the customer
 * cannot see or fix. Refusing what is KNOWN to be empty is the whole promise;
 * inventing a refusal for what is merely unrecorded is not.
 */
export function refuseIfOutOfStock(
  levels: VariantLevels,
  chosen: readonly ChosenOption[],
): string | null {
  const name = canonicalVariantLabel(chosen);
  if (!name) return null; // a page with no options has no combination to gate

  /* VAR.1 (fuller scope) — TWO refusals now, and they are not the same rule.
   *
   * A combination the Manager's matrix no longer holds is refused
   * UNCONDITIONALLY: a manager deleted it, which is a statement that the
   * company stopped making it, and no toggle should let a storefront keep
   * selling it. A combination that exists but is EMPTY is refused only when
   * the merchant turned enforcement on — VAR.2's toggle, whose reasoning
   * (test a product before its stock is entered) is unchanged.
   *
   * `offerableCombination` holds both rules so the storefront's greying and
   * this refusal cannot drift apart. */
  return offerableCombination(levels, name) ? null : name;
}

/* -----------------------------------------------------------------------------
 * VAR.1 (fuller scope) — the ERP as the ONGOING source of truth
 *
 * The first cut of this slice moved variants one way: the builder's axes
 * generated the ERP matrix at send, and a re-send reconciled it. That left the
 * ERP downstream, so a manager adding "XL / Blue" in the Manager — or deleting
 * a combination the company stopped making — changed nothing a customer could
 * see. The product owner's decision reverses the authority: once a page is
 * LINKED, the matrix in the Manager is what the shop sells.
 *
 * IT IS DERIVED ON READ, NOT SYNCED. The storefront already reads the linked
 * product for stock levels, so widening that read from "what is the level" to
 * "which combinations exist" makes propagation immediate and unconditional —
 * no job to run, no window in which the two disagree, nothing to reconcile
 * after a failure. A write-back into `LandingVariant` would be two writers on
 * one dataset with no conflict rule, and would have to invent an `extraPrice`
 * for every combination the ERP created.
 *
 * WHAT STAYS THE BUILDER'S, because the ERP has nowhere to put it:
 *   - `extraPrice`, a storefront pricing rule keyed to an axis VALUE;
 *   - the axis labels and their order, which is how the page reads.
 * So the shop offers what the WAREHOUSE has, priced the way the PAGE says.
 * -------------------------------------------------------------------------- */

/** One row of `CatalogProduct.variants`, as much as the offer cares about. */
export interface MatrixRow {
  name?: string;
  stock?: number | null;
  options?: Record<string, string> | null;
}

/**
 * The axes the ERP's matrix actually describes.
 *
 * Built from each row's `options` map — the authoritative statement of "this
 * combination is this value on this axis". `optionDefs` decides the AXIS ORDER
 * when the product carries it, since that is the vocabulary the matrix was
 * generated from; first-appearance order is the fallback for a matrix typed by
 * hand before `optionDefs` existed.
 *
 * A row with no `options` contributes nothing. Its name is a label, not a
 * decomposition, and splitting it on the separator would invent an axis called
 * "Size" for a variant somebody named "Blue / Large gift box".
 */
export function axesFromMatrix(
  rows: readonly MatrixRow[],
  optionDefs?: readonly { name?: string }[] | null,
): OptionAxis[] {
  const order = (optionDefs ?? []).map((d) => String(d?.name ?? "").trim()).filter(Boolean);

  const byKey = new Map<string, { name: string; values: string[] }>();
  const remember = (axisName: string, value: string) => {
    const name = axisName.trim();
    const v = value.trim();
    if (!name || !v) return;
    const key = name.toLowerCase();
    const axis = byKey.get(key) ?? { name, values: [] };
    if (!axis.values.some((x) => x.toLowerCase() === v.toLowerCase())) axis.values.push(v);
    byKey.set(key, axis);
  };

  for (const row of rows) {
    const options = row.options && typeof row.options === "object" ? row.options : null;
    if (!options) continue;
    for (const axisName of order) {
      if (options[axisName] !== undefined) remember(axisName, options[axisName]);
    }
    for (const [axisName, value] of Object.entries(options)) {
      if (!order.includes(axisName)) remember(axisName, value);
    }
  }

  if (!order.length) return [...byKey.values()];
  const named = order
    .map((n) => byKey.get(n.toLowerCase()))
    .filter((a): a is { name: string; values: string[] } => Boolean(a));
  const rest = [...byKey.values()].filter((a) => !named.includes(a));
  return [...named, ...rest];
}

/** Every combination NAME the ERP matrix currently holds. */
export function combinationsFromMatrix(rows: readonly MatrixRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const name = String(row.name ?? "").trim();
    if (name) out.add(name);
  }
  return out;
}

/**
 * Is this combination one the shop can still sell?
 *
 * TWO SEPARATE QUESTIONS, answering to different rules:
 *
 *   1. DOES IT EXIST in the Manager's matrix? A combination the manager
 *      deleted is not sold — always, whatever the enforcement toggle says.
 *      Deleting a variant is an editorial act ("we stopped making this"),
 *      unlike a level reaching zero, which is a transient fact about today.
 *
 *   2. DOES IT HAVE STOCK? Asked only when the merchant turned enforcement on
 *      (VAR.2's toggle), whose reasoning is unchanged: a new product is
 *      routinely tested before its stock is entered.
 *
 * A page with no linked product answers `true` to both — there is no matrix to
 * consult, which is how every page behaves today.
 */
export function offerableCombination(levels: VariantLevels, name: string): boolean {
  if (!name) return true;
  if (levels.combinations && levels.combinations.size > 0 && !levels.combinations.has(name)) {
    return false;
  }
  if (!levels.enforced) return true;
  const level = levels.stock[name];
  return level === undefined ? true : level > 0;
}

/**
 * VAR.1 (fuller scope) — the axes the STOREFRONT should render.
 *
 * The Manager's matrix decides WHICH values exist; the page decides what each
 * one is called, in what order, and what it adds to the price. So this keeps
 * the page's axis order and spelling wherever the two agree, and takes the
 * Manager's word on membership:
 *
 *   - a value the manager ADDED appears, at the end of its axis, because the
 *     page has no opinion about where a value it never knew about belongs;
 *   - a value whose every combination the manager DELETED disappears;
 *   - an axis the page never had appears after the ones it did.
 *
 * With no matrix (an unlinked page) the page's own axes are returned
 * unchanged, which is every page that has never been sent to the Manager.
 */
export function offeredAxes(
  pageAxes: readonly OptionAxis[],
  levels: VariantLevels | null,
): OptionAxis[] {
  const erpAxes = levels?.axes;
  if (!erpAxes || !erpAxes.length) return [...pageAxes];

  const fold = (v: string) => v.trim().toLowerCase();
  const erpByKey = new Map(erpAxes.map((a) => [fold(a.name), a]));

  const out: OptionAxis[] = [];
  for (const axis of pageAxes) {
    const erp = erpByKey.get(fold(axis.name));
    if (!erp) continue; // the manager's matrix does not use this axis at all
    const erpValues = new Set(erp.values.map(fold));
    // The page's spelling and order, filtered to what the warehouse has...
    const kept = axis.values.filter((v) => erpValues.has(fold(v)));
    // ...then anything the manager added that the page has never heard of.
    const known = new Set(kept.map(fold));
    const added = erp.values.filter((v) => !known.has(fold(v)));
    const values = [...kept, ...added];
    if (values.length) out.push({ name: axis.name, values });
  }

  // Axes the manager introduced that the page has no wording for at all.
  const seen = new Set(out.map((a) => fold(a.name)));
  for (const erp of erpAxes) {
    if (!seen.has(fold(erp.name))) out.push(erp);
  }
  return out;
}
