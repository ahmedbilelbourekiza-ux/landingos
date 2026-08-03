import "server-only";

import type { Prisma } from "@landingos/db";

import { CARRIER_SECRET_MASK, CARRIER_SECRET_FIELDS } from "./carrier-mask";

/* =============================================================================
 * Carrier adapters.
 *
 * Ported from apps/erp/lib/providers/. Only the `mock` adapter comes across in
 * this slice: it is what the contract tests drive, it needs no network, and the
 * real ones (ZR Express, E-com) are HTTP clients that can follow without
 * changing anything here.
 *
 * THE MOCK'S STATE MOVED, AND IT HAD TO.
 *
 * The ERP held each parcel's progress in a module-level `Map` keyed by tracking
 * number. That is fine for one process with one database. On this platform it
 * is wrong twice over: the map is lost on every deploy, and two server
 * instances would disagree about where the same parcel is. Progress is derived
 * from the stored ShipmentEvent history instead — the parcel is at step N
 * because N events exist, which is true in any process and survives a restart.
 *
 * THE ORIGINAL STATUS IS ALWAYS KEPT.
 *
 * Every event stores what the carrier actually said alongside the CRM status it
 * mapped to. A mapping added later can then be applied to history, instead of
 * history having been flattened on the way in and the original wording lost.
 * ========================================================================== */

export interface PipelineStep {
  readonly crm: string;
  readonly label: string;
  readonly description: string;
}

/** The universal CRM delivery statuses, in the order a parcel passes through them. */
export const PIPELINE: readonly PipelineStep[] = [
  { crm: "created", label: "Création", description: "Colis enregistré chez le transporteur" },
  { crm: "dispatched", label: "Dispatché", description: "Colis dispatché vers le hub régional" },
  { crm: "in_transit", label: "En route", description: "Colis en route vers la wilaya de destination" },
  { crm: "at_office", label: "Au bureau", description: "Colis arrivé au bureau de destination" },
  { crm: "out_for_delivery", label: "Sorti en livraison", description: "Colis sorti en livraison" },
  { crm: "delivered", label: "Livré", description: "Colis livré au client" },
];

/** Statuses a parcel cannot move on from. Settlement happens on exactly these. */
export const TERMINAL = new Set(["delivered", "returned", "cancelled"]);

export interface TrackingEvent {
  readonly crmStatus: string;
  readonly originalStatus: string;
  readonly description: string;
  readonly eventTime: Date;
}

export interface CarrierAdapter {
  readonly key: string;
  readonly label: string;
  readonly canCreateOutbound: boolean;
  createShipment(orderId: string): { trackingNumber: string; carrierShipmentId: string; originalStatus: string; description: string };
  /**
   * Every step up to and including the parcel's current one.
   *
   * `bookedAt` anchors the event times. It must be a fixed point in the
   * parcel's own history — not the wall clock — because intake dedupes on
   * (shipment, eventTime, originalStatus): timestamps derived from `now` make
   * every poll look like a brand-new set of events and the timeline doubles on
   * each refresh. That is not hypothetical; it is what the first version of
   * this adapter did, and the idempotency test caught it.
   */
  track(trackingNumber: string, stepsSeen: number, bookedAt: Date): TrackingEvent[];
  mapStatus(originalStatus: string): string;
}

/**
 * Derived from PIPELINE rather than written out, so the two cannot drift.
 *
 * The ERP had this as `{}` with a comment claiming the mock "already speaks CRM
 * statuses directly" — but createShipment returned the LABEL, not the key, so a
 * brand-new shipment fell through to the keyword fallback and resolved to
 * "pending" instead of "created".
 */
const MOCK_STATUS_MAP: Record<string, string> = Object.fromEntries(
  PIPELINE.map((s) => [s.label, s.crm]),
);

/** Keyword fallback for a carrier status nobody has mapped yet. */
function guessStatus(original: string): string {
  const s = original.toLowerCase();
  if (/livr|deliver/.test(s)) return "delivered";
  if (/retour|return/.test(s)) return "returned";
  if (/annul|cancel/.test(s)) return "cancelled";
  if (/sortie|out for/.test(s)) return "out_for_delivery";
  if (/bureau|office/.test(s)) return "at_office";
  if (/route|transit/.test(s)) return "in_transit";
  if (/dispatch/.test(s)) return "dispatched";
  return "pending";
}

