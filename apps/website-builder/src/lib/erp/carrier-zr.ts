import "server-only";

import crypto from "node:crypto";

import { Prisma } from "@landingos/db";

import {
  CarrierError,
  type BookingRequest,
  type BookingResult,
  type CarrierAdapter,
  type CarrierConfig,
  type InboundEvent,
  type SignatureVerdict,
} from "./carrier-contract";

/* =============================================================================
 * ZR Express (Algeria) — the first real carrier on the platform.
 *
 * Ported from `apps/erp/lib/providers/zr.js` (479 lines). The behaviour is the
 * legacy adapter's; the shape is this platform's, and three things are
 * deliberately different — each of them a defect in the original.
 *
 * -----------------------------------------------------------------------------
 * 1. TERRITORY RESOLUTION IS THE PART THAT IS NOT OBVIOUS
 *
 * ZR identifies wilaya and commune by its OWN UUIDs, not by the standard 1–58
 * Algerian wilaya numbers this platform's `Wilaya` table uses. Rather than
 * maintain a 1,585-row map that goes stale the first time ZR reorganises a
 * district, the order's wilaya and commune NAMES are resolved at booking time
 * against `POST /territories/search`: exactly one wilaya-level territory by
 * name, then a commune-level one whose `parentId` is that wilaya's id.
 *
 * IF EITHER STEP FAILS THE BOOKING IS REFUSED, never guessed. A parcel booked
 * to the wrong district is money and a customer, and the wrong answer would look
 * exactly like the right one — which is the same failure LP.2 removed when
 * `getAdapter` stopped falling back to the simulator. The refusal names the
 * value that could not be resolved, because the fix is a spelling correction on
 * the order and nobody can make it from "booking failed".
 *
 * -----------------------------------------------------------------------------
 * 2. THE SVIX SIGNATURE FAILS CLOSED HERE, AND FAILED OPEN IN THE ERP
 *
 * `verifySvixSignature` in the legacy adapter returns **true** when the headers
 * are absent, when no secret is configured, and from its own `catch`. So a
 * caller who simply omitted `svix-signature` was accepted, and the check was
 * worth nothing — SEC-04, the exact defect `verifySignature` in `webhooks.ts`
 * exists to state. A configured secret here means a signature is REQUIRED and
 * must verify.
 *
 * -----------------------------------------------------------------------------
 * 3. A ZR PARCEL HAS NO TRACKING NUMBER WHEN IT IS BOOKED
 *
 * `POST /parcels` answers with ZR's parcel id and nothing else; the tracking
 * number is assigned later and arrives on the first webhook. That is why this
 * adapter reports `canPoll: false` and why the delivery webhook can find a
 * parcel by the `externalId` it echoes back as well as by tracking number — a
 * ZR shipment that could only be found by tracking number could never receive
 * the event that gives it one.
 * ========================================================================== */

const DEFAULT_BASE_URL = "https://api.zrexpress.app/api/v1";

/** ZR's own state names → the CRM vocabulary. English and French, as they send it. */
const STATUS_MAP: Record<string, string> = {
  pending: "pending",
  created: "created",
  "picked up": "created",
  registered: "created",
  "at hub": "dispatched",
  dispatched: "dispatched",
  "in transit": "in_transit",
  "on the way": "in_transit",
  "at destination hub": "at_office",
  "at office": "at_office",
  "au bureau": "at_office",
  "out for delivery": "out_for_delivery",
  "delivery in progress": "out_for_delivery",
  delivered: "delivered",
  "delivery failed": "refused",
  refused: "refused",
  "refusé": "refused",
  "customer not available": "refused",
  "returned to hub": "returned",
  "return in transit": "returned",
  "returned to supplier": "returned",
  retour: "returned",
  cancelled: "cancelled",
  "annulé": "cancelled",
};

/* -----------------------------------------------------------------------------
 * Names
 * -------------------------------------------------------------------------- */

/** Lowercase, accent-free, punctuation collapsed — for matching, never for display. */
function normalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Algerian wilaya spellings → the one ZR Express answers to.
 *
 * Ported verbatim. It exists because the wilaya on an order is typed by a
 * customer on a storefront or by an agent on the phone, and "Béjaïa", "Bejaia"
 * and "bjaia" are the same place. Normalisation alone does not close that: it
 * removes the accents and leaves "bjaia", which matches nothing.
 */
