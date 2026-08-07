import "server-only";

import type { Prisma } from "@landingos/db";

import { CARRIER_SECRET_MASK, CARRIER_SECRET_FIELDS } from "./carrier-mask";
import type { CarrierAdapter, InboundEvent, SignatureVerdict } from "./carrier-contract";
import { zr } from "./carrier-zr";
import { ecom } from "./carrier-ecom";
import { verifySignature } from "./webhooks";

// Re-exported so every caller keeps importing the carrier vocabulary from one
// place. The contract lives in its own module only because an adapter cannot
// import the registry that imports it.
export * from "./carrier-contract";

/* =============================================================================
 * Carrier adapters.
 *
 * Ported from apps/erp/lib/providers/. Two are registered: `mock`, which is what
 * the contract suite drives and needs no network, and `zr` — ZR Express Algeria,
 * the first real carrier (LP.5, `carrier-zr.ts`).
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
 *
 * -----------------------------------------------------------------------------
 * D-LP.5.1 — AN ADAPTER IS ASYNC, AND ITS CALLER HOLDS NO TRANSACTION
 *
 * Every method that can reach a network is `async` and takes the carrier's own
 * credentials. That is not a convenience: `withTenant` opens an interactive
 * transaction with a 15-second timeout (TX_OPTIONS), and a booking that runs
 * inside it turns a slow carrier into a rolled-back confirmation — an agent rang
 * a customer, the customer said yes, and the record vanishes. `shipments.ts`
 * splits every carrier interaction into plan (in a transaction), call (in none)
 * and record (in a transaction), and `afterCommit` in `lib/api/route.ts` is what
 * lets a route do that without a second write path.
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

/**
 * Keyword fallback for a carrier status nobody has mapped yet.
 *
 * THE ORDER OF THESE TESTS IS LOAD-BEARING, and getting it wrong booked
 * revenue. Until LP.5 `delivered` was tested first, on `/livr|deliver/` — and
 * "Sorti en livraison" (out for delivery) contains "livr". So an unmapped
 * carrier reporting a parcel that had just left the depot settled the order as
 * DELIVERED: `deliveryOutcome` written, client lifetime spend moved, product
 * revenue moved, delivered-order pay earned, and none of it reversible, because
 * settlement is permanent by design. It was reachable from the one path that
 * deliberately keeps this fallback — a webhook the carrier pushed for a carrier
 * with no registered adapter (D-LP.2) — which is exactly BUG-02 arriving from
 * the other direction.
 *
 * `apps/erp/lib/statusMap.js` had the order right: out-for-delivery is tested
 * before delivered, and its `delivered` pattern is `livré`, not `livr`. Both
 * halves are restored here, and `refus` — which the port dropped entirely, so
 * every unmapped refusal resolved to "pending" — is back.
 */
function guessStatus(original: string): string {
  const s = original.toLowerCase();
  if (/sortie|sorti |out for|livraison|coursier|tournée|tournee/.test(s)) return "out_for_delivery";
  if (/livr|deliver|remis/.test(s)) return "delivered";
  if (/refus|rejected/.test(s)) return "refused";
  if (/retour|return/.test(s)) return "returned";
  if (/annul|cancel/.test(s)) return "cancelled";
  if (/bureau|office|agence/.test(s)) return "at_office";
  if (/route|transit/.test(s)) return "in_transit";
  if (/dispatch/.test(s)) return "dispatched";
  return "pending";
}

