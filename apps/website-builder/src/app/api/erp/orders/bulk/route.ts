import { z } from "zod";

import { can } from "@landingos/auth";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { mayTouchOrder, seesWholeBook } from "@/lib/erp/scope";
import { ORDER_STATUSES, CLASSIFICATIONS, BULK_BOOK_LIMIT, updateOrder } from "@/lib/erp/orders";
import { bookShipment } from "@/lib/erp/shipments";
import { assignFollowupAgent } from "@/lib/erp/assign";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Bulk actions over a caller-supplied list of ids.
 *
 * The most valuable endpoint on the surface to point somewhere it should not
 * go, because it takes a list of primary keys straight from the request — which
 * is precisely the shape that invites pasting ids you were never given.
 *
 * Three things therefore hold, and each is asserted by a test that violates it:
 *
 *   - Ids from another TENANT do not resolve. The binding and row-level
 *     security see to that; nothing here filters by tenant.
 *   - Ids outside the caller's RECORD scope do not resolve either — the same
 *     ownership check the per-order routes use, applied per id.
 *   - A partial failure is reported PER ID rather than failing the batch. Fifty
 *     orders where one id is stale should move forty-nine, and the caller needs
 *     to know which one did not.
 *
 * -----------------------------------------------------------------------------
 * LP.9 / R7 — THE FOUR ACTIONS THAT WERE MISSING.
 *
 * The legacy dispatches eight; this had three. The four restored here are
 * `classify`, `assignFollowup`, `createShipments` and `sendToDelivery`, and the
 * third of them is the single highest-volume manager action in the building:
 * booking a day's confirmed orders one at a time is the difference between a
 * minute and an hour. (`export` and `print` are the legacy's other two and are
 * NOT restored as bulk actions — its versions mutate nothing and exist only to
 * validate ids for a client that then builds the file itself. LP.6 gave the
 * export a real server-side writer, and `POST /orders/export` with `ids` is
 * what the ticked-rows download already calls.)
 *
 * EVERY ACTION IS GATED THE WAY ITS SINGLE-ORDER EQUIVALENT IS, and that is the
 * rule this file now states explicitly rather than approximating. Before LP.9 it
 * approximated: everything except `status` required `seesWholeBook`, which made
 * bulk `classify` STRICTER than `POST /orders/[id]/classify` — an agent could
 * mark one of their own orders fake and not fifty. `ACTION_RULES` names the
 * permission and the manager requirement per action, taken from the route that
 * already does that one thing to one order.
 *
 * THE CARRIER IS ASKED AFTER THE TRANSACTION COMMITS (D-LP.5.1), which is why
 * the two booking actions are a second phase rather than another branch in the
 * loop. `withTenant` opens a 15-second interactive transaction; fifty parcels
 * is fifty times three HTTP round trips to somebody else's server, and holding
 * a pinned connection across them would time out and roll back — including the
 * `carrierCode` writes `sendToDelivery` had already made.
 * ========================================================================== */

const BULK_ACTIONS = [
  "status", "delete", "assign", "classify",
  "assignFollowup", "createShipments", "sendToDelivery",
] as const;

type BulkAction = (typeof BULK_ACTIONS)[number];

/**
 * What each action needs, copied from the single-order route that performs it.
 *
 * `manager` means `seesWholeBook` — the same predicate `buildPatch` uses to
 * decide whether a reassignment is a 403, and the same one `DELETE
 * /orders/[id]` checks. `permission` is an ADDITIONAL permission beyond the
 * `erp:orders:write` this route is already gated on.
 */
const ACTION_RULES: Record<BulkAction, { permission?: string; manager: boolean }> = {
  // AGENT_WRITABLE, and `mayTouchOrder` per id does the rest.
  status: { manager: false },
  // `POST /orders/[id]/classify` is `erp:orders:write` + ownership. No more.
  classify: { manager: false },
  // `DELETE /orders/[id]` refuses anyone `seesWholeBook` is false for.
  delete: { manager: true },
  // `agentUserId` is a REASSIGNMENT field — 403 FORBIDDEN_FIELD otherwise.
  assign: { manager: true },
  // `followupUserId` is the other one.
  assignFollowup: { manager: true },
  // `POST /orders/[id]/shipment` is `erp:shipments:write` + ownership, and an
  // agent booking a parcel for their own confirmed order is ordinary work.
  createShipments: { permission: "erp:shipments:write", manager: false },
  // The same, plus writing `carrierCode`, which is MANAGER_WRITABLE.
  sendToDelivery: { permission: "erp:shipments:write", manager: true },
};

const Bulk = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
  action: z.enum(BULK_ACTIONS),
  value: z.string().trim().max(64).optional(),
  // Only `classify` reads these, and they are the same two fields
  // `POST /orders/[id]/classify` accepts — a bulk mark with no reason is the
  // one that gets disputed later.
  reason: z.string().trim().max(500).optional(),
  responsible: z.string().trim().max(120).optional(),
});

interface Outcome {
  id: string;
  ok: boolean;
  error?: string;
  followupUserId?: string | null;
  shipmentId?: string;
  trackingNumber?: string | null;
}