const WILAYA_ALIASES: Record<string, string> = {
  adrar: "adrar",
  chlef: "chlef", "ech cheliff": "chlef", "el asnam": "chlef",
  laghouat: "laghouat",
  "oum el bouaghi": "oum el bouaghi",
  batna: "batna",
  bejaia: "bejaia", bjaia: "bejaia",
  biskra: "biskra",
  bechar: "bechar",
  blida: "blida",
  bouira: "bouira",
  tamanrasset: "tamanrasset", tamanghasset: "tamanrasset",
  tebessa: "tebessa",
  tlemcen: "tlemcen",
  tiaret: "tiaret",
  "tizi ouzou": "tizi ouzou",
  alger: "alger", algier: "alger", algiers: "alger", "alger centre": "alger",
  djelfa: "djelfa",
  jijel: "jijel",
  setif: "setif",
  saida: "saida",
  skikda: "skikda",
  "sidi bel abbes": "sidi bel abbes",
  annaba: "annaba",
  guelma: "guelma",
  constantine: "constantine",
  medea: "medea",
  mostaganem: "mostaganem",
  msila: "msila",
  mascara: "mascara",
  ouargla: "ouargla",
  oran: "oran",
  "el bayadh": "el bayadh",
  illizi: "illizi",
  "bordj bou arreridj": "bordj bou arreridj",
  boumerdes: "boumerdes",
  "el tarf": "el tarf",
  tindouf: "tindouf",
  tissemsilt: "tissemsilt",
  "el oued": "el oued",
  khenchela: "khenchela",
  "souk ahras": "souk ahras",
  tipaza: "tipaza", tipasa: "tipaza",
  mila: "mila",
  "ain defla": "ain defla",
  naama: "naama",
  "ain temouchent": "ain temouchent",
  ghardaia: "ghardaia",
  relizane: "relizane",
  timimoun: "timimoun",
  "bordj badji mokhtar": "bordj badji mokhtar",
  "ouled djellal": "ouled djellal",
  "beni abbes": "beni abbes",
  "in salah": "in salah",
  "in guezzam": "in guezzam",
  touggourt: "touggourt",
  djanet: "djanet",
  mghair: "mghair",
  "el meniaa": "el meniaa",
};

/* -----------------------------------------------------------------------------
 * HTTP
 * -------------------------------------------------------------------------- */

