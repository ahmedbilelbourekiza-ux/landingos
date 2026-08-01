/* =============================================================================
 * lib/inventory.js — Per-variant stock management (req §8, §9, §10).
 *
 * Every product variant carries its own stock and threshold, e.g.
 *   Black / 42 → stock 15, threshold 5
 *   Brown / 43 → stock 48, threshold 12
 *
 * Lifecycle hooks driven by the configurable reservationMode setting:
 *   - 'immediate' : reserve stock when an order is created (pending)
 *   - 'on_confirm' : decrement stock when an order becomes Confirmed, and
 *                    restore it if the confirmation is later cancelled
 *   - 'none'      : no automatic stock movement
 *
 * IMMUTABILITY GUARANTEE: no function here ever UPDATEs or DELETEs a row in
 * inventory_movements. Every change is a new ledger row with prev/new qty,
 * appended in the SAME transaction that mutates products.variants — so the
 * history can never diverge from the current stock and can never be lost.
 * ========================================================================== */

const db = require('./db');

/** Read the current variant object (or null) for a product + variant name. */
function getVariant(productId, variantName) {
  const p = db.getProduct(productId);
  if (!p) return null;
  return (p.variants || []).find(v => v.name === variantName) || null;
}

/** Current stock for a variant (falls back to product-level stock when unset). */
function getVariantStock(productId, variantName) {
  const v = getVariant(productId, variantName);
  if (v && v.stock !== null && v.stock !== undefined) return Number(v.stock) || 0;
  const p = db.getProduct(productId);
  return p ? (Number(p.stock) || 0) : 0;
}

/**
 * Core stock mutation. Updates the variant JSON (or flat product.stock when no
 * variant is named) AND appends an inventory_movements row in one transaction.
 * Never called directly by routes except for manual adjustments — the lifecycle
 * helpers below (reserve / release / decrement / restore) are the intended API.
 *
 * @returns {{prev:number,newQty:number,movementId:number}|null}
 */
/** Pure planning step for a SALE-side decrement: walks active lots
 *  oldest-first and figures out how much of `qty` each one would supply,
 *  WITHOUT mutating anything yet (the caller applies the mutation inside
 *  its own transaction, alongside the stock write and ledger row, so a
 *  failure anywhere rolls back everything together). Any quantity the
 *  lots can't cover (predates this feature, or was never purchased through
 *  "Add stock → New purchase") is reported as `shortfallQty` so the caller
 *  can blend in the product's flat costPrice/packagingCost for that part —
 *  better a blended estimate than silently pretending it's free. */
function planFifoConsumption(productId, variantName, qty) {
  const lots = db.getActiveLots(productId, variantName || '');
  let remaining = qty;
  const breakdown = [];
  let unitTotal = 0, packTotal = 0, covered = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyRemaining, remaining);
    if (take <= 0) continue;
    breakdown.push({ lotId: lot.id, qty: take, unitCost: lot.unitCost, packagingCost: lot.packagingCost });
    unitTotal += take * lot.unitCost;
    packTotal += take * lot.packagingCost;
    covered += take;
    remaining -= take;
  }
  return {
    breakdown, coveredQty: covered, shortfallQty: Math.max(0, remaining),
    weightedUnitCost: covered ? (unitTotal / covered) : null,
    weightedPackagingCost: covered ? (packTotal / covered) : null,
  };
}

/** Pure planning step for a CANCEL-side restore: looks up exactly which
 *  lot(s) the order's original 'reserve'/'confirm' movement(s) consumed
 *  (via movement_lot_consumption) and proposes giving qty back to those
 *  SAME lots, oldest-consumed first — an exact undo, not a guess. Orders
 *  that predate the lot feature simply have no consumption on record, so
 *  this correctly returns an empty breakdown (the flat stock still gets
 *  released by the normal path; there is just no lot-level detail for it). */
