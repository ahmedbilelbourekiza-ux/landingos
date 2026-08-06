import { z } from "zod";
import { Prisma } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { applyMovement, inventoryView, rollUp, type Variant } from "@/lib/erp/inventory";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * The variant editor's write path — LP.18, restoring R12.
 *
 * `PUT /api/products/:id/variants` is the ERP's editor, and the port lost it. A
 * variant could be created once (in the product's `variants` array at creation)
 * and never renamed, never removed, never given a threshold — and its stock
 * could only be moved through the generic adjust control by typing the variant
 * name exactly. `optionDefs` has had a column since Phase 3.2 with **no writer
 * anywhere**: the vocabulary a matrix editor is built from could not be stored.
 *
 * Multi-dimensional variants are how a clothing or cosmetics catalogue is
 * modelled, which in this market is most of them.
 *
 * -----------------------------------------------------------------------------
 * D-LP.18.1 — EVERY STOCK DIFFERENCE GOES THROUGH THE LEDGER.
 *
 * This route may write the `variants` ARRAY (names, SKUs, images, thresholds,
 * option maps) directly, because none of that is stock. It may NOT write a
 * level: a `stock` on an incoming variant is turned into a DELTA against what
 * is stored and applied with `applyMovement`, which writes the level and its
 * reason in one transaction. That pairing is the only reason the FIFO cost
 * basis can be trusted, and it is why `buildProductPatch` refuses `variants`
 * and points here.
 *
 * The ERP did the same thing — its editor called `inventory.setVariantStock`
 * rather than writing the column — and this is the one part of that route that
 * is not optional.
 *
 * D-LP.18.2 — REMOVING A VARIANT THAT STILL HOLDS STOCK IS REFUSED BY NAME.
 *
 * The ERP silently dropped it, and the stock went with it: no movement row, no
 * reason, and a cost basis that no longer adds up. Zero it through
 * `/inventory/adjust` first, which records WHY — damaged, miscounted, returned
 * to the supplier — and then the variant can go.
 * ========================================================================== */

const VariantInput = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(80).optional(),
  image: z.string().trim().max(2000).optional(),
  /** The absolute level this variant should hold. Applied as a delta. */
  stock: z.coerce.number().int().min(0).optional(),
  threshold: z.coerce.number().int().min(0).optional(),
  /** `{ Size: "M", Colour: "Blue" }` — which option values this variant is. */
  options: z.record(z.string(), z.string().max(120)).optional(),
});

const OptionDef = z.object({
  name: z.string().trim().min(1).max(120),
  values: z.array(z.string().trim().min(1).max(120)).max(60),
});

const Body = z.object({
  variants: z.array(VariantInput).max(200),
  optionDefs: z.array(OptionDef).max(10).optional(),
  /** Why the stock moved. One reason for the whole batch, as the editor is. */
  reason: z.string().trim().max(120).optional(),
});

export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params }) => {
  const product = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { id: true, stock: true, threshold: true, variants: true, optionDefs: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");
  return apiOk({
    ...inventoryView(product),
    optionDefs: toJson(product.optionDefs) ?? [],
  });
});

/**
 * `erp:inventory:write`, not `erp:products:write`.
 *
 * The route moves stock. `POST /inventory/adjust` is what it composes and that
 * is the permission that route checks, so anybody who can reach this can
 * already move a level by another door — and somebody who can only edit
 * product TEXT must not be able to move stock by renaming a variant.
 */
export const PUT = tenantRoute<Params>("erp:inventory:write", async ({ db, req, session, params }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const product = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { id: true, stock: true, threshold: true, variants: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");

  const incoming = parsed.data.variants;

  // Two variants with one name is a catalogue nobody can pick from and a stock
  // level with two owners — `applyMovement` finds a variant BY NAME.
  const names = incoming.map((v) => v.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) {
    return apiError(422, "DUPLICATE_VARIANT", `"${duplicate}" appears twice.`);
  }

  const stored = (Array.isArray(product.variants) ? product.variants : []) as unknown as Variant[];
  const storedByName = new Map(stored.map((v) => [String(v.name ?? ""), v]));
  const keptNames = new Set(names);

  // D-LP.18.2. Refused BY NAME, listing every variant that would lose stock —
  // one at a time is four requests to discover four problems.
  const holdingStock = stored
    .filter((v) => !keptNames.has(String(v.name ?? "")) && Number(v.stock ?? 0) !== 0)
    .map((v) => String(v.name ?? ""));
  if (holdingStock.length) {
    return apiError(
      422,
      "VARIANT_HOLDS_STOCK",
      "A variant that still holds stock cannot be removed. Adjust it to zero first, with a reason, so the movement is recorded.",
      { variants: holdingStock },
    );
  }

  /* The array is written FIRST, without touching any level.
   *
   * `stock` on each entry is carried over from what is stored, never from the
   * request — the levels move below, through the ledger, and a level written
   * here would be overwritten by `applyMovement` anyway or, worse, would not be.
   * A brand new variant starts at zero and receives its opening stock as a
   * movement like everything else. */
  const nextVariants = incoming.map((v) => {
    const existing = storedByName.get(v.name);
    return {
      name: v.name,
      sku: v.sku ?? String(existing?.sku ?? ""),
      image: v.image ?? String(existing?.image ?? ""),
      options: v.options ?? (existing?.options as Record<string, string> | undefined) ?? {},
      threshold: v.threshold ?? Number(existing?.threshold ?? 0),
      stock: Number(existing?.stock ?? 0),
    };
  });

  await db.catalogProduct.update({
    where: { id: params.id },
    data: {
      variants: nextVariants as unknown as Prisma.InputJsonValue,
      ...(parsed.data.optionDefs
        ? { optionDefs: parsed.data.optionDefs as unknown as Prisma.InputJsonValue }
        : {}),
      // The product-level roll-up follows the array. `applyMovement` maintains
      // it too, so this only matters for a batch that moves nothing.
      stock: rollUp(nextVariants as Variant[], Number(product.stock ?? 0)),
    },
  });

  // Then the levels, one movement at a time, each with its reason.
  const reason = parsed.data.reason || "variant_edit";
  const moves: { variantName: string; from: number; to: number }[] = [];
  for (const v of incoming) {
    if (v.stock === undefined) continue;
    const before = Number(storedByName.get(v.name)?.stock ?? 0);
    const delta = v.stock - before;
    if (delta === 0) continue;
    await applyMovement(db, session.auth!.tenantId, {
      productId: params.id,
      variantName: v.name,
      delta,
      reason,
      actorUserId: session.user.id,
    });
    moves.push({ variantName: v.name, from: before, to: v.stock });
  }

  const after = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { stock: true, threshold: true, variants: true, optionDefs: true },
  });

  /* The event timeline gets a row, as the ERP's did ("permanent timeline —
   * price/cost/variant/supplier changes"). Which variants moved, not what the
   * whole catalogue now looks like. */
  await db.catalogProductEvent.create({
    data: {
      tenantId: session.auth!.tenantId,
      productId: params.id,
      eventType: "variants_changed",
      field: "variants",
      oldValue: String(stored.length),
      newValue: String(nextVariants.length),
      actorUserId: session.user.id,
    },
  });

  return apiOk({
    ...inventoryView(after!),
    optionDefs: toJson(after!.optionDefs) ?? [],
    moved: moves,
  });
});
