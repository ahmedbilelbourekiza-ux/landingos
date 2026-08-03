import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

/* =============================================================================
 * Stock, as a ledger with a cost basis.
 *
 * Ported from apps/erp/lib/inventory.js — planFifoConsumption, planFifoRestore
 * and applyMovement.
 *
 * WHY FIFO AT ALL. Purchase prices move. A variant restocked twice at 1,000 and
 * 2,000 does not have "a" cost — it has two, and which one a sale consumed
 * decides whether that sale made money. A single averaged costPrice column
 * cannot answer it, which is why StockLot exists and why every consuming
 * movement records exactly which lots it drew from.
 *
 * THE PART THAT IS EASY TO GET WRONG. A cancellation does not return stock to
 * "the newest lot" or "the cheapest lot" — it returns it to the SAME lots the
 * original reservation consumed, read back from MovementLotConsumption. Anything
 * else silently rewrites the cost basis every time an order is cancelled, and
 * the profit calculator quietly stops being true without a single error.
 *
 * WHAT CHANGED FROM THE ERP. Lot rows are locked with SELECT … FOR UPDATE
 * before they are planned against. The ERP planned and adjusted in two steps
 * with no lock, which is correct under SQLite's single writer and a lost update
 * on Postgres: two orders confirming the same variant at once both read
 * qtyRemaining = 5, both take 5, and the lot goes to -5 while ten units are
 * sold from a batch of five. NEXT_STEPS flagged this class explicitly.
 * ========================================================================== */

export interface Variant {
  name: string;
  stock?: number | null;
  threshold?: number | null;
  sku?: string | null;
  image?: string | null;
}

interface LotRow {
  id: bigint;
  unitCost: Prisma.Decimal;
  packagingCost: Prisma.Decimal;
  qtyRemaining: number;
}

export interface LotDraw {
  readonly lotId: bigint;
  readonly qty: number;
  readonly unitCost: Prisma.Decimal;
  readonly packagingCost: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Lock and return this variant's open lots, oldest first.
 *
 * `FOR UPDATE` is the whole point. Raw SQL because Prisma has no first-class
 * way to express it, and the alternative — planning against an unlocked read —
 * is the lost update described above. The lock is released when the surrounding
 * transaction commits, and `withTenant` has already opened one.
 *
 * No tenant predicate: row-level security applies it, and adding one here would
 * be a weaker copy of a rule that already holds.
 */
async function lockOpenLots(
  db: TenantDb,
  productId: string,
  variantName: string,
): Promise<LotRow[]> {
  return db.$queryRaw<LotRow[]>`
    SELECT id, "unitCost", "packagingCost", "qtyRemaining"
    FROM "StockLot"
    WHERE "productId" = ${productId}
      AND COALESCE("variantName", '') = ${variantName}
      AND "qtyRemaining" > 0
    ORDER BY "createdAt" ASC, id ASC
    FOR UPDATE
  `;
}

export interface ConsumptionPlan {
  readonly draws: LotDraw[];
  readonly coveredQty: number;
  readonly shortfallQty: number;
  readonly unitCost: Prisma.Decimal | null;
  readonly packagingCost: Prisma.Decimal | null;
}

/** Oldest lot first, until the quantity is covered or the lots run out. */
export async function planConsumption(
  db: TenantDb,
  productId: string,
  variantName: string,
  qty: number,
): Promise<ConsumptionPlan> {
  const lots = await lockOpenLots(db, productId, variantName);
  const draws: LotDraw[] = [];
  let remaining = qty;
  let unitTotal = ZERO;
  let packTotal = ZERO;
  let covered = 0;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyRemaining, remaining);
    if (take <= 0) continue;
    draws.push({ lotId: lot.id, qty: take, unitCost: lot.unitCost, packagingCost: lot.packagingCost });
    unitTotal = unitTotal.plus(lot.unitCost.times(take));
    packTotal = packTotal.plus(lot.packagingCost.times(take));
    covered += take;
    remaining -= take;
  }

  return {
    draws,
    coveredQty: covered,
    shortfallQty: Math.max(0, remaining),
    unitCost: covered ? unitTotal.dividedBy(covered) : null,
    packagingCost: covered ? packTotal.dividedBy(covered) : null,
  };
}

