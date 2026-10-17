/* =============================================================================
 * The API's refusals, in the reader's language.
 *
 * DELIBERATELY NOT `server-only`, unlike everything else in `lib/console/`.
 * This module IS the contract between the route's error envelope and the
 * control that reads it, so both sides import it: the server to translate every
 * code once, the client to look one up. It reaches nothing — no database, no
 * session, no secret — so there is nothing here that must not reach a browser,
 * and splitting it in two to satisfy the convention would put the fallback key
 * in two files and invite them to disagree.
 *
 * Every console route answers with the same envelope (`src/lib/api/route.ts`):
 * a machine-readable `code`, a human `message`, and optional `extra`. The
 * message is ENGLISH, written for whoever is reading a log — "Only a manager can
 * reassign an order." A screen cannot show it: the platform ships in Arabic,
 * French and English (D4) and every user-facing string is a key.
 *
 * So the screen keys off the CODE. That is what a code is for, it is stable
 * across wording changes, and it means a route can improve its developer-facing
 * message without silently changing what a call-centre agent reads.
 *
 * An unmapped code falls back rather than rendering a raw dotted key or a bare
 * `code`. A refusal nobody anticipated is exactly when the screen most needs to
 * say something a person can act on.
 * ========================================================================== */

/** The fallback lives under the empty key, so a lookup is one expression. */
export const FALLBACK = "";

