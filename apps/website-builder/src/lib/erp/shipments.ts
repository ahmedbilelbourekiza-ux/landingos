import "server-only";

import type { Prisma, TenantDb } from "@landingos/db";

import { getAdapter, TERMINAL, type TrackingEvent } from "./carriers";
import { syncClientFromOrder } from "./clients";
import { raiseFollowupTask } from "./followup";

/* =============================================================================
 * Shipments, and the settlement that BUG-02 was about.
 *
 * `deliveryOutcome` and `deliveryOutcomeAt` were READ in eight places in the
 * ERP and WRITTEN in none. Nothing errored. The profit calculator,
 * delivered-pay payroll, customer lifetime spend and product revenue were all
 * permanently zero, and every screen rendered perfectly while showing a company
 * that had apparently never sold anything.
 *
 * This file is the write. Everything downstream — the four things listed above —
 * already reads the column and needs no further change, which is exactly why
 * the defect was invisible for so long.
 * ========================================================================== */

const SHIPMENT_SELECT = {
  id: true, orderId: true, carrierId: true, trackingNumber: true,
  carrierShipmentId: true, carrierReference: true,
  crmStatus: true, originalStatus: true, labelUrl: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.ShipmentSelect;

export const EVENT_SELECT = {
  id: true, eventTime: true, originalStatus: true, crmStatus: true,
  description: true, insertedAt: true,
} satisfies Prisma.ShipmentEventSelect;

/** Resolve a carrier status through this tenant's mappings, then the adapter. */
async function resolveStatus(
  db: TenantDb,
  carrierId: string | null,
  adapterKey: string | null,
  originalStatus: string,
): Promise<string> {
  if (carrierId) {
    // The tenant's own mapping wins. A carrier's wording is not standardised
    // and a company that has told us "Livré au client" means delivered must not
    // be overridden by a guess.
    const mapping = await db.carrierStatusMapping.findFirst({
      where: { carrierId, originalStatus },
      select: { crmStatus: true },
    });
    if (mapping?.crmStatus) return mapping.crmStatus;
  }
  return getAdapter(adapterKey).mapStatus(originalStatus);
}

/**
 * Book a parcel with the carrier and record it.
 *
 * Refuses a second shipment for an order that already has one. Two shipments
 * for one order means two parcels, and the customer is charged once.
 */
export async function createShipment(
  db: TenantDb,
  tenantId: string,
  order: { id: string; carrierCode: string | null },
) {
  const existing = await db.shipment.findFirst({
    where: { orderId: order.id },
    select: SHIPMENT_SELECT,
  });
  if (existing) return { shipment: existing, created: false };

  const carrier = order.carrierCode
    ? await db.carrier.findFirst({
        where: { code: order.carrierCode, active: true },
        select: { id: true, adapter: true },
      })
    : await db.carrier.findFirst({
        where: { isDefault: true, active: true },
        select: { id: true, adapter: true },
      });
  if (!carrier) return { shipment: null, created: false, error: "NO_CARRIER" as const };

  const adapter = getAdapter(carrier.adapter);
  const booked = adapter.createShipment(order.id);
  const crmStatus = await resolveStatus(db, carrier.id, carrier.adapter, booked.originalStatus);

  const shipment = await db.shipment.create({
    data: {
      tenantId,
      orderId: order.id,
      carrierId: carrier.id,
      trackingNumber: booked.trackingNumber,
      carrierShipmentId: booked.carrierShipmentId,
      carrierReference: order.id,
      crmStatus,
      originalStatus: booked.originalStatus,
    },
    select: SHIPMENT_SELECT,
  });

  await db.shipmentEvent.create({
    data: {
      tenantId,
      shipmentId: shipment.id,
      eventTime: shipment.createdAt,
      originalStatus: booked.originalStatus,
      crmStatus,
      description: booked.description,
    },
  });

  // The order carries the tracking number so the list can show it without a
  // join, and the shipment id so the per-order screen can find it.
  await db.fulfillmentOrder.update({
    where: { id: order.id },
    data: {
      shipmentId: shipment.id,
      trackingNumber: booked.trackingNumber,
      deliveryStatus: crmStatus,
      carrierId: carrier.id,
    },
  });

  return { shipment, created: true };
}

/**
 * Store carrier events, then settle the outcome if one of them is terminal.
 *
 * INTAKE IS IDEMPOTENT. The unique on (tenant, shipment, eventTime,
 * originalStatus) is what makes it so, and it is load-bearing: carriers replay
 * backlogs, and without it a replayed day doubles every event in the timeline.
 * Duplicates are swallowed rather than raised — a re-sent event is normal
 * traffic, not an error.
 */
export async function ingestEvents(
  db: TenantDb,
  tenantId: string,
  shipment: { id: string; orderId: string; carrierId: string | null; crmStatus: string | null },
  events: readonly TrackingEvent[],
): Promise<{ stored: number; latest: string | null }> {
  // `skipDuplicates` compiles to ON CONFLICT DO NOTHING, and that is the only
  // workable shape here. Inserting one at a time and catching P2002 looks
  // equivalent and is not: a unique violation ABORTS the surrounding Postgres
  // transaction, so every statement after the first duplicate fails with 25P02
  // — including the ones this function still has to run. `withTenant` has
  // already opened that transaction, so there is no smaller scope to lose.
  const result = await db.shipmentEvent.createMany({
    data: events.map((event) => ({
      tenantId,
      shipmentId: shipment.id,
      eventTime: event.eventTime,
      originalStatus: event.originalStatus,
      crmStatus: event.crmStatus,
      description: event.description,
    })),
    skipDuplicates: true,
  });

  const stored = result.count;
  // The newest reported status, whether or not this poll was the one that
  // stored it — a re-sent history still tells us where the parcel is.
  const latest = events.length ? events[events.length - 1].crmStatus : shipment.crmStatus;

  if (latest && latest !== shipment.crmStatus) {
    await db.shipment.update({ where: { id: shipment.id }, data: { crmStatus: latest } });
    await db.fulfillmentOrder.update({
      where: { id: shipment.orderId },
      data: { deliveryStatus: latest },
    });

    // Phase 6.5a — the follow-up module's producer, on the ONE choke point every
    // carrier update passes through: this function serves both the poll and the
    // inbound webhook, so attaching here means neither path can raise a task the
    // other does not.
    //
    // Only on a TRANSITION, which is stricter than the ERP was and deliberately
    // so. The ERP raised from any report and relied on "one open task per order"
    // to dedupe, which re-raised after an agent had resolved one whenever the
    // carrier replayed its history. Entering a problem state is the event worth
    // ringing somebody about; being told again that the parcel is still in that
    // state is not.
    const trigger = events.length ? events[events.length - 1] : null;
    if (trigger) {
      await raiseFollowupTask(db, tenantId, shipment.orderId, trigger);
    }
  }

  await settleOutcome(db, tenantId, shipment.orderId, shipment.id);
  return { stored, latest };
}

/**
 * Write `deliveryOutcome` once, from the carrier's own event time.
 *
 * SETTLED ONCE, PERMANENTLY. More polls keep arriving after a parcel is
 * delivered; the value and the moment must not move. An order already carrying
 * an outcome is left alone even if later events say something else — the ERP
 * asserted this directly, and it is what stops a carrier's corrected feed
 * silently rewriting last quarter's revenue.
 *
 * THE MOMENT COMES FROM THE EVENT, NOT THE CLOCK. Stamping "now" loses the only
 * trustworthy fact in the record: when the parcel actually arrived. A backlog
 * replayed a week late would otherwise book every one of those deliveries into
 * the wrong period.
 */
async function settleOutcome(
  db: TenantDb,
  tenantId: string,
  orderId: string,
  shipmentId: string,
): Promise<void> {
  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: {
      deliveryOutcome: true, status: true, price: true, phone: true,
      client: true, wilaya: true, commune: true, createdAt: true,
    },
  });
  if (!order || order.deliveryOutcome) return;

  const terminal = await db.shipmentEvent.findFirst({
    where: { shipmentId, crmStatus: { in: [...TERMINAL] } },
    orderBy: { eventTime: "asc" },
    select: { crmStatus: true, eventTime: true },
  });
  // `cancelled` is terminal for the parcel but is not a commercial outcome:
  // nothing was delivered and nothing was returned, so there is nothing to
  // settle and the order stays open for a re-ship.
  if (!terminal?.crmStatus || terminal.crmStatus === "cancelled") return;

  await db.fulfillmentOrder.update({
    where: { id: orderId },
    data: {
      deliveryOutcome: terminal.crmStatus,
      deliveryOutcomeAt: terminal.eventTime,
    },
  });

  // The four things that read this column start working here — customer
  // lifetime spend first, in the same transaction so it cannot drift.
  await syncClientFromOrder(
    db,
    tenantId,
    { ...order, deliveryOutcome: null },
    { ...order, deliveryOutcome: terminal.crmStatus },
  );
}