/**
 * An exact undo, not a guess.
 *
 * Reads which lots this order's reserve/confirm movements actually consumed and
 * proposes giving the quantity back to those same lots. An order predating the
 * lot feature has no consumption on record, so this correctly returns nothing —
 * the flat stock is still released by the caller, there is simply no lot-level
 * detail to restore.
 */
export async function planRestore(
  db: TenantDb,
  orderId: string,
  variantName: string,
  qty: number,
): Promise<{ draws: LotDraw[]; unitCost: Prisma.Decimal | null; packagingCost: Prisma.Decimal | null }> {
  const consumption = await db.movementLotConsumption.findMany({
    where: { movement: { orderId, variantName, reason: { in: ["reserve", "confirm"] } } },
    orderBy: { id: "asc" },
    select: { qty: true, lot: { select: { id: true, unitCost: true, packagingCost: true } } },
  });

  const draws: LotDraw[] = [];
  let remaining = qty;
  let unitTotal = ZERO;
  let packTotal = ZERO;
  let covered = 0;

  for (const row of consumption) {
    if (remaining <= 0) break;
    const give = Math.min(row.qty, remaining);
    if (give <= 0) continue;
    draws.push({
      lotId: row.lot.id, qty: give,
      unitCost: row.lot.unitCost, packagingCost: row.lot.packagingCost,
    });
    unitTotal = unitTotal.plus(row.lot.unitCost.times(give));
    packTotal = packTotal.plus(row.lot.packagingCost.times(give));
    covered += give;
    remaining -= give;
  }

  return {
    draws,
    unitCost: covered ? unitTotal.dividedBy(covered) : null,
    packagingCost: covered ? packTotal.dividedBy(covered) : null,
  };
}

/** Roll the variant array up into the flat `stock` the product grid renders. */
export function rollUp(variants: Variant[], fallback: number): number {
  if (!variants.length) return fallback;
  return variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
}

export interface MovementInput {
  readonly productId: string;
  readonly variantName?: string;
  readonly delta: number;
  readonly reason: string;
  readonly orderId?: string | null;
  readonly actorUserId: string;
}

/**
 * Move stock, and record why.
 *
 * Everything here happens on the one transaction `withTenant` opened, so a lot
 * can never end up adjusted without its matching ledger row existing, or the
 * other way round. That property is why the cost basis can be trusted at all.
 *
 * Stock is floored at zero. Negative stock is not a state the ERP has ever
 * been able to represent, and a movement that would go below zero is far more
 * often a double-submitted confirmation than a real oversell.
 */
