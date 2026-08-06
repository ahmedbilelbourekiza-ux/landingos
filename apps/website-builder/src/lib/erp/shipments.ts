import "server-only";

import { withTenant, type Prisma, type TenantDb } from "@landingos/db";

import {
  CarrierError,
  getAdapter,
  mapCarrierStatus,
  TERMINAL,
  type BookingRequest,
  type BookingResult,
  type CarrierAdapter,
  type CarrierConfig,
  type TrackingEvent,
} from "./carriers";
import { syncClientFromOrder } from "./clients";
import { raiseFollowupTask } from "./followup";
import { notifyDeliveryUpdate, notifyFollowupRaised, notifyShipmentFailed } from "./notify";

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
 *
 * -----------------------------------------------------------------------------
 * D-LP.5.1 — THREE PHASES, BECAUSE A CARRIER IS NOT A DATABASE
 *
 * Every carrier interaction here is split into PLAN, CALL and RECORD. Plan and
 * record run inside a tenant-bound transaction; the call runs inside none.
 *
 * Until LP.5 all three happened in one transaction, and that was harmless only
 * because the single registered adapter was a synchronous simulator. With a
 * real carrier it is a data-integrity problem, not a performance one:
 * `withTenant` opens an interactive transaction with a 15-second timeout
 * (TX_OPTIONS), a ZR Express booking is three HTTP round trips to somebody
 * else's server, and the booking is triggered BY A CONFIRMATION. A slow carrier
 * would therefore roll back the fact that an agent rang a customer and the
 * customer said yes — losing the work, the call record and the stock movement
 * to a third party being busy.
 *
 * The three phases are separate exported functions rather than one closure so
 * that both callers — the route and the scheduled poll — compose the SAME
 * ingest, which is the property `ingestEvents` exists to hold.
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

/** Everything the carrier call needs, read once inside a transaction. */
export interface BookingPlan {
  readonly orderId: string;
  readonly carrierId: string;
  readonly adapter: CarrierAdapter;
  readonly config: CarrierConfig;
  readonly request: BookingRequest;
}

export type BookingRefusal = "NO_CARRIER" | "UNKNOWN_ADAPTER" | "NOT_FOUND";

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
  return mapCarrierStatus(adapterKey, originalStatus);
}

/* -----------------------------------------------------------------------------
 * Booking — plan, call, record
 * -------------------------------------------------------------------------- */

/**
 * Read everything the carrier needs, and decide whether there is anything to do.
 *
 * `existing` is not an error: booking is idempotent, and a second call for an
 * order that already has a parcel returns the parcel. Two shipments for one
 * order means two parcels and one customer paying once.
 *
 * THE SECRETS ARE SELECTED HERE AND NOWHERE ELSE. They are handed to the
 * adapter and never returned to a caller, never logged and never serialised —
 * `maskCarrier` governs every path that leaves this process.
 */
export async function planShipment(
  db: TenantDb,
  orderId: string,
): Promise<
  | { readonly kind: "exists"; readonly shipment: Prisma.ShipmentGetPayload<{ select: typeof SHIPMENT_SELECT }> }
  | { readonly kind: "refused"; readonly error: BookingRefusal }
  | { readonly kind: "plan"; readonly plan: BookingPlan }
