import "server-only";

/* =============================================================================
 * The carrier adapter contract.
 *
 * Its own module, and not part of `carriers.ts`, for one reason: an adapter
 * implements this contract and the registry imports the adapter, so a contract
 * living in the registry is a circular import between the two. `apps/erp` had
 * the same split (`lib/providers/base.js`) and the same reason.
 *
 * -----------------------------------------------------------------------------
 * D-LP.5.1 — EVERY METHOD THAT CAN REACH A NETWORK IS ASYNC, AND ITS CALLER
 * HOLDS NO TRANSACTION.
 *
 * `withTenant` opens an interactive transaction whose timeout is 15 seconds
 * (TX_OPTIONS). Until LP.5 the carrier call happened inside it, which was
 * harmless only because the one registered adapter was a synchronous simulator.
 * With a real carrier it means a slow third party rolls back a CONFIRMATION —
 * an agent rang a customer, the customer said yes, and the record disappears
 * because somebody else's API was busy. So `shipments.ts` splits every carrier
 * interaction into three phases: plan (in a transaction), call (in none), record
 * (in a transaction). `afterCommit` in `lib/api/route.ts` is what lets a route
 * do that without introducing a second write path.
 * ========================================================================== */

export interface TrackingEvent {
  readonly crmStatus: string;
  readonly originalStatus: string;
  readonly description: string;
  readonly eventTime: Date;
}

/** A carrier's stored credentials. Never the masked form — see `maskCarrier`. */
export interface CarrierConfig {
  readonly apiUrl: string | null;
  readonly apiKey: string | null;
  readonly secretKey: string | null;
  readonly webhookSecret: string | null;
}

/**
 * Everything an adapter may need to book a parcel, derived ONCE in
 * `shipments.ts` from the order row.
 *
 * `price` is a decimal STRING, not a number. 37 money columns became `numeric`
 * in M-06, and the point of that migration is lost the moment a total passes
 * through a JS double on its way to a carrier that will collect it in cash.
 */
export interface BookingRequest {
  readonly orderId: string;
  readonly reference: string | null;
  readonly client: string | null;
  readonly phone: string | null;
  readonly wilaya: string | null;
  readonly commune: string | null;
  readonly address: string | null;
  readonly product: string | null;
  readonly quantity: number;
  readonly price: string;
  readonly express: boolean;
}

export interface BookingResult {
  /** May be empty: some carriers assign it later and push it on a webhook. */
  readonly trackingNumber: string;
  readonly carrierShipmentId: string;
  readonly carrierReference: string;
  readonly labelUrl: string;
  readonly originalStatus: string;
  readonly description: string;
}

/** One update a carrier PUSHED, after its signature has been checked. */
export interface InboundEvent {
  readonly trackingNumber: string;
  /** Our own identifier, echoed back — how a parcel with no tracking number yet is found. */
  readonly externalId: string;
  readonly originalStatus: string;
  /** The adapter's own reading. Empty when it has none, so the caller's fallbacks apply. */
  readonly crmStatus: string;
  readonly description: string;
  readonly eventTime: Date;
}

export type SignatureVerdict = "ok" | "missing" | "invalid" | "unsigned-allowed";

export interface CarrierAdapter {
  readonly key: string;
  readonly label: string;
  readonly canCreateOutbound: boolean;
  /** Whether the carrier can be ASKED where a parcel is, as opposed to only pushing. */
  readonly canPoll: boolean;

  createShipment(request: BookingRequest, cfg: CarrierConfig): Promise<BookingResult>;

  /**
   * Every step up to and including the parcel's current one.
   *
   * `bookedAt` anchors the event times. It must be a fixed point in the
   * parcel's own history — not the wall clock — because intake dedupes on
   * (shipment, eventTime, originalStatus): timestamps derived from `now` make
   * every poll look like a brand-new set of events and the timeline doubles on
   * each refresh. That is not hypothetical; it is what the first version of the
   * mock adapter did, and the idempotency test caught it.
   */
  track(
    trackingNumber: string,
    context: { readonly stepsSeen: number; readonly bookedAt: Date },
    cfg: CarrierConfig,
  ): Promise<TrackingEvent[]>;

  mapStatus(originalStatus: string): string;

  /**
   * Which parcel a pushed payload is about — read BEFORE any secret is
   * consulted, because the secret lives on the carrier row and the carrier is
   * only known once the parcel is found. Nothing is written on the strength of
   * this; it is a lookup key, and the signature check still stands between the
   * row it finds and anything being stored.
   */
  identify?(body: unknown): { trackingNumber: string; externalId: string } | null;

  /** Turn a VERIFIED pushed payload into one event. */
  parseWebhook?(body: unknown): InboundEvent | null;

  /** How this carrier signs. Absent means the platform's default HMAC check. */
  verifyWebhook?(raw: string, headers: Headers, secret: string): SignatureVerdict;

  /**
   * Ask the carrier whether these credentials work — LP.14.
   *
   * OPTIONAL, and its absence is meaningful rather than a gap. An adapter that
   * cannot make a cheap authenticated read has nothing to test, and the route
   * falls back to a STRUCTURAL check that says so in its own message. The one
   * thing neither may do is report success without having contacted anything:
   * a green tick that means "we did not look" is the same defect as the
   * fabricated tracking numbers D-LP.2 removed, on the screen an operator
   * checks BEFORE trusting the integration.
   *
   * It must be a READ. A test that books a parcel to find out whether booking
   * works is a real courier at a real address.
   */
  testConnection?(cfg: CarrierConfig): Promise<{ ok: boolean; message: string }>;
}

/**
 * A carrier said no, or could not be reached.
 *
 * Three codes because they need three different actions: correct the ORDER,
 * correct the CREDENTIALS or the request, or TRY AGAIN. Collapsing them into
 * "booking failed" is what makes an operator open a support ticket for a
 * misspelled commune — and the legacy adapter's whole reason for throwing a
 * readable message was that the CRM then showed the order with the reason on it
 * instead of silently booking a parcel to the wrong address.
 */
export type CarrierErrorCode = "ADDRESS_UNRESOLVED" | "CARRIER_REJECTED" | "CARRIER_UNREACHABLE";

export class CarrierError extends Error {
  readonly code: CarrierErrorCode;
  constructor(code: CarrierErrorCode, message: string) {
    super(message);
    this.name = "CarrierError";
    this.code = code;
  }
}