function planFifoRestore(orderId, variantName, qty) {
  const consumption = db.getLotConsumptionForOrder(orderId, variantName || '');
  let remaining = qty;
  const breakdown = [];
  let unitTotal = 0, packTotal = 0, covered = 0;
  for (const c of consumption) {
    if (remaining <= 0) break;
    const give = Math.min(c.qty, remaining);
    if (give <= 0) continue;
    const lot = db.getLot(c.lotId);
    if (!lot) continue;
    breakdown.push({ lotId: lot.id, qty: give, unitCost: lot.unitCost, packagingCost: lot.packagingCost });
    unitTotal += give * lot.unitCost;
    packTotal += give * lot.packagingCost;
    covered += give;
    remaining -= give;
  }
  return {
    breakdown,
    weightedUnitCost: covered ? (unitTotal / covered) : null,
    weightedPackagingCost: covered ? (packTotal / covered) : null,
  };
}

function applyMovement({ productId, variantName = '', delta, reason, orderId = '', actor = 'system' }) {
  if (!productId) return null;
  const product = db.getProduct(productId);
  if (!product) return null;

  const variants = (product.variants || []).map(v => ({ ...v }));
  let prev, newQty, touchedVariant = false;

  if (variantName) {
    const v = variants.find(x => x.name === variantName);
    if (v) {
      prev = (v.stock === null || v.stock === undefined) ? (Number(product.stock) || 0) : (Number(v.stock) || 0);
      newQty = Math.max(0, prev + Number(delta));
      v.stock = newQty;
      touchedVariant = true;
    } else {
      // Variant not found — cannot move stock against a non-existent variant.
      return null;
    }
  } else {
    // Product-level movement (no variant): adjust the flat stock + any variant
    // whose stock mirrors it. In practice reservations/decrements are per
    // variant; this branch is for legacy products without variants.
    prev = Number(product.stock) || 0;
    newQty = Math.max(0, prev + Number(delta));
  }

  // Recompute the rolled-up flat stock so the products grid keeps working.
  const rolledUp = touchedVariant
    ? variants.reduce((s, v) => s + (v.stock === null || v.stock === undefined ? 0 : (Number(v.stock) || 0)), 0)
    : newQty;

  const qtyMoved = Math.abs(Number(delta) || 0);

  const tx = db.raw.transaction(() => {
    // Cost-lot bookkeeping happens INSIDE the same transaction as the stock
    // write and the ledger row — a lot can never end up adjusted without
    // its matching movement existing (or vice versa) even if something
    // fails partway through.
    let lotBreakdown = [];
    let unitCost = null, packagingCost = null;
    try {
      if (delta < 0 && (reason === 'reserve' || reason === 'confirm') && qtyMoved > 0) {
        const plan = planFifoConsumption(productId, variantName, qtyMoved);
        plan.breakdown.forEach(b => db.adjustLotQty(b.lotId, -b.qty));
        lotBreakdown = plan.breakdown;
        if (plan.coveredQty > 0 || plan.shortfallQty > 0) {
          // Blend lot-costed coverage with the flat product cost for
          // whatever the lots couldn't cover — a real number even mid-
          // transition, instead of silently treating the shortfall as free.
          const unitBlend = ((plan.weightedUnitCost || 0) * plan.coveredQty + (Number(product.costPrice) || 0) * plan.shortfallQty) / qtyMoved;
          const packBlend = ((plan.weightedPackagingCost || 0) * plan.coveredQty + (Number(product.packagingCost) || 0) * plan.shortfallQty) / qtyMoved;
          unitCost = unitBlend; packagingCost = packBlend;
        }
      } else if (delta > 0 && reason === 'cancel' && orderId && qtyMoved > 0) {
        const plan = planFifoRestore(orderId, variantName, qtyMoved);
        plan.breakdown.forEach(b => db.adjustLotQty(b.lotId, b.qty));
        lotBreakdown = plan.breakdown;
        unitCost = plan.weightedUnitCost;
        packagingCost = plan.weightedPackagingCost;
      }
    } catch (e) {
      // A cost-tracking bug must never block a real stock movement — worst
      // case the movement just ends up with no cost info attached.
      lotBreakdown = []; unitCost = null; packagingCost = null;
    }

    db.saveProduct({
      ...product,
      variants,
      stock: rolledUp,
    });
    const movementId = db.addInventoryMovement({
      productId, variantName, orderId, delta: Number(delta),
      prevQty: prev, newQty, reason, actor, unitCost, packagingCost,
    });
    if (lotBreakdown.length) db.recordLotConsumption(movementId, lotBreakdown);
    // Stash the id so we can return it after commit.
    applyMovement._lastId = movementId;
  });
  tx();

  return { prev, newQty, movementId: applyMovement._lastId || null };
}