export async function applyMovement(
  db: TenantDb,
  tenantId: string,
  input: MovementInput,
): Promise<{ prevQty: number; newQty: number } | null> {
  const variantName = input.variantName ?? "";
  const product = await db.catalogProduct.findUnique({
    where: { id: input.productId },
    select: { id: true, stock: true, variants: true, costPrice: true, packagingCost: true },
  });
  if (!product) return null;

  const variants = (Array.isArray(product.variants) ? product.variants : []) as unknown as Variant[];
  let prevQty: number;
  let newQty: number;

  if (variantName) {
    const variant = variants.find((v) => v.name === variantName);
    // Stock cannot move against a variant that does not exist. Creating one
    // implicitly would invent a product line nobody sells.
    if (!variant) return null;
    prevQty = Number(variant.stock ?? product.stock ?? 0);
    newQty = Math.max(0, prevQty + input.delta);
    variant.stock = newQty;
  } else {
    prevQty = Number(product.stock ?? 0);
    newQty = Math.max(0, prevQty + input.delta);
  }

  const moved = Math.abs(input.delta);
  let draws: LotDraw[] = [];
  let unitCost: Prisma.Decimal | null = null;
  let packagingCost: Prisma.Decimal | null = null;

  if (input.delta < 0 && (input.reason === "reserve" || input.reason === "confirm") && moved > 0) {
    const plan = await planConsumption(db, input.productId, variantName, moved);
    for (const draw of plan.draws) {
      await db.stockLot.update({
        where: { id: draw.lotId },
        data: { qtyRemaining: { decrement: draw.qty } },
      });
    }
    draws = plan.draws;
    if (plan.coveredQty || plan.shortfallQty) {
      // Blend the lot-costed part with the flat product cost for whatever the
      // lots could not cover. A real number mid-transition beats silently
      // treating the shortfall as free stock.
      const flatUnit = product.costPrice ?? ZERO;
      const flatPack = product.packagingCost ?? ZERO;
      unitCost = (plan.unitCost ?? ZERO).times(plan.coveredQty)
        .plus(flatUnit.times(plan.shortfallQty)).dividedBy(moved);
      packagingCost = (plan.packagingCost ?? ZERO).times(plan.coveredQty)
        .plus(flatPack.times(plan.shortfallQty)).dividedBy(moved);
    }
  } else if (input.delta > 0 && input.reason === "cancel" && input.orderId && moved > 0) {
    const plan = await planRestore(db, input.orderId, variantName, moved);
    for (const draw of plan.draws) {
      await db.stockLot.update({
        where: { id: draw.lotId },
        data: { qtyRemaining: { increment: draw.qty } },
      });
    }
    draws = plan.draws;
    unitCost = plan.unitCost;
    packagingCost = plan.packagingCost;
  }

  await db.catalogProduct.update({
    where: { id: input.productId },
    data: {
      variants: variants as unknown as Prisma.InputJsonValue,
      stock: rollUp(variants, newQty),
    },
  });

  const movement = await db.inventoryMovement.create({
    data: {
      tenantId,
      productId: input.productId,
      variantName,
      orderId: input.orderId ?? null,
      delta: input.delta,
      prevQty,
      newQty,
      reason: input.reason,
      actorUserId: input.actorUserId,
      unitCost,
      packagingCost,
    },
    select: { id: true },
  });

  for (const draw of draws) {
    await db.movementLotConsumption.create({
      data: { tenantId, movementId: movement.id, lotId: draw.lotId, qty: draw.qty },
    });
  }

  return { prevQty, newQty };
}

/* -----------------------------------------------------------------------------
 * Stock moving when an order is confirmed or cancelled — Phase 6.6f
 * -------------------------------------------------------------------------- */

/**
 * Match a product name the way a human typed it.
 *
 * An order stores the product NAME, not an id — it arrives from a storefront, a
 * channel webhook or a manager's keyboard, and none of those knows the
 * catalogue's primary key. So the match is on a normalised form, because a
 * trademark symbol, a non-breaking space or different casing silently breaks it
 * otherwise and the symptom is stock that never moves with no error anywhere.
 */
export function normalizeProductName(input: string | null | undefined): string {
  return String(input ?? "")
    .replace(/ /g, " ")
    .trim()
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\s+/g, " ");
}

export interface StockLine {
  readonly productId: string;
  readonly variantName: string;
  readonly qty: number;
}

/**
 * Which catalogue lines an order actually consumes.
 *
 * Returns nothing when no product matches, and says so in the log. That is the
 * ERP's own "silent-failure guard", kept verbatim in spirit: a one-character
 * mismatch means stock quietly never moves, and the only way anybody finds out
 * is by counting the shelf.
 */
