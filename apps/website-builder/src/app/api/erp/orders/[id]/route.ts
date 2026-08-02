import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { seesWholeBook } from "@/lib/erp/scope";
import { buildPatch, updateOrder, ORDER_LIST_SELECT } from "@/lib/erp/orders";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:orders:read", async ({ db, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const order = await db.fulfillmentOrder.findUnique({
    where: { id: params.id },
    select: ORDER_LIST_SELECT,
  });
  const { _count, ...rest } = order!;
  return apiOk({ ...(toJson(rest) as object), callCount: _count.calls });
});

/**
 * Patch an order.
 *
 * PATCH rather than the ERP's PUT, and that is not only a naming choice: PUT
 * asks for the whole resource, and the ERP's console read the order, edited one
 * field and sent the object back — which is how a masked secret gets written
 * back over a real one elsewhere in this codebase. A patch of named fields
 * cannot do that.
 *
 * Everything the caller may not write is dropped silently, EXCEPT reassignment,
 * which is a loud 403. See buildPatch for why the two are treated differently.
 */
export const PATCH = tenantRoute<Params>("erp:orders:write", async ({ db, req, session, params }) => {
  const { order, denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const patch = buildPatch(await req.json().catch(() => ({})), {
    isManager: seesWholeBook(session),
    current: order,
  });

  if (patch.forbiddenField) {
    return apiError(403, "FORBIDDEN_FIELD", "Only a manager can reassign an order.");
  }
  if (patch.invalid) {
    return apiError(422, "INVALID_INPUT", patch.invalid);
  }

  await updateOrder(db, session.auth!.tenantId, params.id, patch.data);

  const after = await db.fulfillmentOrder.findUnique({
    where: { id: params.id },
    select: ORDER_LIST_SELECT,
  });
  const { _count, ...rest } = after!;
  return apiOk({ ...(toJson(rest) as object), callCount: _count.calls });
});

/**
 * Delete an order.
 *
 * Manager-only, and it does NOT touch the customer registry. That is
 * deliberate and the ERP asserted it: a customer's identity and lifetime
 * history are not reversible by deleting the order that created them.
 */
export const DELETE = tenantRoute<Params>("erp:orders:write", async ({ db, session, params }) => {
  if (!seesWholeBook(session)) {
    return apiError(403, "FORBIDDEN", "You do not have access to this.");
  }
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  await db.fulfillmentOrder.delete({ where: { id: params.id } });
  return apiOk({ id: params.id, deleted: true });
});
