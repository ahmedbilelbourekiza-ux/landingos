import "server-only";

import { Prisma } from "@landingos/db";

import { toDecimal } from "./serialize";

/* =============================================================================
 * Editing a catalogue product.
 *
 * Ported from `saveProduct` in apps/erp/lib/db.js. The legacy route was
 * `PUT /api/products/:id` and it merged the request body onto the stored row,
 * so a console that read the product, changed one box and sent the object back
 * rewrote every column. This is a PATCH of named fields for the same reason
 * `PATCH /api/erp/orders/[id]` is: a whole-resource write is how a masked
 * secret gets written back over a real one, and the catalogue is one round-trip
 * away from the same shape.
 *
 * WHY THIS EXISTS AT ALL. Until now a product could be created and archived and
 * never corrected. `costPrice` and `packagingCost` are the cost basis for every
 * FIFO lot, for delivered-order pay, for `/sales-summary` and for every saved
 * P&L record — so a typo at creation was permanent and quietly made every
 * profit figure derived from it wrong rather than absent. Archive-and-recreate
 * was the only workaround, and it orphans the movement ledger.
 *
 * TWO FIELDS THE LEGACY ACCEPTED AND THIS DELIBERATELY REFUSES — D-LP.1:
 *
 *   `stock` and `variants[].stock`. The ERP's PUT recomputed the flat stock
 *   column from whatever the caller sent. On the platform stock is owned by the
 *   movement ledger: `applyMovement` writes the level and its reason in one
 *   transaction, and that pairing is the only reason the cost basis can be
 *   trusted. An edit that set a level directly would move stock with no
 *   movement row behind it — the exact invariant `lib/erp/inventory.ts` exists
 *   to hold. Levels change through `/inventory/adjust` and `/stock-lots`.
 *
 *   `variants`. Adding or removing a variant has to reach the ledger too (the
 *   ERP's own variant editor went through `inventory.setVariantStock`), so it
 *   is its own surface rather than a field on this one. Until it exists, this
 *   route leaves the stored array alone rather than accepting a shape it cannot
 *   honour — see LEGACY_PARITY.md R12.
 * ========================================================================== */

/** Plain text. The limits mirror `CreateProduct`, so the two cannot disagree. */
const TEXT_FIELDS: ReadonlyArray<readonly [string, number]> = [
  ["name", 300],
  ["sku", 80],
  ["description", 5000],
  ["brand", 120],
  ["image", 2000],
];

const MONEY_FIELDS = ["price", "costPrice", "packagingCost"] as const;

export interface ProductPatch {
  readonly data: Prisma.CatalogProductUpdateInput;
  readonly invalid: string | null;
}

/**
 * Turn a request body into the columns to write.
 *
 * A field that is absent is left alone; a field that is present and unusable is
 * a refusal for the WHOLE batch, never a silently dropped one. Half-applying a
 * rejected edit is worse than refusing it — the caller is told it failed and
 * half of it happened anyway, which is the same rule `validateSettings` holds.
 */
export function buildProductPatch(body: unknown): ProductPatch {
  const input = (body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  for (const [field, max] of TEXT_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string" && typeof value !== "number") {
      return { data: {}, invalid: `"${field}" must be text` };
    }
    const text = value === null ? "" : String(value).trim();
    if (text.length > max) {
      return { data: {}, invalid: `"${field}" must be at most ${max} characters` };
    }
    // The one field with a floor. A nameless product is unfindable in every
    // list, every dropdown and every order line that quotes it back.
    if (field === "name" && !text) {
      return { data: {}, invalid: '"name" cannot be empty' };
    }
    data[field] = text;
  }

  for (const field of MONEY_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    const decimal = toDecimal(value);
    if (decimal === null) {
      return { data: {}, invalid: `"${field}" must be a number` };
    }
    if (decimal.isNegative()) {
      return { data: {}, invalid: `"${field}" cannot be negative` };
    }
    data[field] = decimal;
  }

  if (input.threshold !== undefined) {
    const n = Number(input.threshold);
    if (typeof input.threshold === "boolean" || !Number.isFinite(n) || n < 0) {
      return { data: {}, invalid: '"threshold" must be a number of zero or more' };
    }
    data.threshold = Math.trunc(n);
  }

  // Named rather than ignored. A caller sending `stock` believes they are
  // setting a level; answering 200 and doing nothing is the failure this whole
  // module is here to stop happening to `costPrice`.
  if (input.stock !== undefined) {
    return {
      data: {},
      invalid: 'stock is moved through /inventory/adjust, not by editing the product',
    };
  }
  if (input.variants !== undefined) {
    return {
      data: {},
      invalid: 'variants are not editable here yet — use /inventory/adjust for levels',
    };
  }

  return { data: data as Prisma.CatalogProductUpdateInput, invalid: null };
}

/* -----------------------------------------------------------------------------
 * The permanent timeline
 * -------------------------------------------------------------------------- */

/** The fields whose change is worth a row, and what that row is called. */
const TRACKED: ReadonlyArray<readonly [string, string]> = [
  ["price", "price_change"],
  ["costPrice", "cost_change"],
  ["packagingCost", "packaging_cost_change"],
  ["brand", "brand_changed"],
];

/** What the timeline needs to know about the row before the write. */
export interface ProductBefore {
  readonly price: Prisma.Decimal | null;
  readonly costPrice: Prisma.Decimal | null;
  readonly packagingCost: Prisma.Decimal | null;
  readonly brand: string | null;
}

export interface ChangeEvent {
  readonly eventType: string;
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/**
 * One event per field that actually changed.
 *
 * The ERP's comment on its own version is the reason this is not a diff
 * computed later: "log exactly what changed, one event per changed field, so
 * nothing is inferred or guessed later from a diff — the record of what changed
 * and when is written at the moment it happens."
 *
 * Money is compared through the Decimal, not through a JS number. `2000` and
 * `2000.00` are the same price and must not produce an event; `0.1 + 0.2` is
 * why comparing the float form would eventually produce one that is not real.
 *
 * `supplier_changed` is in the ERP's set and absent here because
 * `CatalogProduct` has no `supplier` column yet — it goes in with the column
 * (LEGACY_PARITY.md R12), not before it.
 */
export function productChangeEvents(
  before: ProductBefore,
  patch: Prisma.CatalogProductUpdateInput,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const written = patch as Record<string, unknown>;

  for (const [field, eventType] of TRACKED) {
    if (written[field] === undefined) continue;

    const oldRaw = (before as unknown as Record<string, unknown>)[field];
    const newRaw = written[field];

    const isMoney = Prisma.Decimal.isDecimal(newRaw) || Prisma.Decimal.isDecimal(oldRaw);
    const same = isMoney
      ? decimalsEqual(oldRaw, newRaw)
      : String(oldRaw ?? "") === String(newRaw ?? "");
    if (same) continue;

    events.push({
      eventType,
      field,
      oldValue: oldRaw === null || oldRaw === undefined ? null : String(oldRaw),
      newValue: newRaw === null || newRaw === undefined ? null : String(newRaw),
    });
  }

  return events;
}

function decimalsEqual(a: unknown, b: unknown): boolean {
  const left = Prisma.Decimal.isDecimal(a) ? a : toDecimal(a);
  const right = Prisma.Decimal.isDecimal(b) ? b : toDecimal(b);
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return left.equals(right);
}