function baseUrl(cfg: CarrierConfig): string {
  return (cfg.apiUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function authHeaders(cfg: CarrierConfig): Record<string, string> {
  return {
    // The tenant UUID lives in the "Secret Key" field and the ZR secret in the
    // "API Key" field. Ported as-is: swapping them here would silently break
    // every carrier row a tenant has already configured against the legacy CRM.
    "X-Tenant": cfg.secretKey ?? "",
    "X-Api-Key": cfg.apiKey ?? "",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

interface HttpResult {
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
  readonly json: Record<string, unknown> | null;
}

/**
 * One request, with a hard timeout.
 *
 * The timeout is not decoration. This runs OUTSIDE the tenant transaction
 * (D-LP.5.1) precisely so a slow carrier cannot roll a confirmation back, and
 * the other half of that promise is that a carrier which never answers must
 * still eventually fail rather than hold a request open forever.
 */
async function httpFetch(url: string, init: RequestInit, timeoutMs: number): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      json = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      /* not JSON — the raw text is still reported */
    }
    return { ok: res.ok, status: res.status, text, json };
  } catch (error) {
    // A network failure and a rejection are different problems with different
    // fixes: one is "try again", the other is "correct the request". They must
    // not collapse into one message.
    const name = error instanceof Error ? error.name : "";
    throw new CarrierError(
      "CARRIER_UNREACHABLE",
      name === "AbortError"
        ? `ZR Express did not answer within ${Math.round(timeoutMs / 1000)}s.`
        : `ZR Express could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

interface Territory {
  readonly id: string;
  readonly name: string;
  readonly level?: string;
  readonly parentId?: string;
}

/**
 * Search ZR's territories by keyword.
 *
 * The body shape was confirmed against the live API by the legacy port and is
 * kept: `advancedSearch.fields` must be present whenever a keyword is, because
 * ZR's own `NotEmptyValidator` refuses a keyword with no fields.
 */
async function searchTerritories(cfg: CarrierConfig, keyword: string): Promise<Territory[]> {
  const res = await httpFetch(
    `${baseUrl(cfg)}/territories/search`,
    {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({
        advancedSearch: { fields: ["Name"], keyword },
        pageNumber: 1,
        pageSize: 50,
      }),
    },
    15_000,
  );

  if (!res.ok) {
    throw new CarrierError("CARRIER_REJECTED", `ZR Express refused a territory search: ${detailOf(res)}`);
  }
  const items = res.json?.items;
  return Array.isArray(items) ? (items as Territory[]) : [];
}

/** The most useful thing ZR said about a failure, whatever shape it came in. */
function detailOf(res: HttpResult): string {
  const errors = res.json?.errors;
  if (Array.isArray(errors) && errors.length) {
    return errors
      .map((e) => {
        const row = (e ?? {}) as Record<string, unknown>;
        return String(row.description ?? row.message ?? "");
      })
      .filter(Boolean)
      .join(" / ") || `HTTP ${res.status}`;
  }
  const detail = res.json?.detail;
  if (typeof detail === "string" && detail) return detail;
  return res.text ? res.text.slice(0, 200) : `HTTP ${res.status}`;
}

/**
 * Pick the territory a name means.
 *
 * Exact normalised match first, then containment in either direction — a
 * carrier writing "Alger Centre" for "Alger" and an order writing "Oran Ville"
 * for "Oran" are both the ordinary case here.
 */
function bestMatch(candidates: readonly Territory[], target: string): Territory | null {
  const exact = candidates.find((t) => normalizeName(t.name) === target);
  if (exact) return exact;
  return (
    candidates.find((t) => {
      const name = normalizeName(t.name);
      return name.includes(target) || target.includes(name);
    }) ?? null
  );
}

async function resolveWilaya(cfg: CarrierConfig, wilayaName: string | null): Promise<Territory> {
  const cleaned = String(wilayaName ?? "").trim();
  if (!cleaned) {
    throw new CarrierError("ADDRESS_UNRESOLVED", "The order has no wilaya, so ZR Express cannot be given an address.");
  }

  const canonical = WILAYA_ALIASES[normalizeName(cleaned)] ?? normalizeName(cleaned);
  const items = await searchTerritories(cfg, canonical);

  // A top-level territory is a wilaya. `level` is matched loosely because ZR
  // has answered with "wilaya", "Wilaya" and an absent field across versions,
  // and the absence of a parent is the property that actually defines one.
  const wilayas = items.filter(
    (t) => String(t.level ?? "").toLowerCase().includes("wilaya") || !t.parentId,
  );

  // Everything is only searched when ZR told us NOTHING about level or parent —
  // i.e. when there was no way to recognise a wilaya at all. The legacy adapter
  // fell through to the whole list whenever the scoped search missed, which
  // means a commune could be chosen as a wilaya and the parcel routed by it.
  const match = wilayas.length ? bestMatch(wilayas, canonical) : bestMatch(items, canonical);
  if (!match) {
    throw new CarrierError(
      "ADDRESS_UNRESOLVED",
      `ZR Express does not know a wilaya called "${cleaned}". Correct the wilaya on the order.`,
    );
  }
  return match;
}

async function resolveCommune(
  cfg: CarrierConfig,
  communeName: string | null,
  wilaya: Territory,
): Promise<Territory> {
  const cleaned = String(communeName ?? "").trim();
  if (!cleaned) {
    throw new CarrierError(
      "ADDRESS_UNRESOLVED",
      `The order has no commune for wilaya "${wilaya.name}", so ZR Express cannot be given an address.`,
    );
  }

  const target = normalizeName(cleaned);
  const items = await searchTerritories(cfg, target);

  // SCOPED TO THE WILAYA, WITH NO FALLBACK — and this is a deliberate departure
  // from the legacy adapter, which is the only place LP.5 does not port its
  // behaviour.
  //
  // `zr.js` scoped with `parentId === wilaya.id || level.includes('commune')`
  // and then, if that missed, searched every returned item "ignoring parentId
  // (rare but safe)". It is not safe. Algerian commune names repeat across
  // wilayas, so the fallback books a real parcel to the right NAME in the wrong
  // PLACE — a courier drives to another province, the customer is never called,
  // and the order looks perfectly booked. That is the wrong-answer-that-looks-
  // right this whole slice's refusals exist to prevent, and it is worse than
  // the failure it was written to avoid: an unresolvable commune is a spelling
  // correction somebody makes in a minute, and the message below says which
  // word to correct.
  const scoped = items.filter((t) => t.parentId === wilaya.id);
  const match = bestMatch(scoped, target);

  if (!match) {
    throw new CarrierError(
      "ADDRESS_UNRESOLVED",
      `ZR Express does not know a commune called "${cleaned}" in wilaya "${wilaya.name}". Correct the commune on the order.`,
    );
  }
  return match;
}

/* -----------------------------------------------------------------------------
 * Svix
 * -------------------------------------------------------------------------- */

/**
 * Verify a Svix webhook signature, failing CLOSED.
 *
 * Signed content is `{svix-id}.{svix-timestamp}.{rawBody}`, keyed by the
 * base64-decoded secret with any `whsec_` prefix stripped. `svix-signature`
 * carries a space-separated list of `v1,<base64>` pairs so a secret can be
 * rotated without dropping in-flight deliveries; any one of them matching is
 * enough.
 *
 * The raw body is used, never a re-serialised parse: the MAC is over bytes, and
 * `JSON.parse` followed by `JSON.stringify` changes key order and whitespace —
 * which makes a genuine webhook fail, and the usual response to that is to stop
 * verifying.
 */
export function verifySvixSignature(raw: string, headers: Headers, secret: string): SignatureVerdict {
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  const signature = headers.get("svix-signature") ?? "";
  // The ERP accepted this case. It is the whole of SEC-04: a check that is
  // skipped when the header is absent is not a check.
  if (!id || !timestamp || !signature) return "missing";

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  const expectedBuffer = Buffer.from(expected);

  const provided = signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const candidate = Buffer.from(value);
    // Length first: timingSafeEqual THROWS on a mismatch, and an exception here
    // would be caught somewhere and turned into a skip.
    if (candidate.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(candidate, expectedBuffer);
  });

  return provided ? "ok" : "invalid";
}

/* -----------------------------------------------------------------------------
 * The adapter
 * -------------------------------------------------------------------------- */

/** ZR's state name, or its situation slug, resolved through the map then the keywords. */
function stateToStatus(stateName: string, situationSlug: string): string {
  const key = String(stateName || situationSlug || "").toLowerCase().trim();
  if (!key) return "pending";
  if (STATUS_MAP[key]) return STATUS_MAP[key];
  for (const [known, crm] of Object.entries(STATUS_MAP)) {
    if (key.includes(known)) return crm;
  }
  return "";
}

/** ZR wants an international number; this platform stores the local `0X…` form. */
function internationalPhone(phone: string | null): string {
  const digits = String(phone ?? "").replace(/\s+/g, "");
  if (!digits) return "+213000000000";
  return digits.startsWith("0") ? `+213${digits.slice(1)}` : digits;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

export const zr: CarrierAdapter = {
  key: "zr",
  label: "ZR Express (Algérie)",
  canCreateOutbound: true,
  // ZR publishes no tracking endpoint at all — every update arrives on the
  // webhook. Declared rather than silently answering "no news", so pressing
  // "ask the carrier" says which of the two it is (the LP.2 distinction).
  canPoll: false,

  /**
   * A cheap authenticated READ — LP.14.
   *
   * `POST /territories/search` is the smallest call that proves both halves of
   * the credentials: `X-Api-Key` and `X-Tenant` are both required by it, and a
   * wrong either answers 401/403 rather than an empty list. It is also the call
   * every booking already makes first, so a test that passes here means the
   * next booking gets at least as far as the address.
   *
   * It must never be `createShipment`. A test that books a parcel to find out
   * whether booking works sends a real courier to a real address.
   */
  async testConnection(cfg: CarrierConfig): Promise<{ ok: boolean; message: string }> {
    if (!cfg.apiKey || !cfg.secretKey) {
      return {
        ok: false,
        message: "ZR Express needs both an API key and a tenant id (the secret-key field).",
      };
    }
    try {
      const found = await searchTerritories(cfg, "Alger");
      return {
        ok: true,
        message: `ZR Express answered — ${found.length} territories matched a sample lookup.`,
      };
    } catch (error) {
      // The adapter's own three-way distinction survives: an operator is told
      // whether to fix the credentials, the URL, or wait and retry.
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },

  async createShipment(request: BookingRequest, cfg: CarrierConfig): Promise<BookingResult> {
    if (!cfg.apiKey || !cfg.secretKey) {
      throw new CarrierError(
        "CARRIER_REJECTED",
        "ZR Express needs both an API key and a tenant id (the secret-key field) before a parcel can be booked.",
      );
    }

    // Address first, and the whole booking stops here if it cannot be resolved.
    const wilaya = await resolveWilaya(cfg, request.wilaya);
    const commune = await resolveCommune(cfg, request.commune, wilaya);

    const quantity = Math.max(1, Number(request.quantity) || 1);
    // Money stays a Decimal until the last possible moment. `amount` is the
    // order's final total — ZR's field includes the delivery fee — and
    // `unitPrice` is derived from it rather than from `unitPrice` on the order,
    // because the two disagree the moment a discount is applied and ZR collects
    // `amount`. The conversion to a JS number happens HERE, on the wire, where
    // JSON has no other option; it never travels back into the database.
    const amount = new Prisma.Decimal(request.price || "0");
    const unitPrice = amount.div(quantity).toDecimalPlaces(2);

    const productName = String(request.product || "Article").slice(0, 100).replace(/\|/g, "-");
    // ZR echoes this back on every webhook, and it is how a parcel with no
    // tracking number yet is matched to its order.
    const externalId = request.orderId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);

    const body = {
      customer: {
        // ZR rejects the nil UUID as a customerId; its docs say any valid random
        // GUID works when the customer is not one of theirs, and it means it.
        customerId: crypto.randomUUID(),
        name: String(request.client || "Client").slice(0, 100),
        phone: { number1: internationalPhone(request.phone) },
      },
      deliveryAddress: {
        cityTerritoryId: wilaya.id,
        districtTerritoryId: commune.id,
        street: String(request.address ?? "").slice(0, 200),
      },
      orderedProducts: [
        {
          productName,
          unitPrice: unitPrice.toNumber(),
          quantity,
          // Our catalogue is not registered in ZR's.
          stockType: "none",
        },
      ],
      deliveryType: request.express ? "express" : "home",
      description: productName.slice(0, 250) || "Commande CRM",
      amount: amount.toNumber(),
      ...(externalId ? { externalId } : {}),
    };

    const res = await httpFetch(
      `${baseUrl(cfg)}/parcels`,
      { method: "POST", headers: authHeaders(cfg), body: JSON.stringify(body) },
      25_000,
    );

    if (!res.ok) {
      throw new CarrierError("CARRIER_REJECTED", `ZR Express refused the parcel: ${detailOf(res)}`);
    }

    const parcelId = text(res.json?.id);
    if (!parcelId) {
      throw new CarrierError("CARRIER_REJECTED", "ZR Express accepted the parcel but returned no parcel id.");
    }

    return {
      // Empty on purpose, and it is not a failure. ZR assigns the tracking
      // number later and delivers it on the first webhook.
      trackingNumber: "",
      carrierShipmentId: parcelId,
      carrierReference: externalId,
      labelUrl: "",
      originalStatus: "OrderReceived",
      description: "Parcel created at ZR Express — awaiting its tracking number.",
    };
  },

  // Declared for the contract and never called: `canPoll` is false, so
  // `refreshShipment` refuses by name rather than reaching this and reporting
  // an empty history that reads as "the carrier has no news".
  async track() {
    return [];
  },

  mapStatus(originalStatus: string): string {
    return stateToStatus(originalStatus, "");
  },

  identify(body: unknown) {
    // The Svix envelope is `{ eventType, occurredAt, data }`; a payload with no
    // envelope is accepted too, because ZR's own test console sends one.
    const envelope = object(body);
    const data = object(envelope.data ?? envelope);
    const trackingNumber = text(data.trackingNumber ?? envelope.trackingNumber);
    const externalId = text(data.externalId ?? envelope.externalId);
    if (!trackingNumber && !externalId) return null;
    return { trackingNumber, externalId };
  },

  parseWebhook(body: unknown): InboundEvent | null {
    const envelope = object(body);
    const data = object(envelope.data ?? envelope);

    const trackingNumber = text(data.trackingNumber ?? envelope.trackingNumber);
    const externalId = text(data.externalId ?? envelope.externalId);
    if (!trackingNumber && !externalId) return null;

    const stateName = text(object(data.state).name);
    const situationSlug = text(object(data.situation).slug);
    const situationName = text(object(data.situation).name) || stateName;
    const eventType = text(envelope.eventType);

    // The carrier's own moment, never the clock: ZR replays, and stamping "now"
    // books a week-old delivery into this week's revenue.
    const occurredAt = text(envelope.occurredAt) || text(data.lastStateUpdateAt);
    const when = occurredAt ? new Date(occurredAt) : new Date();

    const originalStatus = situationName || stateName || eventType;
    if (!originalStatus) return null;

    return {
      trackingNumber,
      externalId,
      originalStatus,
      // The mapped status is left to the caller when ZR's own vocabulary does
      // not cover it, so a tenant's status mapping and the shared keyword
      // fallback still get their turn.
      crmStatus: stateToStatus(stateName, situationSlug),
      description: situationName || stateName || "",
      eventTime: Number.isNaN(when.getTime()) ? new Date() : when,
    };
  },

  verifyWebhook(raw: string, headers: Headers, secret: string): SignatureVerdict {
    return verifySvixSignature(raw, headers, secret);
  },
};
