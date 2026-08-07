import "server-only";

import crypto from "node:crypto";

import {
  CarrierError,
  type BookingRequest,
  type BookingResult,
  type CarrierAdapter,
  type CarrierConfig,
  type InboundEvent,
  type SignatureVerdict,
  type TrackingEvent,
} from "./carrier-contract";

/* =============================================================================
 * Ecom Delivery (Algeria) — LP.22, closing the rest of R2.
 *
 * Ported from `apps/erp/lib/providers/ecom.js`. Auth is `X-API-Key` +
 * `X-API-Token`; parcels are created with `POST /colis` (an ARRAY, one to a
 * hundred) and tracked with `GET /colis/{tracking}`.
 *
 * -----------------------------------------------------------------------------
 * IT IS THE FIRST REGISTERED CARRIER THAT CAN BE POLLED, AND THAT IS WHY N17
 * IS PART OF THIS SLICE.
 *
 * ZR declares `canPoll: false` — it publishes no tracking endpoint and pushes
 * everything — so `pollCarriers` has never reached a network from inside the
 * transaction it still runs in. `mock` is a synchronous simulator. This adapter
 * is a real HTTP call from that path, which turns N17 from a recorded
 * observation into a live one. See `jobs.ts` for the fix.
 *
 * -----------------------------------------------------------------------------
 * D-LP.22.1 — THE WILAYA MAP IS PORTED, AND IT IS THE OPPOSITE CHOICE FROM ZR'S
 *
 * ZR identifies territories by its own UUIDs, so LP.5 resolves them by NAME at
 * booking time against a live endpoint (D-LP.5.2) rather than maintaining a map
 * that goes stale. Ecom uses the STANDARD Algerian wilaya numbers 1–58, which
 * are set by the state and have changed exactly once in fifty years — the ten
 * added in 2019, which are in the map. A live lookup would be three round trips
 * to learn something constant.
 *
 * D-LP.22.2 — AND THE DEFAULT-TO-ALGER FALLBACK IS **NOT** PORTED
 *
 * The legacy's `getWilayaId` returns 16 (Alger) for anything it cannot resolve,
 * including an empty wilaya. That books a real parcel to the wrong PROVINCE: a
 * courier drives to Alger for a customer in Oran, the customer is never called,
 * and the order looks perfectly booked. It is the same class of defect as
 * D-LP.5.2's commune fallback, and it is refused here for the same reason — by
 * name, so the fix is a spelling correction somebody can make in a minute.
 * ========================================================================== */

const DEFAULT_BASE_URL = "https://ecom-dz.com/api_v2";

/** Ecom's own `situation` wording → the CRM vocabulary. Ported verbatim. */
const STATUS_MAP: Record<string, string> = {
  "en préparation": "created",
  "en preparation": "created",
  "commande confirmée": "created",
  "commande confirmee": "created",
  "en traitement": "dispatched",
  encours: "in_transit",
  "en cours": "in_transit",
  "au bureau": "at_office",
  "sortir en livraison": "out_for_delivery",
  "en livraison": "out_for_delivery",
  livrée: "delivered",
  livre: "delivered",
  livré: "delivered",
  encaisser: "delivered",
  recouvert: "returned",
  retour: "returned",
  "ne réponde pas": "pending",
  "ne reponde pas": "pending",
  "client absent": "refused",
  refusée: "refused",
  refuse: "refused",
  refusé: "refused",
  annulée: "cancelled",
  annule: "cancelled",
  annulé: "cancelled",
};

/**
 * The standard Algerian wilaya numbers, 1–58.
 *
 * Both spellings of everything with an accent, because the wilaya on an order
 * is typed by a person on a storefront or by an agent on a phone call.
 */