export const POST = tenantRoute("erp:orders:write", async ({ db, req, session, afterCommit }) => {
  const parsed = Bulk.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { ids, action, value } = parsed.data;

  if (action === "status" && !ORDER_STATUSES.includes(value as (typeof ORDER_STATUSES)[number])) {
    return apiError(422, "INVALID_INPUT", `"${value}" is not a valid status.`);
  }
  if (action === "classify" && !CLASSIFICATIONS.includes((value ?? "") as (typeof CLASSIFICATIONS)[number])) {
    return apiError(422, "INVALID_CLASSIFICATION", `"${value}" is not a classification.`, {
      valid: [...CLASSIFICATIONS],
    });
  }

  const rule = ACTION_RULES[action];
  if (rule.manager && !seesWholeBook(session)) {
    return apiError(403, "FORBIDDEN", "You do not have access to this.");
  }
  if (rule.permission && !can(session.auth!, rule.permission)) {
    return apiError(403, "FORBIDDEN", "You do not have access to this.");
  }

  const booking = action === "createShipments" || action === "sendToDelivery";
  if (booking && ids.length > BULK_BOOK_LIMIT) {
    return apiError(
      422,
      "TOO_MANY_ROWS",
      `A booking run is limited to ${BULK_BOOK_LIMIT} orders. Narrow the selection and repeat.`,
      { total: ids.length, limit: BULK_BOOK_LIMIT },
    );
  }

  const tenantId = session.auth!.tenantId;
  const results: Outcome[] = [];
  /** Ids that survived the ownership check and still need a carrier call. */
  const toBook: string[] = [];

  // Sequential rather than Promise.all. These are writes on one interactive
  // transaction — the one `withTenant` opened — and issuing two hundred of them
  // concurrently on a single pinned connection is how P2028 timeouts start.
  for (const id of ids) {
    const order = await db.fulfillmentOrder.findUnique({
      where: { id },
      select: { id: true, agentUserId: true, followupUserId: true, status: true },
    });
    if (!order || !mayTouchOrder(session, order)) {
      results.push({ id, ok: false, error: "not found" });
      continue;
    }

    try {
      if (action === "delete") {
        // The customer record is deliberately left alone. A customer's identity
        // and lifetime history outlive any individual order.
        await db.fulfillmentOrder.delete({ where: { id } });
        results.push({ id, ok: true });
      } else if (action === "status") {
        await updateOrder(db, tenantId, id, { status: value! });
        results.push({ id, ok: true });
      } else if (action === "assign") {
        await updateOrder(db, tenantId, id, { agentUserId: value || null });
        results.push({ id, ok: true });
      } else if (action === "classify") {
        // The same write `POST /orders/[id]/classify` makes, field for field.
        // A bulk mark that recorded no reason and no timestamp would be a
        // second, weaker version of the same record.
        const mark = value || "";
        await db.fulfillmentOrder.update({
          where: { id },
          data: {
            classification: mark,
            fakeReason: mark ? (parsed.data.reason ?? "") : null,
            fakeResponsible: mark ? (parsed.data.responsible ?? "") : null,
            fakeAt: mark ? new Date() : null,
          },
        });
        results.push({ id, ok: true });
      } else if (action === "assignFollowup") {
        // An empty value means AUTO — the legacy's `auto: !value`. Both halves
        // go through one function so a manual pick and an automatic one write
        // the same two columns and the same audit row.
        const chosen = await assignFollowupAgent(db, tenantId, id, {
          userId: value || null,
          actorUserId: session.user.id,
        });
        results.push({ id, ok: chosen !== null, followupUserId: chosen, ...(chosen === null ? { error: "nobody eligible" } : {}) });
      } else {
        // Both booking actions. `sendToDelivery` stamps the carrier first —
        // inside the transaction, because it is an ordinary column write — and
        // the parcel is booked in the phase below.
        if (action === "sendToDelivery" && value) {
          await updateOrder(db, tenantId, id, { carrierCode: value });
        }
        toBook.push(id);
      }
    } catch {
      results.push({ id, ok: false, error: "failed" });
    }
  }

  if (!booking) {
    return apiOk({
      action,
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      results,
    });
  }

  afterCommit(async () => {
    // Sequential, and deliberately so: a carrier is somebody else's server and
    // fifty concurrent bookings is how a tenant gets rate-limited off it. It is
    // also why `BULK_BOOK_LIMIT` exists — the caller is waiting for this.
    for (const id of toBook) {
      const outcome = await bookShipment(tenantId, id);
      if (outcome.shipment) {
        results.push({
          id,
          ok: true,
          shipmentId: outcome.shipment.id,
          trackingNumber: outcome.shipment.trackingNumber ?? null,
        });
      } else {
        // The carrier's own refusal code, per id. "Forty-nine booked, one has a
        // misspelled wilaya" is a one-minute fix; "one failed" is not.
        results.push({ id, ok: false, error: outcome.error ?? "NO_CARRIER" });
      }
    }

    return apiOk({
      action,
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      results,
    });
  });

  // Replaced by the step above in every ordinary case. Reached only if it threw
  // — which `tenantRoute` logs — and a run whose outcome is unknown must not
  // read as one that succeeded.
  return apiError(502, "CARRIER_UNREACHABLE", "The carrier could not be reached.");
});
