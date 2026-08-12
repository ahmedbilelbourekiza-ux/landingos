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