> {
  const existing = await db.shipment.findFirst({
    where: { orderId },
    select: SHIPMENT_SELECT,
  });
  if (existing) return { kind: "exists", shipment: existing };

  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, reference: true, carrierCode: true,
      client: true, phone: true, wilaya: true, commune: true,
      product: true, quantity: true, price: true,
      shippingNote: true, note: true, expressDelivery: true,
    },
  });
  if (!order) return { kind: "refused", error: "NOT_FOUND" };

  const carrier = order.carrierCode
    ? await db.carrier.findFirst({
        where: { code: order.carrierCode, active: true },
        select: { id: true, adapter: true, apiUrl: true, apiKey: true, secretKey: true, webhookSecret: true },
      })
    : await db.carrier.findFirst({
        where: { isDefault: true, active: true },
        select: { id: true, adapter: true, apiUrl: true, apiKey: true, secretKey: true, webhookSecret: true },
      });
  if (!carrier) return { kind: "refused", error: "NO_CARRIER" };

  // Refused, never mocked. Booking through a fallback adapter fabricates a
  // tracking number the carrier has never heard of and answers 201, and an
  // order that booked successfully is one nobody looks at again. See the note
  // on `getAdapter`.
  const adapter = getAdapter(carrier.adapter);
  if (!adapter) return { kind: "refused", error: "UNKNOWN_ADAPTER" };

  return {
    kind: "plan",
    plan: {
      orderId: order.id,
      carrierId: carrier.id,
      adapter,
      config: {
        apiUrl: carrier.apiUrl,
        apiKey: carrier.apiKey,
        secretKey: carrier.secretKey,
        webhookSecret: carrier.webhookSecret,
      },
      request: {
        orderId: order.id,
        reference: order.reference,
        client: order.client,
        phone: order.phone,
        wilaya: order.wilaya,
        commune: order.commune,
        // The delivery instruction, then the general note. Both are free text a
        // courier reads at the door.
        address: order.shippingNote || order.note || "",
        product: order.product,
        quantity: Number(order.quantity) || 1,
        // As a STRING, all the way to the wire. M-06 made these `numeric`; a
        // JS double on the way to a carrier that collects cash gives that back.
        price: order.price ? order.price.toString() : "0",
        express: order.expressDelivery === true,
      },
    },
  };
}

/**
 * Ask the carrier for a parcel. NO DATABASE, ON PURPOSE.
 *
 * This is the phase that must not hold a transaction. It takes no `db` so that
 * a future caller cannot accidentally give it one.
 */
export function bookAtCarrier(plan: BookingPlan): Promise<BookingResult> {
  return plan.adapter.createShipment(plan.request, plan.config);
}

/**
 * Store what the carrier said.
 *
 * Re-checks for an existing shipment, and the database checks again underneath:
 * the transaction that planned this booking has been committed and released, so
 * two operators pressing the button at the same moment can both reach the
 * carrier. The read below catches the ordinary case; `@@unique([tenantId,
 * orderId])` catches the one where both reads happened before either write.
 * A `findFirst` before a `create` is not a guard, it is a hope.
 */
