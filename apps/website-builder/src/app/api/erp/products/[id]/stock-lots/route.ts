import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { rollUp, inventoryView, type Variant } from "@/lib/erp/inventory";
import { toJson, toDecimal } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params, searchParams }) => {
  const variantName = searchParams.get("variantName") ?? undefined;

  const lots = await db.stockLot.findMany({
    where: {
      productId: params.id,
      ...(variantName !== undefined ? { variantName } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, variantName: true, unitCost: true, packagingCost: true,
      qtyOriginal: true, qtyRemaining: true, source: true,
      actorUserId: true, createdAt: true,
    },
  });

  // Split rather than filtered on the client: "what can still be sold, and at
  // what cost" is a different question from "what did we ever buy", and the
  // first one drives the FIFO order.
  return apiOk({
    active: lots.filter((l) => (l.qtyRemaining ?? 0) > 0).map(toJson),
    exhausted: lots.filter((l) => (l.qtyRemaining ?? 0) <= 0).map(toJson),
  });
});

const AddLot = z.object({
  variantName: z.string().trim().max(120).optional(),
  mode: z.enum(["purchase", "return"]).default("purchase"),
  qty: z.coerce.number().int().min(1).max(1_000_000),
  unitCost: z.union([z.string(), z.number()]).optional(),
  packagingCost: z.union([z.string(), z.number()]).optional(),
});

/**
 * Restock.
 *
 * A PURCHASE creates its own lot at its own price, and that is the point:
 * prices change between purchases, so two lots for one variant legitimately
 * carry two different costs. A later sale consumes the OLDEST first regardless
 * of which is cheaper — that is what makes the reported margin the real one
 * rather than the flattering one.
 *
 * A RETURN carries no new price. It rejoins stock at the product's existing
 * cost basis rather than inventing a purchase that never happened.
 */
export const POST = tenantRoute<Params>("erp:inventory:write", async ({ db, req, session, params }) => {
  const parsed = AddLot.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const input = parsed.data;
  const tenantId = session.auth!.tenantId;

  const product = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { id: true, stock: true, threshold: true, variants: true, costPrice: true, packagingCost: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");

  const variantName = input.variantName ?? "";
  const variants = (Array.isArray(product.variants) ? product.variants : []) as unknown as Variant[];
  if (variantName && !variants.some((v) => v.name === variantName)) {
    return apiError(404, "NOT_FOUND", "No such variant.");
  }

  const unitCost = input.mode === "purchase"
    ? (toDecimal(input.unitCost) ?? product.costPrice ?? undefined)
    : (product.costPrice ?? undefined);
  const packagingCost = input.mode === "purchase"
    ? (toDecimal(input.packagingCost) ?? product.packagingCost ?? undefined)
    : (product.packagingCost ?? undefined);

  const lot = await db.stockLot.create({
    data: {
      tenantId, productId: params.id, variantName,
      unitCost, packagingCost,
      qtyOriginal: input.qty, qtyRemaining: input.qty,
      source: input.mode, actorUserId: session.user.id,
    },
    select: { id: true, unitCost: true, packagingCost: true, qtyRemaining: true },
  });

  // Raise the stock to match, in the same transaction. A lot that exists
  // without the stock it represents is a cost basis for units nobody can sell.
  let prevQty = 0;
  let newQty = 0;
  if (variantName) {
    const variant = variants.find((v) => v.name === variantName)!;
    prevQty = Number(variant.stock ?? 0);
    newQty = prevQty + input.qty;
    variant.stock = newQty;
  } else {
    prevQty = Number(product.stock ?? 0);
    newQty = prevQty + input.qty;
  }

  await db.catalogProduct.update({
    where: { id: params.id },
    data: {
      variants: variants as unknown as never,
      stock: rollUp(variants, newQty),
    },
  });

  const movement = await db.inventoryMovement.create({
    data: {
      tenantId, productId: params.id, variantName,
      delta: input.qty, prevQty, newQty,
      reason: input.mode === "purchase" ? "import" : "initial",
      unitCost, packagingCost, actorUserId: session.user.id,
    },
    select: { id: true },
  });
  void movement;

  const after = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { stock: true, threshold: true, variants: true },
  });

  return apiOk({ lot: toJson(lot), inventory: inventoryView(after!) }, { status: 201 });
});