const mock: CarrierAdapter = {
  key: "mock",
  label: "Mock Carrier (simulation)",
  canCreateOutbound: true,

  createShipment(orderId) {
    const trackingNumber =
      "MOCK" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    return {
      trackingNumber,
      carrierShipmentId: `SHP-${trackingNumber}`,
      originalStatus: PIPELINE[0].label,
      description: PIPELINE[0].description,
    };
  },

  /**
   * Advance one step per poll and report the whole history up to it.
   *
   * Re-reporting earlier steps is safe and deliberate: intake is idempotent on
   * (shipment, eventTime, originalStatus), so a fresh shipment shows its full
   * timeline after a poll or two rather than only the newest line. Real
   * carriers behave the same way — they return a history, not a delta.
   */
  track(trackingNumber, stepsSeen, bookedAt) {
    void trackingNumber;
    const target = Math.min(Math.max(stepsSeen, 1), PIPELINE.length - 1);
    const base = bookedAt.getTime();
    return PIPELINE.slice(0, target + 1).map((step, i) => ({
      crmStatus: step.crm,
      originalStatus: step.label,
      description: step.description,
      // Anchored to when the parcel was booked, one SECOND apart.
      //
      // Distinct so they order correctly, and DETERMINISTIC so polling the same
      // parcel twice produces the same key and the second poll stores nothing.
      //
      // The spacing is deliberately tiny. A real carrier's steps are hours
      // apart, but these timestamps are what `deliveryOutcomeAt` is settled
      // from, and everything downstream — payroll, product revenue, the profit
      // calculator — filters by a date range. Spacing a six-step pipeline a
      // minute apart puts "delivered" five minutes into the FUTURE, outside any
      // window ending now, and the parcel settles while every report that reads
      // it still shows zero. That is BUG-02's symptom reproduced by the
      // simulator meant to prove BUG-02 is fixed.
      eventTime: new Date(base + i * 1_000),
    }));
  },

  mapStatus(originalStatus) {
    return MOCK_STATUS_MAP[originalStatus] ?? guessStatus(originalStatus);
  },
};

const ADAPTERS: Record<string, CarrierAdapter> = { mock };

/**
 * The adapter for a carrier, falling back to the mock's contract shape.
 *
 * A missing member used to break shipment creation for every carrier in the
 * dropdown that had no implementation yet — `getAdapter` fell back to a generic
 * adapter and `mapStatus` simply was not there. Every adapter answers the full
 * contract or it is not registered.
 */
export function getAdapter(key: string | null | undefined): CarrierAdapter {
  return ADAPTERS[key ?? ""] ?? mock;
}

export const listAdapters = () =>
  Object.values(ADAPTERS).map((a) => ({ key: a.key, label: a.label, canCreateOutbound: a.canCreateOutbound }));

/* -----------------------------------------------------------------------------
 * Secrets
 * -------------------------------------------------------------------------- */

// From a directive-free module, because the console form needs the same value
// to recognise its own placeholder. See lib/erp/carrier-mask.ts.
const MASK = CARRIER_SECRET_MASK;
const SECRET_FIELDS = CARRIER_SECRET_FIELDS;

/**
 * Replace stored credentials with a mask, and say whether there are any.
 *
 * `_hasCredentials` matters as much as the mask: without it the console cannot
 * tell "no key configured" from "a key is configured and hidden", and shows an
 * empty field either way.
 */
export function maskCarrier<T extends Record<string, unknown>>(carrier: T): T & { _hasCredentials: boolean } {
  const out = { ...carrier } as Record<string, unknown>;
  let has = false;
  for (const field of SECRET_FIELDS) {
    if (out[field]) {
      has = true;
      out[field] = MASK;
    }
  }
  return { ...(out as T), _hasCredentials: has };
}

/**
 * Keep the stored secret when the caller sends the mask back.
 *
 * The failure this prevents is quiet and expensive: the console reads the
 * masked carrier, the user edits the name, the console PUTs the whole object
 * back, and the real API key is replaced with four bullet characters. Nothing
 * errors until the next shipment fails to book, by which time the key is gone.
 */
export function preserveSecrets(
  input: Record<string, unknown>,
): Prisma.CarrierUpdateInput {
  const out: Record<string, unknown> = {};
  for (const field of SECRET_FIELDS) {
    const value = input[field];
    if (value === undefined || value === MASK) continue;
    out[field] = value === null ? null : String(value);
  }
  return out as Prisma.CarrierUpdateInput;
}