export async function recordShipment(
  db: TenantDb,
  tenantId: string,
  plan: BookingPlan,
  booked: BookingResult,
) {
  const existing = await db.shipment.findFirst({
    where: { orderId: plan.orderId },
    select: SHIPMENT_SELECT,
  });
  if (existing) return { shipment: existing, created: false };

  const crmStatus = await resolveStatus(db, plan.carrierId, plan.adapter.key, booked.originalStatus);

  const shipment = await db.shipment.create({
    data: {
      tenantId,
      orderId: plan.orderId,
      carrierId: plan.carrierId,
      trackingNumber: booked.trackingNumber,
      carrierShipmentId: booked.carrierShipmentId,
      // What the CARRIER will echo back. For ZR that is our order id, and it is
      // the only way a parcel booked without a tracking number can be matched to
      // the webhook that finally brings one.
      carrierReference: booked.carrierReference || plan.orderId,
      crmStatus,
      originalStatus: booked.originalStatus,
      labelUrl: booked.labelUrl || null,
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
    where: { id: plan.orderId },
    data: {
      shipmentId: shipment.id,
      trackingNumber: booked.trackingNumber,
      deliveryStatus: crmStatus,
      carrierId: plan.carrierId,
    },
  });

  return { shipment, created: true };
}

export interface BookingOutcome {
  readonly shipment: Prisma.ShipmentGetPayload<{ select: typeof SHIPMENT_SELECT }> | null;
  readonly created: boolean;
  readonly error?: BookingRefusal | "CARRIER_REJECTED" | "ADDRESS_UNRESOLVED" | "CARRIER_UNREACHABLE";
  readonly message?: string;
}

/**
 * Book a parcel, holding no transaction while the carrier is being asked.
 *
 * The one entry point for booking. Two bindings with the network call between
 * them, so a slow carrier costs a slow response and nothing else.
 *
 * A CARRIER REFUSAL IS TOLD, NEVER SWALLOWED. The legacy CRM caught this throw
 * and pushed a `shipment_failed` notification so the order appeared with the
 * reason on it — an unbooked parcel is invisible otherwise, and "the wilaya is
 * misspelled" is a one-minute fix that nobody can make if nobody is told.
 */
export async function bookShipment(tenantId: string, orderId: string): Promise<BookingOutcome> {
  const planned = await withTenant(tenantId, (db) => planShipment(db, orderId));

  if (planned.kind === "exists") return { shipment: planned.shipment, created: false };
  if (planned.kind === "refused") return { shipment: null, created: false, error: planned.error };

  let booked: BookingResult;
  try {
    booked = await bookAtCarrier(planned.plan);
  } catch (error) {
    const failure =
      error instanceof CarrierError
        ? { code: error.code, message: error.message }
        : { code: "CARRIER_UNREACHABLE" as const, message: "The carrier could not be reached." };

    console.error(`[erp] booking failed for order ${orderId}: ${failure.message}`);
    await withTenant(tenantId, async (db) => {
      const order = await db.fulfillmentOrder.findUnique({
        where: { id: orderId },
        select: { id: true, reference: true, agentUserId: true, followupUserId: true },
      });
      if (order) await notifyShipmentFailed(db, tenantId, order, failure.message);
    });

    return { shipment: null, created: false, error: failure.code, message: failure.message };
  }

  try {
    return await withTenant(tenantId, (db) => recordShipment(db, tenantId, planned.plan, booked));
  } catch (error) {
    // Somebody else booked this order while the carrier was answering us. The
    // `@@unique([tenantId, orderId])` on Shipment is what turned that from two
    // rows into this error, and it is the point: a unique violation ABORTS the
    // Postgres transaction, so the recovery has to be a fresh binding rather
    // than a catch inside the one that failed.
    //
    // The parcel we just booked at the carrier is real and is now orphaned —
    // which is the honest cost of asking a third party outside a transaction,
    // and is why the console's button disables while it is pending. What must
    // not happen is a second shipment row, and it cannot.
    if (!isUniqueViolation(error)) throw error;

    console.warn(`[erp] a concurrent booking won for order ${orderId}; this parcel is orphaned at the carrier`);
    const shipment = await withTenant(tenantId, (db) =>
      db.shipment.findFirst({ where: { orderId }, select: SHIPMENT_SELECT }),
    );
    return { shipment, created: false };
  }
}

/** P2002 — the unique constraint, whichever client shape reports it. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

/* -----------------------------------------------------------------------------
 * Intake
 * -------------------------------------------------------------------------- */

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
      const raised = await raiseFollowupTask(db, tenantId, shipment.orderId, trigger);

      // M-16. The parcel moved, so somebody is told — and which of the two
      // messages it is depends on whether a person now has to act. BUG-04 was
      // that this notification, the one the console is built to render, never
      // arrived at all.
      const order = await db.fulfillmentOrder.findUnique({
        where: { id: shipment.orderId },
        select: { id: true, reference: true, agentUserId: true, followupUserId: true },
      });
      if (order) {
        if (raised?.created) {
          await notifyFollowupRaised(
            db, tenantId, order,
            (trigger.description || trigger.originalStatus || latest).trim(),
            order.followupUserId,
          );
        } else {
          await notifyDeliveryUpdate(db, tenantId, order, latest);
        }
      }
    }
  }

  await settleOutcome(db, tenantId, shipment.orderId, shipment.id);
  return { stored, latest };
}

/**
 * Write the tracking number a carrier finally issued.
 *
 * ZR Express books a parcel and assigns its tracking number afterwards, so a
 * ZR shipment exists for a while with an empty one. Written ONCE, and only onto
 * a shipment that has none: a carrier correcting a number it already gave would
 * silently orphan every event already filed under the old one, and the parcel
 * is found by `carrierReference` in that case anyway.
 */