/* ---------------------------------------------------------------------------
 * "Add stock" — the two-mode manual restock the manager actually presses:
 * a brand-new purchase (its own price, becomes its own FIFO lot) or units
 * coming back from a return (no new price — rejoins an existing lot).
 * ------------------------------------------------------------------------- */

/** New purchase: creates a fresh cost lot AND raises stock to match, in one
 *  atomic step. Two lots for the same variant can carry two different
 *  prices on purpose — that IS the point (prices change between
 *  purchases) — a later sale consumes whichever lot is OLDEST first,
 *  regardless of which one happens to be cheaper. */
function addStockLot({ productId, variantName = '', qty, unitCost = 0, packagingCost = 0, actor = 'admin' }) {
  const product = db.getProduct(productId);
  if (!product) return null;
  // Same rule applyMovement already enforces: a NAMED variant must actually
  // exist on the product — otherwise we'd create a lot with nothing real to
  // decrement it against later. Empty variantName ('' — a product with no
  // variants) is always fine.
  if (variantName && !(product.variants || []).some(v => v.name === variantName)) return null;
  qty = Math.max(0, Math.round(Number(qty)) || 0);
  if (!qty) return null;
  let result = null;
  const tx = db.raw.transaction(() => {
    const lot = db.insertStockLot({ productId, variantName, unitCost, packagingCost, qty, source: 'purchase', actor });
    const mv = applyMovement({ productId, variantName, delta: qty, reason: 'restock_purchase', actor });
    if (mv) db.recordLotConsumption(mv.movementId, [{ lotId: lot.id, qty }]);
    result = { lot: db.getLot(lot.id), movement: mv };
  });
  tx();
  return result;
}

/** Return: no new price to enter — these units were already paid for once.
 *  Goes back into the OLDEST lot that has ever existed for this variant, so
 *  it re-enters the FIFO queue at the front (sold again soonest) instead of
 *  waiting behind a newer purchase. If this variant has never had a lot at
 *  all (created before this feature existed), a zero-cost lot is created as
 *  a home for it — same "no cost info" situation as any other pre-feature
 *  stock, not a new problem. */
function addReturnStock({ productId, variantName = '', qty, actor = 'admin' }) {
  const product = db.getProduct(productId);
  if (!product) return null;
  if (variantName && !(product.variants || []).some(v => v.name === variantName)) return null;
  qty = Math.max(0, Math.round(Number(qty)) || 0);
  if (!qty) return null;
  let result = null;
  const tx = db.raw.transaction(() => {
    const allLots = db.getAllLots(productId, variantName || ''); // newest-first
    const oldestLot = allLots.length ? allLots[allLots.length - 1] : null;
    const targetLot = oldestLot || db.insertStockLot({ productId, variantName, unitCost: 0, packagingCost: 0, qty: 0, source: 'return', actor });
    db.adjustLotQty(targetLot.id, qty);
    const mv = applyMovement({ productId, variantName, delta: qty, reason: 'restock_return', actor });
    if (mv) db.recordLotConsumption(mv.movementId, [{ lotId: targetLot.id, qty }]);
    result = { lot: db.getLot(targetLot.id), movement: mv };
  });
  tx();
  return result;
}

/** Active + historical lots for a variant, for the "batches" panel in the
 *  inventory modal — active first (oldest→newest, i.e. consumption order),
 *  then exhausted ones for reference. */
function getLots(productId, variantName = '') {
  const active = db.getActiveLots(productId, variantName || '');
  const all = db.getAllLots(productId, variantName || '');
  const activeIds = new Set(active.map(l => l.id));
  const exhausted = all.filter(l => !activeIds.has(l.id));
  return { active, exhausted };
}