export async function resolveStockLines(
  db: TenantDb,
  order: {
    id: string;
    product: string | null;
    productVariant: string | null;
    quantity: number | null;
  },
): Promise<StockLine[]> {
  const wanted = normalizeProductName(order.product);
  if (!wanted) return [];

  // The catalogue is tens to hundreds of rows for a call centre, and the match
  // is on a normalised form Postgres has no index for — so it is done here
  // rather than inventing a stored normalised column for one caller.
  const products = await db.catalogProduct.findMany({
    where: { archived: false },
    select: { id: true, name: true },
  });

  const match = products.find((p) => normalizeProductName(p.name) === wanted);
  if (!match) {
    console.warn(
      "[inventory] no catalogue product matches this order line — stock will NOT move",
      { orderId: order.id, orderProduct: order.product },
    );
    return [];
  }

  return [
    {
      productId: match.id,
      variantName: order.productVariant ?? "",
      qty: Math.max(1, Number(order.quantity) || 1),
    },
  ];
}

/**
 * Take stock for a confirmed order, honouring `reservationMode`.
 *
 * `none` moves nothing. `immediate` means the stock was taken when the order
 * arrived, so confirming is a no-op — the ERP's own reading, and it is why this
 * cannot simply always decrement.
 *
 * IT MOVES ONCE. The guard is the movement ledger itself: a `confirm` movement
 * already recorded against this order means this has run, so a second
 * confirmation — a double-submitted button, a status set twice, `PATCH` and
 * `/call` racing — cannot take the stock twice. That is the same shape as every
 * job in `jobs.ts`: idempotent by what is already written, not by a lock.
 */
export async function reserveOnConfirm(
  db: TenantDb,
  tenantId: string,
  order: {
    id: string;
    product: string | null;
    productVariant: string | null;
    quantity: number | null;
  },
  reservationMode: string,
  actorUserId: string,
): Promise<number> {
  if (reservationMode === "none" || reservationMode === "immediate") return 0;

  const already = await db.inventoryMovement.count({
    where: { orderId: order.id, reason: "confirm" },
  });
  if (already > 0) return 0;

  let moved = 0;
  for (const line of await resolveStockLines(db, order)) {
    const result = await applyMovement(db, tenantId, {
      productId: line.productId,
      variantName: line.variantName,
      delta: -line.qty,
      reason: "confirm",
      orderId: order.id,
      actorUserId,
    });
    if (result) moved += 1;
  }
  return moved;
}

/**
 * Give it back when a confirmation is cancelled.
 *
 * `applyMovement`'s `cancel` path returns stock to **the same lots the
 * reservation consumed**, read back from `MovementLotConsumption` — not to the
 * newest lot and not to the cheapest. Anything else silently rewrites the cost
 * basis on every cancellation and the profit calculator stops being true without
 * a single error.
 *
 * Guarded both ways: nothing to restore unless a `confirm` movement exists, and
 * not twice if a `cancel` already does.
 */
export async function releaseOnCancel(
  db: TenantDb,
  tenantId: string,
  order: {
    id: string;
    product: string | null;
    productVariant: string | null;
    quantity: number | null;
  },
  actorUserId: string,
): Promise<number> {
  const [taken, given] = await Promise.all([
    db.inventoryMovement.count({ where: { orderId: order.id, reason: "confirm" } }),
    db.inventoryMovement.count({ where: { orderId: order.id, reason: "cancel" } }),
  ]);
  if (taken === 0 || given > 0) return 0;

  let moved = 0;
  for (const line of await resolveStockLines(db, order)) {
    const result = await applyMovement(db, tenantId, {
      productId: line.productId,
      variantName: line.variantName,
      delta: line.qty,
      reason: "cancel",
      orderId: order.id,
      actorUserId,
    });
    if (result) moved += 1;
  }
  return moved;
}

/** The inventory view for one product: per-variant stock and thresholds. */
export function inventoryView(product: {
  stock: number | null;
  threshold: number | null;
  variants: Prisma.JsonValue;
}) {
  const variants = (Array.isArray(product.variants) ? product.variants : []) as unknown as Variant[];
  return {
    stock: product.stock ?? 0,
    threshold: product.threshold ?? 0,
    variants: variants.map((v) => ({
      name: v.name,
      stock: Number(v.stock ?? 0),
      threshold: Number(v.threshold ?? product.threshold ?? 0),
      sku: v.sku ?? null,
    })),
  };
}
