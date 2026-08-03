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
  // Its own message rather than the generic one, because this refusal names
  // something the reader can go and fix: the order has no carrier to book with.
  NO_CARRIER: "common.error.noCarrier",
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