export async function recordTrackingNumber(
  db: TenantDb,
  shipment: { id: string; orderId: string; trackingNumber: string | null },
  trackingNumber: string,
): Promise<boolean> {
  if (!trackingNumber || shipment.trackingNumber) return false;

  const { count } = await db.shipment.updateMany({
    // Guarded in the WHERE as well as read above, so two deliveries of the same
    // first webhook cannot both write.
    where: { id: shipment.id, OR: [{ trackingNumber: null }, { trackingNumber: "" }] },
    data: { trackingNumber },
  });
  if (count === 0) return false;

  await db.fulfillmentOrder.update({
    where: { id: shipment.orderId },
    data: { trackingNumber },
  });
  return true;
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

/* -----------------------------------------------------------------------------
 * Refreshing — plan, call, record
 * -------------------------------------------------------------------------- */

export interface RefreshPlan {
  readonly shipment: { id: string; orderId: string; carrierId: string | null; crmStatus: string | null; trackingNumber: string | null; createdAt: Date };
  readonly adapterKey: string | null;
  readonly adapter: CarrierAdapter;
  readonly config: CarrierConfig;
  readonly stepsSeen: number;
}

export type RefreshRefusal = "NOT_FOUND" | "UNKNOWN_ADAPTER" | "NO_POLLING";

type ShipmentRow = Prisma.ShipmentGetPayload<{ select: typeof SHIPMENT_SELECT }>;
type EventRow = Prisma.ShipmentEventGetPayload<{ select: typeof EVENT_SELECT }>;

/**
 * What a refresh answers with, whether or not the carrier was reachable.
 *
 * `error` is optional and always present in the type, so a caller cannot forget
 * to branch on it — the stored state comes back either way, because "we could
 * not ask" still has to render the timeline that already exists.
 */
export interface RefreshOutcome {
  readonly shipment: ShipmentRow | null;
  readonly events: readonly EventRow[];
  readonly error?: Exclude<RefreshRefusal, "NOT_FOUND"> | "CARRIER_REJECTED" | "ADDRESS_UNRESOLVED" | "CARRIER_UNREACHABLE";
  readonly message?: string;
}

export async function planRefresh(
  db: TenantDb,
  orderId: string,
): Promise<
  | { readonly kind: "refused"; readonly error: RefreshRefusal }
  | { readonly kind: "plan"; readonly plan: RefreshPlan }
> {
  const shipment = await db.shipment.findFirst({
    where: { orderId },
    select: {
      id: true, orderId: true, carrierId: true, crmStatus: true,
      trackingNumber: true, createdAt: true,
      carrier: {
        select: { adapter: true, apiUrl: true, apiKey: true, secretKey: true, webhookSecret: true },
      },
    },
  });
  if (!shipment) return { kind: "refused", error: "NOT_FOUND" };

  const adapter = getAdapter(shipment.carrier?.adapter ?? null);

  // Nothing to ask, so nothing is invented. Polling through a fallback adapter
  // would walk a REAL parcel along the mock's synthetic pipeline and settle its
  // outcome — booking revenue for a delivery that may not have happened.
  if (!adapter) return { kind: "refused", error: "UNKNOWN_ADAPTER" };

  // A carrier that only pushes says so. LP.2's rule applied to the other side
  // of the same question: "the carrier has no news" and "this carrier cannot be
  // asked" are different facts, and answering 200 with an unchanged timeline
  // states the first when the second is true. ZR Express is exactly this — it
  // publishes no tracking endpoint at all.
  if (!adapter.canPoll) return { kind: "refused", error: "NO_POLLING" };

  // How far the parcel has come is derived from the events on record, not from
  // process memory. See the note in carriers.ts.
  const stepsSeen = await db.shipmentEvent.count({ where: { shipmentId: shipment.id } });

  const { carrier, ...rest } = shipment;
  return {
    kind: "plan",
    plan: {
      shipment: rest,
      adapterKey: carrier?.adapter ?? null,
      adapter,
      config: {
        apiUrl: carrier?.apiUrl ?? null,
        apiKey: carrier?.apiKey ?? null,
        secretKey: carrier?.secretKey ?? null,
        webhookSecret: carrier?.webhookSecret ?? null,
      },
      stepsSeen,
    },
  };
}

/** Ask the carrier. NO DATABASE, for the reason at the top of this file. */
export function fetchTracking(plan: RefreshPlan): Promise<TrackingEvent[]> {
  return plan.adapter.track(
    plan.shipment.trackingNumber ?? "",
    // The booking time anchors the event times, so re-polling a parcel produces
    // the same keys and stores nothing the second time.
    { stepsSeen: plan.stepsSeen, bookedAt: plan.shipment.createdAt },
    plan.config,
  );
}

/** Resolve every reported status through the tenant's mappings, then ingest. */
export async function ingestReported(
  db: TenantDb,
  tenantId: string,
  plan: RefreshPlan,
  reported: readonly TrackingEvent[],
): Promise<void> {
  const events: TrackingEvent[] = [];
  for (const event of reported) {
    events.push({
      ...event,
      // The adapter's own guess is the fallback, not the answer.
      crmStatus: await resolveStatus(db, plan.shipment.carrierId, plan.adapterKey, event.originalStatus),
    });
  }

  await ingestEvents(db, tenantId, plan.shipment, events);
}

async function readShipment(db: TenantDb, shipmentId: string): Promise<RefreshOutcome> {
  const [shipment, events] = await Promise.all([
    db.shipment.findUnique({ where: { id: shipmentId }, select: SHIPMENT_SELECT }),
    db.shipmentEvent.findMany({
      where: { shipmentId },
      orderBy: [{ eventTime: "asc" }, { id: "asc" }],
      select: EVENT_SELECT,
    }),
  ]);
  return { shipment, events };
}

/**
 * Poll the carrier and ingest whatever it reports — for a caller that already
 * holds a tenant binding.
 *
 * IT REPORTS ONLY WHETHER IT COULD ASK, because that is all the poll uses and
 * because the poll is the one caller with 25 parcels inside one 15-second
 * transaction. Reading the shipment and its whole timeline back per parcel — the
 * shape the manual route wants — cost enough queries at that batch size to trip
 * the timeout, which surfaces as a 500 from the job rather than as anything that
 * names the real reason.
 *
 * THE SCHEDULED POLL USES THIS, and it is the one place a carrier call still
 * happens inside a transaction. It is bounded by `POLL_BATCH` and is why that
 * number is 25 rather than 200. Moving it out means `runJob` stops receiving a
 * bound `db` and starts opening its own bindings per parcel, which is a change
 * to the job runner and both of its routes — recorded as N17 and grouped with
 * the Ecom adapter, the first registered carrier that can actually be polled.
 * ZR cannot (`canPoll: false`), so nothing registered today reaches a network
 * from here.
 */
export async function refreshShipment(
  db: TenantDb,
  tenantId: string,
  orderId: string,
): Promise<{ error?: Exclude<RefreshRefusal, "NOT_FOUND"> } | null> {
  const planned = await planRefresh(db, orderId);
  if (planned.kind === "refused") {
    return planned.error === "NOT_FOUND" ? null : { error: planned.error };
  }

  const reported = await fetchTracking(planned.plan);
  await ingestReported(db, tenantId, planned.plan, reported);
  return {};
}

/**
 * Poll the carrier without holding a transaction while it is being asked.
 *
 * What the manual "ask the carrier" control uses. Same three phases, same
 * ingest, two bindings instead of one.
 */
export async function refreshShipmentForOrder(
  tenantId: string,
  orderId: string,
): Promise<RefreshOutcome | null> {
  const planned = await withTenant(tenantId, (db) => planRefresh(db, orderId));

  if (planned.kind === "refused") {
    if (planned.error === "NOT_FOUND") return null;
    const state = await withTenant(tenantId, async (db) => {
      const row = await db.shipment.findFirst({ where: { orderId }, select: { id: true } });
      return row ? readShipment(db, row.id) : null;
    });
    return { shipment: state?.shipment ?? null, events: state?.events ?? [], error: planned.error };
  }

  let reported: TrackingEvent[];
  try {
    reported = await fetchTracking(planned.plan);
  } catch (error) {
    const message = error instanceof CarrierError ? error.message : "The carrier could not be reached.";
    console.error(`[erp] tracking refresh failed for order ${orderId}: ${message}`);
    const state = await withTenant(tenantId, (db) => readShipment(db, planned.plan.shipment.id));
    return {
      shipment: state.shipment,
      events: state.events,
      error: error instanceof CarrierError ? error.code : "CARRIER_UNREACHABLE",
      message,
    };
  }

  return withTenant(tenantId, async (db) => {
    await ingestReported(db, tenantId, planned.plan, reported);
    return readShipment(db, planned.plan.shipment.id);
  });
}

export { SHIPMENT_SELECT };
