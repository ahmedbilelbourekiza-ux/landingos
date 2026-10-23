import { createHash } from "crypto";

// Relative, per this file's own rule below: the suite imports it directly and
// `node --test` cannot resolve the app's `@/` alias.
import { foldDigits } from "../digits.ts";

/* =============================================================================
 * The canonical tracking vocabulary (LB.5).
 *
 * ONE event model for every provider. The storefront and the server both emit
 * THESE names; each provider adapter maps them onto its own wire vocabulary
 * (Meta keeps them as-is, GA4 wants snake_case, TikTok wants its own casing).
 * A provider added later writes one adapter and touches nothing else — the
 * mission's "generic pipeline" requirement, enforced by module shape.
 *
 * RELATIVE IMPORTS ONLY in this directory's shared/provider modules: the test
 * suite imports the payload builders directly (node --test cannot resolve the
 * app's `@/` alias), and a payload builder only reachable through a rendered
 * page is how a hashing mistake survives review — the calc.ts rule.
 * ========================================================================== */

/** The standard funnel, in order. Custom names are allowed alongside. */
export const TRACKING_EVENTS = [
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Lead",
  "Purchase",
] as const;

export type StandardTrackingEvent = (typeof TRACKING_EVENTS)[number];

/** Browser/click identifiers captured client-side, forwarded server-side. */
export interface TrackingContext {
  ip?: string | null;
  userAgent?: string | null;
  /** Meta click id cookie (_fbc) and browser id cookie (_fbp). */
  fbc?: string | null;
  fbp?: string | null;
  /** TikTok click id (ttclid) and browser id cookie (_ttp). */
  ttclid?: string | null;
  ttp?: string | null;
  /** GA4 client id, parsed from the _ga cookie. */
  gaClientId?: string | null;
  /** The page the event happened on. */
  url?: string | null;
}

export interface ServerTrackingEvent {
  /** A standard name above, or a custom event name (max 40 chars). */
  name: StandardTrackingEvent | (string & {});
  /**
   * The DEDUPLICATION key, shared between the browser event and this one —
   * for a Purchase it is the order id, and it is what stops Meta/TikTok
   * counting a conversion twice when both sides report it.
   */
  eventId: string;
  /** Unix seconds. Defaults to now at send time. */
  eventTime?: number;
  value?: number;
  currency?: string;
  contentId?: string;
  contentName?: string;
  quantity?: number;
  customer?: {
    name?: string | null;
    phone?: string | null;
    /** The commune (baladia) as the order snapshots it — Meta's `ct`. */
    city?: string | null;
    /** The wilaya as the order snapshots it — Meta's `st`. */
    state?: string | null;
  };
  context?: TrackingContext;
}

/** One configured destination, as the dispatcher hands it to an adapter. */
export interface TrackingDestination {
  provider: string;
  publicId: string;
  /** Already decrypted. Null for providers with no server side. */
  serverToken: string | null;
  testCode: string | null;
  settings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Normalised hashing, shared by every adapter that does advanced matching.
// Meta and TikTok both specify SHA-256 over lowercased/trimmed values, and
// phones as digits only. One implementation, so the two cannot disagree.
// ---------------------------------------------------------------------------

export function sha256Lower(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/** Digits only, then hashed — `+213 555-12-34-56` and `0555123456` differ; the
 * caller is expected to pass what the customer typed and providers match
 * fuzzily on their side. Local numbers are NOT rewritten to E.164 here: the
 * storefront cannot know whether a leading 0 means Algeria — guessing a
 * country code wrong poisons the match key silently. */
export function sha256Phone(phone: string): string {
  return sha256Lower(foldDigits(phone).replace(/[^\d]/g, ""));
}

/**
 * Candidate match keys for a phone number, most specific last.
 *
 * Meta and TikTok match on digits WITH the country code (E.164, no `+`), and a
 * hash of `0555123456` matches nothing on either platform — so for a number
 * that reads as an Algerian local (leading 0, ten digits) the `213` candidate
 * is added alongside the raw digits. This storefront's checkout is
 * wilaya-addressed Algeria, so the prefix is a fact of the market rather than
 * a guess; anything that does not match the local shape stays raw-only, which
 * is exactly the old behaviour.
 *
 * `foldDigits` first, because `\d` is ASCII-only: a number typed on an Arabic
 * keyboard stripped to the EMPTY string here, which returned no candidates at
 * all, which shipped the Purchase with no `ph` match key whatsoever. Meta
 * accepts that event and reports it, so the loss was invisible from this side —
 * LB.10's "hashes that never matched local numbers", one keyboard further on.
 */
export function phoneCandidates(phone: string): string[] {
  const digits = foldDigits(phone).replace(/[^\d]/g, "");
  if (!digits) return [];
  const candidates = [digits];
  if (/^0\d{9}$/.test(digits)) candidates.push(`213${digits.slice(1)}`);
  return candidates;
}

/**
 * Meta's name normalisation (fn/ln): lowercase, no punctuation. Letters of any
 * script survive — an Arabic name is valid UTF-8 input, and stripping it would
 * hash the empty string, which matches nobody. Spaces inside a multi-word
 * surname are kept, as Meta's examples do.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Meta's city/state normalisation (ct/st): lowercase, no punctuation, no
 * spaces, roman letters preferred — so accents are folded too
 * ("Béjaïa" → "bejaia", "Bordj Bou Arreridj" → "bordjbouarreridj",
 * "M'Chedallah" → "mchedallah"). Non-Latin letters are kept rather than
 * dropped, for the same reason as normalizeName.
 */
export function normalizeLocation(value: string): string {
  // Accents are folded on LATIN letters only: in Arabic a combining mark can
  // be part of the letter itself (ئ decomposes to ي + hamza), and stripping it
  // would hash a different word.
  return value
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  return {
    first: parts[0] ?? "",
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}
