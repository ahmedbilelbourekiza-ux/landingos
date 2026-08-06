import { withTenant, type TenantDb } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { seesWholeBook } from "@/lib/erp/scope";
import { buildPatch, updateOrder, ORDER_LIST_SELECT } from "@/lib/erp/orders";
import { onOrderConfirmed, onOrderCancelled } from "@/lib/erp/confirm";
import { bookShipment } from "@/lib/erp/shipments";
import { readSettings } from "@/lib/erp/settings";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:orders:read", async ({ db, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  return apiOk(await readOrder(db, params.id));
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
export const PATCH = tenantRoute<Params>("erp:orders:write", async ({ db, req, session, params, afterCommit }) => {
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

  const tenantId = session.auth!.tenantId;
  await updateOrder(db, tenantId, params.id, patch.data);

  /* LP.12 / N12 — THE EDIT IS RECORDED, AND IT WAS NOT.
   *
   * `AuditEvent` exists, `GET /api/erp/audit` exists, `erp:audit:read` is a
   * declared permission — and **no order mutation wrote a row**. The ERP audits
   * every order edit and shows it in an investigation modal, because this is the
   * path that changes a price, a status, an assigned agent and a delivery
   * address: money and accountability. "Who moved this order to confirmed?" had
   * no answer on the platform, only "it is confirmed".
   *
   * WHICH FIELDS, NOT WHAT THEY BECAME. The keys are recorded and the values are
   * not: an order carries a customer's name, phone number and address, and an
   * audit table is read by anybody holding `erp:audit:read`. The row that
   * matters — who, when, which fields — is here; the values are on the order.
   *
   * In the same transaction as the update, so an edit that rolls back leaves no
   * record of having happened. */
  await db.auditEvent.create({
    data: {
      tenantId,
      product: "erp",
      entity: "order",
      entityId: params.id,
      action: patch.data.status && patch.data.status !== order.status
        ? `status:${patch.data.status}`
        : "edit",
      userId: session.user.id,
      payload: { fields: Object.keys(patch.data).sort() },
    },
  });

  // The second door into `confirmed`. The ERP's comment on its own version of
  // this branch is the reason it exists: a status change made from the list
  // dropdown must trigger the same side effects as one made by logging a call,
  // or the two silently diverge and the difference only shows up in whichever
  // door is used less. See confirm.ts.
  if (patch.data.status === "confirmed" && order.status !== "confirmed") {
    const confirmed = await onOrderConfirmed(db, tenantId, params.id, await readSettings(db), session.user.id);
    // Outside the transaction, for the reason in confirm.ts: this door reaches
    // the same carrier the other one does, and a booking that shared this
    // transaction would let a slow carrier roll the status change back.
    if (confirmed.bookShipment) {
      afterCommit(async () => {
        await bookShipment(tenantId, params.id);
        // Re-read so the response carries the tracking number the booking just
        // wrote. The order below is built before the parcel exists.
        return apiOk(await withTenant(tenantId, (fresh) => readOrder(fresh, params.id)));
      });
    }
  } else if (patch.data.status === "cancelled" && order.status === "confirmed") {
    await onOrderCancelled(db, tenantId, params.id, session.user.id);
  }

  return apiOk(await readOrder(db, params.id));
});

/** The shape both the read and the write answer with. */
async function readOrder(db: TenantDb, id: string) {
  const row = await db.fulfillmentOrder.findUnique({ where: { id }, select: ORDER_LIST_SELECT });
  const { _count, ...rest } = row!;
  return { ...(toJson(rest) as object), callCount: _count.calls };
}

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