/* ---------------------------------------------------------------------------
 * Lifecycle helpers — these translate order events into stock movements based
 * on the reservationMode setting. They are safe to call even when the product
 * has no variants or the mode is 'none' (they no-op).
 * ------------------------------------------------------------------------- */

/** Normalize a product name for matching only (never for display/storage):
 *  trims, unifies whitespace (including non-breaking spaces from copy-paste),
 *  lowercases, and strips ™/®/© — the exact class of one-character
 *  differences that silently broke stock matching (case, extra space,
 *  trademark symbol). This is a safety net, not a substitute for the
 *  ID-based product sync (see resolveLines below) — it won't help if the
 *  names are genuinely different, only if they're the same name typed
 *  slightly differently. */
function normalizeProductName(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ');
}

/** Resolve the line items of an order into [{productId, variantName, qty}]. */
function resolveLines(order) {
  const out = [];
  if (!order) return out;
  const productName = order.product || '';
  const variantName = order.productVariant || '';
  const qty = Math.max(1, Number(order.quantity) || 1);

  // Precise match FIRST: if this order carries a Shopify product id (captured
  // at webhook time), and that id is linked to a CRM product (via the
  // products/create webhook or a manual link), use it directly — exact and
  // unambiguous, unaffected by how the product's name was typed anywhere.
  // Falls back to normalized-name matching (below) for orders/products that
  // predate linking, or products created manually with no Shopify link.
  let product = null;
  if (order.shopifyProductId) {
    product = db.findProductByExternalId({ storeId: order.storeId || null, platform: order.platform || 'shopify', externalProductId: order.shopifyProductId });
  }

  // Find the product by name (the order stores the product NAME, not id).
  // Matched on a normalized form so a trademark symbol, extra space, or
  // different casing doesn't silently break the match (see
  // normalizeProductName above).
  const normTarget = normalizeProductName(productName);
  if (!product) product = db.getProducts().find(p => normalizeProductName(p.name) === normTarget);
  if (product) {
    out.push({ productId: product.id, variantName, qty });
  } else if (productName) {
    // Silent-failure guard: without this, a one-character name mismatch
    // (™ symbol, extra space, casing) means stock quietly never moves, with
    // zero error anywhere. Logging the exact two strings side-by-side makes
    // a mismatch immediately visible in Render logs instead of invisible.
    const known = db.getProducts().map(p => p.name);
    console.log('[inventory] no CRM product matches order line (no id link, no name match) — stock will NOT move for this line', JSON.stringify({ orderProductName: productName, shopifyProductId: order.shopifyProductId || null, knownCrmProductNames: known }));
  }
  // Also honour explicit line_items if present (multi-line Shopify imports).
  if (Array.isArray(order.lineItems)) {
    for (const li of order.lineItems) {
      const name = li.name || '';
      const variant = li.variant || '';
      const p = db.getProducts().find(x => normalizeProductName(x.name) === normalizeProductName(name));
      if (p) {
        // Avoid duplicating the primary line already pushed above.
        const dup = out.find(x => x.productId === p.id && x.variantName === variant);
        if (!dup) out.push({ productId: p.id, variantName: variant, qty: Math.max(1, Number(li.quantity) || 1) });
      }
    }
  }
  return out;
}

/** ReservationMode = 'immediate': reserve stock when an order is created. */
function reserveOnOrder(order, actor = 'system') {
  const mode = db.getSettings().reservationMode;
  if (mode !== 'immediate') return [];
  return resolveLines(order).map(line =>
    applyMovement({ ...line, delta: -line.qty, reason: 'reserve', orderId: order.id, actor })
  );
}

/** ReservationMode = 'on_confirm' OR 'immediate': decrement on confirmation. */
function decrementOnConfirm(order, actor = 'system') {
  const mode = db.getSettings().reservationMode;
  if (mode === 'none') return [];
  // Under 'immediate' the stock was already reserved at creation — confirm is
  // a no-op. Under 'on_confirm' the decrement happens now.
  if (mode === 'immediate') return [];
  return resolveLines(order).map(line =>
    applyMovement({ ...line, delta: -line.qty, reason: 'confirm', orderId: order.id, actor })
  );
}