const WILAYA_IDS: Record<string, number> = {
  adrar: 1, chlef: 2, laghouat: 3, "oum el bouaghi": 4, batna: 5,
  béjaïa: 6, bejaia: 6, biskra: 7, béchar: 8, bechar: 8, blida: 9,
  bouira: 10, tamanrasset: 11, tébessa: 12, tebessa: 12, tlemcen: 13,
  tiaret: 14, "tizi ouzou": 15, alger: 16, "alger centre": 16, "alger-centre": 16,
  djelfa: 17, jijel: 18, sétif: 19, setif: 19, saïda: 20, saida: 20,
  skikda: 21, "sidi bel abbès": 22, "sidi bel abbes": 22, annaba: 23,
  guelma: 24, constantine: 25, médéa: 26, medea: 26, mostaganem: 27,
  msila: 28, "m'sila": 28, mascara: 29, ouargla: 30, oran: 31,
  "el bayadh": 32, illizi: 33, "bordj bou arréridj": 34, "bordj bou arreridj": 34,
  boumerdès: 35, boumerdes: 35, "el tarf": 36, tindouf: 37, tissemsilt: 38,
  "el oued": 39, khenchela: 40, "souk ahras": 41, tipaza: 42, mila: 43,
  "aïn defla": 44, "ain defla": 44, naâma: 45, naama: 45,
  "aïn témouchent": 46, "ain temouchent": 46, ghardaïa: 47, ghardaia: 47,
  relizane: 48,
  // The ten created in 2019.
  timimoun: 49, "bordj badji mokhtar": 50, "ouled djellal": 51,
  "béni abbès": 52, "beni abbes": 52, "in salah": 53, "in guezzam": 54,
  touggourt: 55, djanet: 56, "m'ghair": 57, "el meniaa": 58,
};

/**
 * The order's wilaya as Ecom's number, or a refusal.
 *
 * D-LP.22.2: never a default. See the header.
 */
function wilayaId(wilaya: string | null): number {
  const cleaned = String(wilaya ?? "").trim();
  if (!cleaned) {
    throw new CarrierError(
      "ADDRESS_UNRESOLVED",
      "The order has no wilaya, so Ecom Delivery cannot be given a destination.",
    );
  }
  // A number the caller already supplied, if it is a real wilaya.
  const asNumber = Number.parseInt(cleaned, 10);
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= 58) return asNumber;

  const found = WILAYA_IDS[cleaned.toLowerCase()];
  if (found) return found;

  throw new CarrierError(
    "ADDRESS_UNRESOLVED",
    `Ecom Delivery does not recognise the wilaya "${cleaned}". Correct the spelling on the order.`,
  );
}

