import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { applyMovement, inventoryView } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

type Params = { id: string };

const Adjust = z.object({
  variantName: z.string().trim().max(120).optional(),
  delta: z.coerce.number().int(),
  reason: z.string().trim().min(1).max(120),
});

/**
 * A manual correction — damage, theft, a miscount.
 *
 * It appends to the ledger rather than setting a total, which is the whole
 * design: "stock is 15" tells you nothing, "stock went 20 → 15 because five
 * were damaged, recorded by this person" is auditable. The route deliberately
 * takes a DELTA and a REASON and offers no way to set an absolute figure.
 */
export const POST = tenantRoute<Params>("erp:inventory:write", async ({ db, req, session, params }) => {
  const parsed = Adjust.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  if (parsed.data.delta === 0) {
    return apiError(422, "INVALID_INPUT", "An adjustment of zero records nothing.");
  }

  const moved = await applyMovement(db, session.auth!.tenantId, {
    productId: params.id,
    variantName: parsed.data.variantName ?? "",
    delta: parsed.data.delta,
    reason: parsed.data.reason,
    actorUserId: session.user.id,
  });
  if (!moved) return apiError(404, "NOT_FOUND", "No such product or variant.");

  const product = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { stock: true, threshold: true, variants: true },
  });

  return apiOk({ ...moved, inventory: inventoryView(product!) });
});