/** Restore stock when a confirmation is cancelled (any active mode). */
function releaseOnCancel(order, actor = 'system') {
  const mode = db.getSettings().reservationMode;
  if (mode === 'none') return [];
  return resolveLines(order).map(line =>
    applyMovement({ ...line, delta: line.qty, reason: 'cancel', orderId: order.id, actor })
  );
}

/* ---------------------------------------------------------------------------
 * Manual adjustment + reporting.
 * ------------------------------------------------------------------------- */

/** Manual stock override: sets an absolute level (used by the inventory UI). */
function setVariantStock({ productId, variantName, newQty, reason = 'adjustment', actor = 'admin' }) {
  const cur = getVariantStock(productId, variantName);
  const delta = Number(newQty) - cur;
  if (delta === 0) return { prev: cur, newQty: cur, movementId: null };
  return applyMovement({ productId, variantName, delta, reason, actor });
}

/** Set the threshold for a variant (no ledger impact — it is a config value). */
function setVariantThreshold(productId, variantName, threshold) {
  const product = db.getProduct(productId);
  if (!product) return null;
  const variants = (product.variants || []).map(v => ({ ...v }));
  const v = variants.find(x => x.name === variantName);
  if (!v) return null;
  v.threshold = threshold === null || threshold === undefined || threshold === ''
    ? null : (Number(threshold) || 0);
  db.saveProduct({ ...product, variants });
  return v;
}

/**
 * Every variant at or below its threshold (or below the default low-water mark
 * of 5 when no per-variant threshold is set). Feeds the dashboard + alerts.
 */
function listLowStock(defaultThreshold = 24) {
  const out = [];
  for (const p of db.getProducts()) {
    const variants = (p.variants || []);
    if (!variants.length) {
      // Product without variants — check the flat stock against the
      // product's OWN threshold (manager-configurable, defaults to 24),
      // falling back to the passed-in default only if the product somehow
      // has none set.
      const s = Number(p.stock) || 0;
      const thr = (p.threshold === null || p.threshold === undefined) ? defaultThreshold : Number(p.threshold);
      if (s <= thr) out.push({ productId: p.id, productName: p.name, variantName: '', stock: s, threshold: thr });
      continue;
    }
    for (const v of variants) {
      const s = (v.stock === null || v.stock === undefined) ? (Number(p.stock) || 0) : (Number(v.stock) || 0);
      const thr = (v.threshold === null || v.threshold === undefined) ? defaultThreshold : (Number(v.threshold) || 0);
      if (s <= thr) out.push({ productId: p.id, productName: p.name, variantName: v.name, stock: s, threshold: thr });
    }
  }
  return out;
}

/** Full inventory state for a product (per-variant stock + thresholds). */
function getInventory(productId) {
  const p = db.getProduct(productId);
  if (!p) return null;
  return {
    productId: p.id,
    productName: p.name,
    flatStock: Number(p.stock) || 0,
    variants: (p.variants || []).map(v => ({
      name: v.name,
      image: v.image || '',
      stock: (v.stock === null || v.stock === undefined) ? null : Number(v.stock),
      threshold: (v.threshold === null || v.threshold === undefined) ? null : Number(v.threshold),
      // Active lot count is cheap context for the UI (e.g. "2 batches" next
      // to the stock number) without forcing a second round-trip just to
      // know whether there's anything to show in the batches panel.
      activeLotCount: db.getActiveLots(productId, v.name || '').length,
    })),
  };
}

/** Append-only history for a product (optionally a single variant). */
function getHistory(productId, variantName) {
  return db.getInventoryMovements(productId, variantName);
}

module.exports = {
  getVariant,
  getVariantStock,
  applyMovement,
  reserveOnOrder,
  decrementOnConfirm,
  releaseOnCancel,
  setVariantStock,
  setVariantThreshold,
  listLowStock,
  getInventory,
  getHistory,
  resolveLines,
  addStockLot,
  addReturnStock,
  getLots,
};