const ERROR_KEYS: Record<string, string> = {
  UNAUTHENTICATED: "common.error.signedOut",
  NO_ACTIVE_TENANT: "common.error.noTenant",
  FORBIDDEN: "common.error.forbidden",
  // SEC.8. To the person on the screen it reads as the ordinary refusal —
  // the code exists so the LOG can tell "not yours to spend" apart from a
  // role problem. The UI hides AI controls from non-spenders, so this only
  // renders in the revoked-mid-session race.
  AI_SPEND_FORBIDDEN: "common.error.forbidden",
  FORBIDDEN_FIELD: "common.error.forbiddenField",
  NOT_FOUND: "common.error.notFound",
  // The four ways a body can be refused all say the same thing to a person:
  // what you typed was not accepted. Distinguishing them on screen would be
  // telling an agent which of the server's validators fired.
  INVALID_INPUT: "common.error.invalidInput",
  INVALID_RESULT: "common.error.invalidInput",
  INVALID_NOTE_TYPE: "common.error.invalidInput",
  INVALID_CLASSIFICATION: "common.error.invalidInput",
  // A transition the state machine refuses means the screen went stale —
  // someone else moved the order first. The refresh that follows the error
  // shows the truth; the message only has to say "that was not accepted".
  INVALID_TRANSITION: "common.error.invalidInput",
  // Its own message rather than the generic one, because this refusal names
  // something the reader can go and fix: the order has no carrier to book with.
  NO_CARRIER: "common.error.noCarrier",
  // LB.18. Same reasoning as NO_CARRIER: this is not "that did not work", it is
  // "your company switched this module off", and the message says where to
  // switch it back on.
  FINANCE_DISABLED: "common.error.financeDisabled",
  // LB.22. Also its own, and for the same reason: it names what to try instead
  // (a photograph of the product) rather than reporting a failure.
  NO_COLOURS: "common.error.noColours",
  // LB.20. Both name the row the merchant has to go and change.
  DUPLICATE_WILAYA: "common.error.duplicateWilaya",
  UNKNOWN_DESTINATION: "common.error.unknownDestination",
  // LB.21. Names the reason rather than reporting a failure: there is no
  // catalogue because the company has not bought the Manager.
  NO_ERP: "common.error.noErp",
  // The five ways a carrier can refuse, and they are FIVE because each one has a
  // different fix: change the carrier's integration, correct the address on the
  // order, correct what was sent, wait, or stop asking a carrier that only
  // pushes. LP.2 shipped `UNKNOWN_ADAPTER` with no entry here, so the screen
  // showed "that did not work" for a refusal that names its own cause.
  UNKNOWN_ADAPTER: "common.error.unknownAdapter",
  ADDRESS_UNRESOLVED: "common.error.addressUnresolved",
  CARRIER_REJECTED: "common.error.carrierRejected",
  CARRIER_UNREACHABLE: "common.error.carrierUnreachable",
  CARRIER_NO_POLLING: "common.error.carrierNoPolling",
  // Its own message, because it names the fix: this is not "that failed", it is
  // "narrow the filter". A generic message here sends somebody to support for a
  // problem they can solve in one click.
  TOO_MANY_ROWS: "common.error.tooManyRows",
  /* LB.14c — the custom-domains screen, and it is the UNKNOWN_ADAPTER note
   * above happening a second time. B5 shipped five refusal codes and mapped
   * none of them, so a screen whose every refusal names a thing the merchant
   * must go and change in their own DNS zone answered "that didn't work" to
   * all five — measured in the running console.
   *
   * `DNS_NO_RECORD` and `DNS_TOKEN_MISMATCH` are two codes because the verify
   * route's own comment calls the distinction essential: one means "keep
   * waiting, DNS has not propagated", the other means "you published the
   * wrong string, go and fix it". They are the opposite instruction, and
   * collapsing them costs somebody an afternoon. */
  DNS_NO_RECORD: "common.error.dnsNoRecord",
  DNS_TOKEN_MISMATCH: "common.error.dnsTokenMismatch",
  INVALID_DOMAIN: "common.error.invalidDomain",
  DOMAIN_TAKEN: "common.error.domainTaken",
  DOMAIN_LIMIT: "common.error.domainLimit",
  NOT_VERIFIED: "common.error.domainNotVerified",
  /* LB.38. The pages list hides Delete for a page that has sold anything, so
   * in normal use this refusal is unreachable — it is here for the case that
   * is NOT normal use: a list rendered before the first order arrived, still
   * open in another tab. The row says "no orders", the database disagrees, and
   * the merchant is one click from being told "that didn't work" about the one
   * refusal in this screen that is actively protecting their revenue history.
   * The message names the door that IS open, which is Archive. */
  HAS_ORDERS: "common.error.hasOrders",
  /* INV.1, and the UNKNOWN_ADAPTER note above happening a FOURTH time.
   *
   * `VARIANT_LEVEL_REQUIRED` is new here. The other two are not: LP.18 shipped
   * `VARIANT_HOLDS_STOCK` and `DUPLICATE_VARIANT` with no entry in this file,
   * so the variant editor answered "that did not work" to its own two most
   * informative refusals — and both name something the merchant must go and
   * change before the save can succeed, which is precisely the test this file
   * says earns a code its own message.
   *
   * All three are mapped together because they are one screen's vocabulary and
   * splitting them would leave the same gap open one more release. */
  VARIANT_LEVEL_REQUIRED: "common.error.variantLevelRequired",
  VARIANT_HOLDS_STOCK: "common.error.variantHoldsStock",
  DUPLICATE_VARIANT: "common.error.duplicateVariant",
  /* VP.1 — own variant prices on a second option group. The editor already
   * stops this at the keyboard; this is for the stale tab and the hand-made
   * request, and it names the fix (keep prices in one group). */
  VARIANT_PRICE_AXIS: "common.error.variantPriceAxis",
  /* INV.3 — the two ways an OPENING level is refused, and they are two codes
   * because the fix is different for each. "This has moved before" means the
   * opening figure is no longer the right instrument and the correction panel
   * is; "you set it lower" means the number is a reduction, which owes a
   * reason this control has nowhere to put. Collapsing them would send a
   * merchant to the wrong door half the time. Both are near-unreachable from
   * the screen (the panel hides itself once a level has moved, and the box
   * refuses anything under 1) — they are mapped for the stale-tab case, which
   * is exactly why HAS_ORDERS is mapped two entries above. */
  HAS_STOCK_HISTORY: "common.error.hasStockHistory",
  OPENING_STOCK_LOWER: "common.error.openingStockLower",
  INTERNAL_ERROR: "common.error.internal",
  // Not from the server — the request never arrived. Worth its own wording
  // because "nothing was saved" is certain here and merely likely otherwise.
  NETWORK: "common.error.network",
};

export type ActionErrors = Record<string, string>;

/**
 * Translate every code once, on the server, and hand the result to the client.
 *
 * The client components in this console take translated strings as props and
 * hold no catalogue of their own — the same shape as `TenantSwitcher`,
 * `SignOutButton` and `ConsoleNav`. It keeps the write controls independent of
 * whether messages happen to be available client-side.
 */
export function actionErrors(t: (key: string) => string): ActionErrors {
  const messages: ActionErrors = { [FALLBACK]: t("common.error.unknown") };
  for (const [code, key] of Object.entries(ERROR_KEYS)) messages[code] = t(key);
  return messages;
}
