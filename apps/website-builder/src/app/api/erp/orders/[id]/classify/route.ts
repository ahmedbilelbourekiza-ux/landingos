import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { CLASSIFICATIONS } from "@/lib/erp/orders";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

const Classify = z.object({
  classification: z.string().trim(),
  reason: z.string().trim().max(500).optional(),
  responsible: z.string().trim().max(120).optional(),
});

/**
 * Mark an order as fake, or clear the mark.
 *
 * Classification is ORTHOGONAL to status and lives in its own column for that
 * reason: a confirmed order that turns out to be fake is still confirmed. Both
 * facts are true, both are needed — the confirmation is what an agent was paid
 * for and what the fake mark exists to review — and collapsing them into one
 * field loses whichever one is written second.
 */
export const POST = tenantRoute<Params>("erp:orders:write", async ({ db, req, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const parsed = Classify.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", "A classification is required.");
  }
  const value = parsed.data.classification;

  if (!CLASSIFICATIONS.includes(value as (typeof CLASSIFICATIONS)[number])) {
    return apiError(422, "INVALID_CLASSIFICATION", `"${value}" is not a classification.`, {
      valid: [...CLASSIFICATIONS],
    });
  }

  const updated = await db.fulfillmentOrder.update({
    where: { id: params.id },
    data: {
      classification: value,
      fakeReason: value ? (parsed.data.reason ?? "") : null,
      fakeResponsible: value ? (parsed.data.responsible ?? "") : null,
      fakeAt: value ? new Date() : null,
    },
    select: {
      id: true, classification: true, fakeReason: true, fakeResponsible: true,
      fakeAt: true, status: true,
    },
  });

  return apiOk(toJson(updated));
});
