import "server-only";

import type { TenantDb } from "@landingos/db";

import { autoAssignFollowup } from "./assign";
import { createShipment } from "./shipments";
import { reserveOnConfirm, releaseOnCancel } from "./inventory";
import type { ErpSettings } from "./settings";

/* =============================================================================
 * What happens when an order becomes confirmed.
 *
 * ONE FUNCTION BECAUSE THERE ARE TWO DOORS. An order reaches `confirmed` either
 * by an agent logging a call result or by somebody setting the status directly,
 * and the ERP learned what happens when those diverge:
 *
 *   > A status change through this generic endpoint (e.g. the quick status
 *   > dropdown in the order list, as opposed to logging a call result via
 *   > /call) must trigger the SAME inventory + shipment side effects — two
 *   > different ways to reach "confirmed" silently behaving differently is
 *   > exactly what caused stock to not move for a manually-confirmed order.
 *                                             — apps/erp/index.js:1685
 *
 * The platform had re-introduced exactly that: `POST /orders/[id]/call` booked
 * the parcel and `PATCH /orders/[id]` did not. Both now call this.
 *
 * NOTHING HERE MAY FAIL THE CONFIRMATION. The agent has just done real work —
 * they rang a customer and the customer said yes — and that has to be recorded
 * whatever the carrier's API or the roster is doing. Each step is therefore
 * caught and LOGGED rather than swallowed: BUG-01 was a job whose only symptom
 * was silence, and a caught exception with no log is the same defect waiting.
 *
 * THE INVENTORY SIDE LIVES HERE TOO — Phase 6.6f. It was never ported in Phase
 * 5: `lib/erp/inventory.ts` had the whole FIFO movement machinery and nothing
 * called it on a status change, so a confirmed order consumed no stock and a
 * cancellation restored none, while `reservationMode` sat on the automation
 * screen being read by nothing. That was the last functional difference between
 * this platform and `apps/erp`.
 * ========================================================================== */

export interface ConfirmResult {
  readonly shipmentBooked: boolean;
  readonly followupUserId: string | null;
  readonly stockLinesMoved: number;
}

/** The order fields both handlers need. */
const CONFIRM_SELECT = {
  id: true, reference: true, carrierCode: true,
  product: true, productVariant: true, quantity: true,
} as const;

export async function onOrderConfirmed(
  db: TenantDb,
  tenantId: string,
  orderId: string,
  settings: ErpSettings,
  actorUserId: string,
): Promise<ConfirmResult> {
  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: CONFIRM_SELECT,
  });

  // Stock first, and before the parcel: a confirmation that cannot be covered
  // is worth knowing about before a carrier has been asked to collect it.
  let stockLinesMoved = 0;
  if (order) {
    try {
      stockLinesMoved = await reserveOnConfirm(
        db, tenantId, order, String(settings.reservationMode ?? "on_confirm"), actorUserId,
      );
    } catch (error) {
      console.error(`[erp] stock reservation failed for order ${orderId}`, error);
    }
  }

  let shipmentBooked = false;

  // Booking here rather than on a timer means the tracking number exists by the
  // time the agent finishes the sentence, which is when the customer asks for it.
  if (settings.autoCreateShipment && order) {
    try {
      const booked = await createShipment(db, tenantId, order);
      shipmentBooked = Boolean(booked.created);
    } catch (error) {
      console.error(`[erp] auto-booking failed for order ${orderId}`, error);
    }
  }

  let followupUserId: string | null = null;
  try {
    followupUserId = await autoAssignFollowup(db, tenantId, orderId, settings);
  } catch (error) {
    console.error(`[erp] follow-up auto-assign failed for order ${orderId}`, error);
  }

  return { shipmentBooked, followupUserId, stockLinesMoved };
}

/**
 * The other side of the same transition.
 *
 * Cancelling a confirmed order gives the stock back — to the same lots the
 * reservation consumed, which is what keeps the cost basis true. Called from
 * both doors, for the same reason `onOrderConfirmed` is.
 */
export async function onOrderCancelled(
  db: TenantDb,
  tenantId: string,
  orderId: string,
  actorUserId: string,
): Promise<{ stockLinesMoved: number }> {
  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: CONFIRM_SELECT,
  });
  if (!order) return { stockLinesMoved: 0 };

  try {
    return { stockLinesMoved: await releaseOnCancel(db, tenantId, order, actorUserId) };
  } catch (error) {
    console.error(`[erp] stock release failed for order ${orderId}`, error);
    return { stockLinesMoved: 0 };
  }
}
