import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  CLIENT_SELECT, withDerived, buildClientPatch, clientOrderHistory, CLIENT_UNEDITABLE,
} from "@/lib/erp/clients";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * One customer — LP.10, restoring R5.
 *
 * The registry has been readable as a LIST since Phase 5 and openable as a
 * RECORD never. "What has this person bought, and did it arrive?" is the
 * question every repeat-purchase call starts with, and the only way to answer it
 * was to search the order list by phone number and read the rows.
 *
 * 404, NOT 403, for a client in another tenant — the platform rule. The binding
 * and row-level security produce that answer without this file doing anything,
 * which is the point: a `findUnique` that returns nothing is indistinguishable
 * from one that never existed.
 * ========================================================================== */

export const GET = tenantRoute<Params>("erp:clients:read", async ({ db, params }) => {
  const client = await db.client.findUnique({
    where: { id: params.id },
    select: CLIENT_SELECT,
  });
  if (!client) return apiError(404, "NOT_FOUND", "No such customer.");

  return apiOk({
    ...(toJson(withDerived(client)) as object),
    history: (await clientOrderHistory(db, client.phone)).map(toJson),
  });
});

/**
 * Correct the four fields that have no reliable automatic source.
 *
 * PATCH rather than the legacy's PUT, for the reason recorded on the order
 * route: PUT asks for the whole resource, and a console that reads a record,
 * edits one field and posts the object back is how a stale value overwrites a
 * fresh one.
 *
 * **IT NEVER TOUCHES THE LIFETIME COUNTERS**, which is the legacy's own rule and
 * the more important half of this endpoint. They move exclusively through
 * `syncClientFromOrder`, one order event at a time, and the registry's entire
 * value rests on every counter being the sum of things that actually happened. A
 * hand-edited `deliveredOrders` is a number with no events behind it.
 *
 * `buildClientPatch` REFUSES a counter by name rather than dropping it (D-LP.1):
 * a caller sending `totalSpent` believes they are setting a customer's lifetime
 * spend, and a 200 that silently does nothing is the same class of defect LP.1
 * existed to fix in `costPrice`.
 */
export const PATCH = tenantRoute<Params>("erp:clients:write", async ({ db, req, params, session }) => {
  const existing = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return apiError(404, "NOT_FOUND", "No such customer.");

  const patch = buildClientPatch(await req.json().catch(() => ({})));
  if (patch.refused) {
    return apiError(
      422,
      "READ_ONLY_FIELD",
      `"${patch.refused}" is maintained by the order history and cannot be edited.`,
      { readOnly: [...CLIENT_UNEDITABLE] },
    );
  }
  if (Object.keys(patch.data).length === 0) {
    return apiError(422, "INVALID_INPUT", "Nothing to change.");
  }

  const updated = await db.client.update({
    where: { id: params.id },
    data: patch.data,
    select: CLIENT_SELECT,
  });

  /* The same trail an order edit leaves (LP.12/N12), for the same reason:
   * correcting a customer's address changes where a courier drives. WHICH
   * FIELDS, not what they became — this table holds a person's name and home
   * address, and an audit row is readable by anybody with `erp:audit:read`. */
  await db.auditEvent.create({
    data: {
      tenantId: session.auth!.tenantId,
      product: "erp",
      entity: "client",
      entityId: params.id,
      action: "edit",
      userId: session.user.id,
      payload: { fields: Object.keys(patch.data).sort() },
    },
  });

  return apiOk(toJson(withDerived(updated)));
});