/** Poll the carrier and ingest whatever it reports. */
export async function refreshShipment(db: TenantDb, tenantId: string, orderId: string) {
  const shipment = await db.shipment.findFirst({
    where: { orderId },
    select: { ...SHIPMENT_SELECT, carrier: { select: { adapter: true } } },
  });
  if (!shipment) return null;

  // How far the parcel has come is derived from the events on record, not from
  // process memory. See the note in carriers.ts.
  const stepsSeen = await db.shipmentEvent.count({ where: { shipmentId: shipment.id } });

  const adapter = getAdapter(shipment.carrier?.adapter ?? null);
  // The booking time anchors the event times, so re-polling a parcel produces
  // the same keys and stores nothing the second time.
  const reported = adapter.track(shipment.trackingNumber ?? "", stepsSeen, shipment.createdAt);

  // Re-resolve through the tenant's mappings: the adapter's own guess is the
  // fallback, not the answer.
  const events: TrackingEvent[] = [];
  for (const event of reported) {
    events.push({
      ...event,
      crmStatus: await resolveStatus(
        db, shipment.carrierId, shipment.carrier?.adapter ?? null, event.originalStatus,
      ),
    });
  }

  await ingestEvents(db, tenantId, shipment, events);

  const after = await db.shipment.findUnique({ where: { id: shipment.id }, select: SHIPMENT_SELECT });
  const stored = await db.shipmentEvent.findMany({
    where: { shipmentId: shipment.id },
    orderBy: [{ eventTime: "asc" }, { id: "asc" }],
    select: EVENT_SELECT,
  });
  return { shipment: after, events: stored };
}

export { SHIPMENT_SELECT };