const baseUrl = (cfg: CarrierConfig) =>
  (cfg.apiUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");

const authHeaders = (cfg: CarrierConfig) => ({
  "X-API-Key": cfg.apiKey ?? "",
  "X-API-Token": cfg.secretKey ?? "",
  "content-type": "application/json",
});

/**
 * One HTTP call, with a timeout.
 *
 * A carrier that never answers must not hold a request open: D-LP.5.1 moved
 * these calls OUT of the transaction, and the caller is still a person waiting.
 */
async function ask(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON. The status and the text are still the answer.
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (error) {
    throw new CarrierError(
      "CARRIER_UNREACHABLE",
      error instanceof Error && error.name === "AbortError"
        ? "Ecom Delivery did not answer in time."
        : "Ecom Delivery could not be reached.",
    );
  } finally {
    clearTimeout(timer);
  }
}

interface EcomResult {
  ok?: boolean;
  tracking?: string;
  id_colis?: string | number;
  erreur?: string;
}

export const ecom: CarrierAdapter = {
  key: "ecom",
  label: "Ecom Delivery (Algérie)",
  canCreateOutbound: true,
  /* THE FIRST REGISTERED ADAPTER FOR WHICH THIS IS TRUE. `GET /colis/{tracking}`
   * returns the parcel's whole `historique`, so a parcel can be ASKED about
   * rather than only pushed — which is what makes N17 a live concern. */
  canPoll: true,

  async createShipment(request: BookingRequest, cfg: CarrierConfig): Promise<BookingResult> {
    /* Ecom's field limits, ported. They are not decoration: the API rejects an
     * over-length `nom_complet` outright, and a rejection at booking time is an
     * order that silently never ships. Truncating here is the legacy's choice
     * and the right one — a name shortened to 20 characters still reaches the
     * customer, and the full name is on the order. */
    const parcel = {
      nom_complet: (request.client ?? "").slice(0, 20) || "Client",
      mobile_1: (request.phone ?? "").replace(/\s+/g, "").slice(0, 25) || "0000000000",
      id_wilaya: wilayaId(request.wilaya),
      commune: (request.commune ?? "").slice(0, 50) || "Centre",
      article: (request.product ?? "Article").slice(0, 255),
      quantite: Math.max(1, request.quantity),
      // A decimal STRING through to the last moment. M-06 moved 37 money
      // columns to `numeric`, and this is a total the courier collects in cash.
      total: Number(request.price),
      // Our own id, echoed back on every event — which is how a parcel is found
      // when the carrier's tracking number is not yet known.
      ...(request.orderId ? { id_externe: request.orderId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20) } : {}),
      ...(request.express ? { stop_desk: 0 } : {}),
    };

    const res = await ask(
      `${baseUrl(cfg)}/colis`,
      { method: "POST", headers: authHeaders(cfg), body: JSON.stringify([parcel]) },
      25_000,
    );

    if (!res.ok && res.status !== 201) {
      // 401/403 is a credential problem and everything else is the request.
      // Two codes, because they need two different fixes.
      throw new CarrierError(
        res.status === 401 || res.status === 403 ? "CARRIER_REJECTED" : "CARRIER_REJECTED",
        `Ecom Delivery answered ${res.status}: ${res.text.slice(0, 200) || "no detail"}`,
      );
    }

    const payload = res.json as { resultats?: EcomResult[] } | null;
    const result = payload?.resultats?.[0];
    if (!result) {
      throw new CarrierError("CARRIER_REJECTED", "Ecom Delivery answered without a result.");
    }
    if (result.ok === false) {
      throw new CarrierError(
        "CARRIER_REJECTED",
        `Ecom Delivery refused the parcel: ${result.erreur ?? "no reason given"}`,
      );
    }

    return {
      trackingNumber: String(result.tracking ?? ""),
      carrierShipmentId: String(result.id_colis ?? ""),
      carrierReference: String(parcel.id_externe ?? ""),
      labelUrl: "",
      originalStatus: "En Préparation",
      description: "Parcel created through the Ecom Delivery API",
    };
  },

  /**
   * Every step the carrier has recorded.
   *
   * `bookedAt` is not used: Ecom returns real timestamps on every `historique`
   * entry, so the events already have their own fixed points and intake's
   * (shipment, eventTime, originalStatus) dedup holds across polls. The
   * parameter exists for adapters that must synthesise times — the mock does —
   * and using `now` there is what made the timeline double on every refresh.
   */
  async track(
    trackingNumber: string,
    _context: { stepsSeen: number; bookedAt: Date },
    cfg: CarrierConfig,
  ): Promise<TrackingEvent[]> {
    if (!trackingNumber) return [];

    const res = await ask(
      `${baseUrl(cfg)}/colis/${encodeURIComponent(trackingNumber)}`,
      { headers: authHeaders(cfg) },
      20_000,
    );
    // A parcel the carrier has never heard of is not an error worth failing a
    // poll for — the batch has 24 more to do.
    if (!res.ok) return [];

    const data = (res.json ?? {}) as { historique?: unknown[] };
    const history = Array.isArray(data.historique) ? data.historique : [];

    return history
      .map((entry) => {
        const h = (entry ?? {}) as Record<string, unknown>;
        const situation = String(h.situation ?? "");
        const at = h.date ? new Date(String(h.date)) : null;
        return {
          crmStatus: ecom.mapStatus(situation),
          originalStatus: situation,
          description: String(h.commentaire ?? situation ?? ""),
          // A row with an unreadable date is dropped rather than stamped
          // `now`: a synthesised time defeats the dedup and doubles the
          // timeline on the next poll.
          eventTime: at && !Number.isNaN(at.getTime()) ? at : null,
        };
      })
      .filter((e): e is TrackingEvent => e.eventTime !== null && e.originalStatus !== "");
  },

  mapStatus(originalStatus: string): string {
    const key = String(originalStatus ?? "").toLowerCase().trim();
    if (!key) return "pending";
    if (STATUS_MAP[key]) return STATUS_MAP[key];
    /* A partial match, as the legacy does. Ecom sends "Livrée le 12/03" and
     * "Sortir en livraison - Alger" as well as the bare words, and the
     * alternative to matching a substring is a status nobody mapped falling
     * through to "pending" — which reads as "nothing has happened" for a parcel
     * that has been delivered.
     *
     * Longest key first, so "en livraison" cannot be matched by "livraison"
     * inside "sortir en livraison" before the longer, more specific key gets a
     * chance. That ordering is exactly the class of bug LP.5 found in
     * `guessStatus`, where `/livr/` matched "Sorti en livraison" and settled
     * revenue for a parcel that had just left the depot. */
    for (const [word, status] of Object.entries(STATUS_MAP).sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      if (key.includes(word)) return status;
    }
    return "pending";
  },

  /** How a pushed payload names its parcel, before any secret is consulted. */
  identify(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const trackingNumber = String(b.tracking ?? b.trackingNumber ?? b.code_suivi ?? "");
    const externalId = String(b.id_externe ?? b.id ?? "");
    if (!trackingNumber && !externalId) return null;
    return { trackingNumber, externalId };
  },

  /**
   * `x-webhook-signature: sha256=<hex>` over the raw body.
   *
   * FAILS CLOSED. The legacy checked the signature only when the header was
   * PRESENT, so omitting it skipped verification entirely — SEC-04, the same
   * bypass LP.5 removed from ZR's Svix check.
   */
  verifyWebhook(raw: string, headers: Headers, secret: string): SignatureVerdict {
    if (!secret) return "unsigned-allowed";
    const provided = (headers.get("x-webhook-signature") ?? "").replace(/^sha256=/, "");
    if (!provided) return "missing";

    const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Length first: `timingSafeEqual` throws on a mismatch, and an exception
    // here would be caught somewhere and turned into a skip.
    if (a.length !== b.length) return "invalid";
    return crypto.timingSafeEqual(a, b) ? "ok" : "invalid";
  },

  parseWebhook(body: unknown): InboundEvent | null {
    const b = (body ?? {}) as Record<string, unknown>;
    const trackingNumber = String(b.tracking ?? b.trackingNumber ?? b.code_suivi ?? "");
    const situation = String(b.situation ?? b.status ?? b.etat ?? "");
    if (!trackingNumber && !situation) return null;

    const at = b.date ? new Date(String(b.date)) : null;
    return {
      trackingNumber,
      externalId: String(b.id_externe ?? ""),
      originalStatus: situation,
      crmStatus: ecom.mapStatus(situation),
      description: String(b.commentaire ?? situation),
      // A PUSHED event with no readable date is stamped now, unlike a polled
      // one: the carrier is telling us something happened at this moment, and
      // dropping it would lose a real delivery outcome. A poll re-reads the
      // whole history, so dropping a row there costs nothing.
      eventTime: at && !Number.isNaN(at.getTime()) ? at : new Date(),
    };
  },

  /**
   * `GET /test` — the smallest call that proves both credentials.
   *
   * A READ, for the reason LP.14 states: a test that books a parcel to find out
   * whether booking works sends a real courier to a real address.
   */
  async testConnection(cfg: CarrierConfig) {
    if (!cfg.apiKey || !cfg.secretKey) {
      return { ok: false, message: "Ecom Delivery needs both an API key and an API token." };
    }
    try {
      const res = await ask(`${baseUrl(cfg)}/test`, { headers: authHeaders(cfg) }, 15_000);
      if (res.ok) {
        const account = (res.json as { nom_fournisseur?: string } | null)?.nom_fournisseur;
        return { ok: true, message: `Connected${account ? ` — ${account}` : ""}.` };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Ecom Delivery rejected the key or the token." };
      }
      return { ok: false, message: `Ecom Delivery answered ${res.status}.` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof CarrierError ? error.message : "Ecom Delivery could not be reached.",
      };
    }
  },
};
