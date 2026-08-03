import "server-only";

import type { TenantDb } from "@landingos/db";

import { autoAssignFollowup } from "./assign";
import { createShipment } from "./shipments";
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
 * WHAT IS DELIBERATELY MISSING: the inventory side. `reserveOnConfirm` /
 * `releaseOnCancel` were never ported in Phase 5 — `lib/erp/inventory.ts` has
 * the movement machinery and nothing calls it on a status change. That is a
 * stated gap, recorded in NEXT_STEPS, not something to invent here: it needs its
 * own contract tests over FIFO lot consumption, which is the part of this
 * codebase most expensive to get wrong.
 * ========================================================================== */

export interface ConfirmResult {
  readonly shipmentBooked: boolean;
  readonly followupUserId: string | null;
}

export async function onOrderConfirmed(
  db: TenantDb,
  tenantId: string,
  orderId: string,
  settings: ErpSettings,
): Promise<ConfirmResult> {
  let shipmentBooked = false;

  // Booking here rather than on a timer means the tracking number exists by the
  // time the agent finishes the sentence, which is when the customer asks for it.
  if (settings.autoCreateShipment) {
    try {
      const order = await db.fulfillmentOrder.findUnique({
        where: { id: orderId },
        select: { id: true, carrierCode: true },
      });
      if (order) {
        const booked = await createShipment(db, tenantId, order);
        shipmentBooked = Boolean(booked.created);
      }
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

  return { shipmentBooked, followupUserId };
}
