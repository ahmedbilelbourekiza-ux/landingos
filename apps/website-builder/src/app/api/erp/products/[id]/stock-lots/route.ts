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

const AddLot = z
  .object({
    variantName: z.string().trim().max(120).optional(),
    mode: z.enum(["purchase", "return"]).default("purchase"),
    /** How many MORE arrived. The restock verb. */
    qty: z.coerce.number().int().min(1).max(1_000_000).optional(),
    /**
     * INV.3 — the level this stock should now BE, not how much to add.
     *
     * The one absolute figure this API accepts, and it is deliberately narrow:
     * only before anything has ever moved. See the header.
     */
    setTo: z.coerce.number().int().min(0).max(1_000_000).optional(),
    unitCost: z.union([z.string(), z.number()]).optional(),
    packagingCost: z.union([z.string(), z.number()]).optional(),
  })
  // Exactly one. Accepting both would leave the route deciding which the
  // caller meant, and the two mean opposite things about the same number.
  .refine((body) => (body.qty === undefined) !== (body.setTo === undefined), {
    message: "Send either qty (how many arrived) or setTo (the opening level), not both.",
  });

/**
 * Restock — and, once per level, set an opening figure.
 *
 * A PURCHASE creates its own lot at its own price, and that is the point:
 * prices change between purchases, so two lots for one variant legitimately
 * carry two different costs. A later sale consumes the OLDEST first regardless
 * of which is cheaper — that is what makes the reported margin the real one
 * rather than the flattering one.
 *
 * A RETURN carries no new price. It rejoins stock at the product's existing
 * cost basis rather than inventing a purchase that never happened.
 *
 * -----------------------------------------------------------------------------
 * INV.3 — `setTo`, THE ONE ABSOLUTE FIGURE THIS API ACCEPTS.
 *
 * THE COMPLAINT: a landing page sent to the Manager arrives with no stock, and
 * every way of putting a number on it ADDS. That reading was correct.
 * `catalogProductFromLanding` never passes `stock` and the column has no
 * default, so the product lands NULL; `POST /inventory/adjust` takes a delta
 * and its own help text says it records "never a new total"; this route took
 * `qty`. The two routes that DO accept an absolute level were both out of
 * reach — `POST /products` is not what the send uses, and
 * `PUT /products/[id]/variants` needs variants the send does not transfer. So
 * the merchant met two boxes labelled "stock" that meant opposite things, and
 * the only reachable one meant "add".
 *
 * WHY IT LIVES HERE AND NOT ON THE ADJUST ROUTE. Opening stock is stock that
 * ARRIVED, so it needs a lot and a unit cost like every other arrival —
 * `/inventory/adjust` creates no `StockLot` at all, which is why a level
 * entered the obvious way had no cost basis and made every margin derived from
 * it wrong. Routing the opening figure through the lot writer fixes the
 * missing affordance and the missing cost basis in one move.
 *
 * WHY IT IS REFUSED ONCE ANYTHING HAS MOVED. An absolute figure written over a
 * level with history is exactly the untraceable overwrite D-LP.1 refuses: it
 * would silently absorb a sale, a correction or a cancellation into one
 * unexplained number. Before the first movement there is no history to absorb,
 * so "the level is 100" is a complete and honest statement. Afterwards it is
 * not, and the route says where the auditable door is.
 *
 * WHY A LOWER FIGURE IS REFUSED TOO. Setting an opening level DOWN is not an
 * arrival; it is a correction, and a correction owes a reason (damaged, a
 * miscount, returned to the supplier). This route has nowhere to put one.
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
  /* INV.1's twin, and it was the worse of the two.
   *
   * A product-level restock on a product that keeps stock per variant used to
   * create the `StockLot`, write the `InventoryMovement`, and then leave
   * `CatalogProduct.stock` exactly where it was — because the update below
   * writes `rollUp(variants, newQty)`, which sums the variant levels whenever
   * there are any and ignores `newQty` entirely.
   *
   * So the units were paid for, given a cost basis, and never appeared. Worse
   * than the adjust route's version of the same bug: FIFO consumption draws
   * from lots, so a later sale would consume units the stock column had never
   * counted, and the cost basis would come out of a lot nobody knew existed.
   *
   * Refused for the same reason `applyMovement` refuses: which variant arrived
   * on the shelf is a fact only the caller has. */
  if (!variantName && variants.length) {
    return apiError(
      422,
      "VARIANT_LEVEL_REQUIRED",
      "This product keeps its stock per variant. Name the variant this stock arrived for.",
    );
  }

  /* INV.3 — resolve `setTo` into the quantity that ARRIVES.
   *
   * Done before anything is written, so every refusal below leaves the
   * database exactly as it found it. `currentLevel` is read the same way the
   * write path reads it a few lines down — one rule for the level, not two. */
  const currentLevel = variantName
    ? Number(variants.find((v) => v.name === variantName)!.stock ?? 0)
    : Number(product.stock ?? 0);

  let arriving: number;
  if (input.setTo !== undefined) {
    // Scoped to THIS level, not the whole product: on a variant product each
    // variant gets its own opening figure, and one variant already having
    // moved must not lock the others out.
    const moved = await db.inventoryMovement.count({
      where: { productId: params.id, variantName },
    });
    if (moved > 0) {
      return apiError(
        422,
        "HAS_STOCK_HISTORY",
        "This stock has moved before, so it no longer has an opening level. Record a correction with a reason instead.",
      );
    }
    if (input.setTo === currentLevel) {
      // The adjust route's rule: a movement that moves nothing records nothing.
      return apiError(422, "INVALID_INPUT", "That is already the level.");
    }
    if (input.setTo < currentLevel) {
      return apiError(
        422,
        "OPENING_STOCK_LOWER",
        "An opening level can only be set upward here, because this records stock arriving. To take stock away, record a correction with a reason.",
      );
    }
    arriving = input.setTo - currentLevel;
  } else {
    arriving = input.qty!;
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
      qtyOriginal: arriving, qtyRemaining: arriving,
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
    newQty = prevQty + arriving;
    variant.stock = newQty;
  } else {
    prevQty = Number(product.stock ?? 0);
    newQty = prevQty + arriving;
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
      delta: arriving, prevQty, newQty,
      // INV.3 — an opening figure is its own event and says so in the
      // history, rather than hiding inside "import" beside real restocks.
      reason: input.setTo !== undefined
        ? "opening"
        : input.mode === "purchase" ? "import" : "initial",
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