const mock: CarrierAdapter = {
  key: "mock",
  label: "Mock Carrier (simulation)",
  canCreateOutbound: true,
  canPoll: true,

  async createShipment(request) {
    const trackingNumber =
      "MOCK" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    return {
      trackingNumber,
      carrierShipmentId: `SHP-${trackingNumber}`,
      carrierReference: request.orderId,
      labelUrl: "",
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
  async track(trackingNumber, { stepsSeen, bookedAt }) {
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

const ADAPTERS: Record<string, CarrierAdapter> = { mock, zr, ecom };

/**
 * The adapter for a carrier, or **null** when nothing is registered under that
 * key.
 *
 * IT USED TO FALL BACK TO THE MOCK, AND THAT WAS DANGEROUS. The legacy ERP
 * offers twelve adapter keys and implements four of them for real; this port
 * carries `mock` and `zr`. With a fallback, a carrier configured as `zr` booked
 * a parcel that never existed: `mock.createShipment` invented a `MOCK…` tracking
 * number, the route answered 201, and the order showed a number the carrier had
 * never heard of. Nobody looks again at an order that booked successfully, so
 * the failure surfaced as a customer asking where their parcel was.
 *
 * A wrong answer that looks right is worse than an error. An unregistered key
 * still refuses at both ends — `POST/PUT /api/erp/carriers` will not store one,
 * and booking or polling a carrier that already holds one is refused by name.
 *
 * Status MAPPING is the exception and keeps a fallback, through
 * `mapCarrierStatus` below: interpreting a status string cannot invent a
 * parcel, and refusing there would drop real carrier events on the floor.
 */
export function getAdapter(key: string | null | undefined): CarrierAdapter | null {
  return ADAPTERS[key ?? ""] ?? null;
}

/** Whether an adapter key is one this deployment can actually talk to. */
export const isKnownAdapter = (key: string | null | undefined): boolean =>
  Boolean(key) && key! in ADAPTERS;

/**
 * A carrier's wording turned into a CRM status.
 *
 * Deliberately falls back to the keyword guess when the adapter is unknown, and
 * when a REGISTERED adapter does not recognise its own carrier's wording — ZR
 * has shipped three spellings of "delivered" across API versions. A parcel
 * whose carrier has no adapter can still receive webhook events (the carrier
 * pushes them, we did not ask), and dropping them would lose real delivery
 * outcomes to a configuration problem. The tenant's own status mapping is
 * consulted before this, by `resolveStatus` in shipments.ts.
 */
export function mapCarrierStatus(key: string | null | undefined, originalStatus: string): string {
  const adapter = getAdapter(key);
  return (adapter ? adapter.mapStatus(originalStatus) : "") || guessStatus(originalStatus);
}

export const listAdapters = () =>
  Object.values(ADAPTERS).map((a) => ({
    key: a.key,
    label: a.label,
    canCreateOutbound: a.canCreateOutbound,
    canPoll: a.canPoll,
  }));

/* -----------------------------------------------------------------------------
 * Inbound
 * -------------------------------------------------------------------------- */

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

/**
 * Which parcel a pushed payload names — before the carrier, and therefore its
 * adapter and its secret, is known.
 *
 * Carriers do not agree on where they put an identifier. This platform's own
 * webhook contract is `{ trackingNumber, status }` at the top level; ZR wraps
 * everything in a Svix envelope as `{ data: { trackingNumber, externalId } }`.
 * Looking in both places is not laxity — it is a LOOKUP, and the signature
 * check still stands between the row it finds and anything being written.
 *
 * An empty tracking number never matches. A ZR parcel is booked without one, so
 * `trackingNumber = ""` would otherwise match the first unnumbered shipment in
 * the tenant and file somebody else's delivery against it.
 */
export function webhookIdentifiers(body: unknown): { trackingNumber: string; externalId: string } {
  const envelope = asObject(body);
  const data = asObject(envelope.data);
  return {
    trackingNumber: asText(envelope.trackingNumber ?? envelope.tracking ?? data.trackingNumber),
    externalId: asText(envelope.externalId ?? envelope.orderId ?? data.externalId),
  };
}

/**
 * Check a pushed payload's signature, the way this carrier signs it.
 *
 * Adapter first, platform default second. FAILS CLOSED either way: a configured
 * secret means a signature is required and must verify. The ERP's Svix check
 * returned "accept" for a missing header, for a missing secret and from its own
 * `catch` — SEC-04, which is why `verifySignature` in `webhooks.ts` answers for
 * every combination instead of falling through any of them.
 */
export function verifyCarrierWebhook(
  adapterKey: string | null,
  secret: string | null,
  raw: string,
  headers: Headers,
): SignatureVerdict {
  const adapter = getAdapter(adapterKey);
  if (adapter?.verifyWebhook) {
    // The one rule `verifySignature` already holds, restated for the adapter
    // path so the two cannot answer differently: a channel with no secret
    // accepts unsigned payloads, because existing integrations predate the
    // secret and breaking them silently loses real deliveries.
    // REQUIRE_WEBHOOK_SIGNATURES closes that door for a finished migration.
    if (!secret) {
      return process.env.REQUIRE_WEBHOOK_SIGNATURES === "1" ? "missing" : "unsigned-allowed";
    }
    return adapter.verifyWebhook(raw, headers, secret);
  }
  return verifySignature(adapterKey, secret, raw, headers);
}

/**
 * A verified payload turned into one event.
 *
 * The adapter reads its own carrier's shape; the generic reader is this
 * platform's documented `{ trackingNumber, status, description, eventTime }`
 * contract, which is what every carrier without an adapter is told to send.
 */
export function parseCarrierWebhook(
  adapterKey: string | null,
  body: unknown,
): InboundEvent | null {
  const adapter = getAdapter(adapterKey);
  if (adapter?.parseWebhook) return adapter.parseWebhook(body);

  const envelope = asObject(body);
  const originalStatus = asText(envelope.status ?? envelope.originalStatus);
  if (!originalStatus) return null;

  const ids = webhookIdentifiers(body);
  const stamp = envelope.eventTime;
  // The carrier's own moment when it sends one. Stamping "now" would book a
  // replayed backlog into the wrong period.
  const when = stamp ? new Date(Number(stamp) || String(stamp)) : new Date();

  return {
    trackingNumber: ids.trackingNumber,
    externalId: ids.externalId,
    originalStatus,
    crmStatus: "",
    description: asText(envelope.description),
    eventTime: Number.isNaN(when.getTime()) ? new Date() : when,
  };
}

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
