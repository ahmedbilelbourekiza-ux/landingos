import "server-only";

import { foldDigits } from "../digits";

/* =============================================================================
 * Phone normalisation — the Client dedup key.
 *
 * Ported verbatim in behaviour from `normalizePhoneForClient` in
 * apps/erp/lib/db.js, and it is worth saying why a six-line function gets its
 * own file with a comment this long.
 *
 * This value is the unique key on Client, per tenant. If +213555123456 and
 * 0555123456 normalise differently, one customer becomes two records and their
 * lifetime history splits in half — which does not error, does not show up in
 * any log, and is only noticed when somebody asks why a repeat customer shows
 * as new. If they normalise together when they should not, two customers merge
 * and one of them can see the other's order history.
 *
 * So: one implementation, one place, and the order-side `phoneNormalized`
 * column is written from the same function that computes the Client key. The
 * ERP had them agreeing by coincidence rather than by construction.
 * ========================================================================== */

/**
 * The local 0-prefixed form, which is how Algerian numbers are written,
 * dialled, and read aloud.
 *
 * Whitespace goes first because customers, spreadsheets and storefront order
 * forms all put spaces in different places, and `+213 555 12 34 56` must be the
 * same customer as `0555123456`.
 *
 * `foldDigits` goes BEFORE that, for the same reason one step further out: this
 * platform's customers type on Arabic keyboards, and `٠٥٥٥١٢٣٤٥٦` is the same
 * number as `0555123456` to everyone except a `\s` regex. Until it was added,
 * one customer ordering twice from two keyboards produced two Client records
 * and split their history — the precise failure this file opens by describing.
 * Invisible directional marks ride along on a paste out of RTL text and are not
 * whitespace, so they survived the strip below and lengthened the key too.
 */
export function normalizePhone(input: unknown): string {
  if (!input) return "";
  const p = foldDigits(String(input)).replace(/\s/g, "");
  if (p.startsWith("+213")) return "0" + p.slice(4);
  if (p.startsWith("213")) return "0" + p.slice(3);
  return p;
}

/**
 * Is this usable as a customer key at all?
 *
 * Deliberately permissive. The ERP accepted whatever the storefront or the
 * carrier sent, and a webhook carrying a malformed number should still produce
 * an order somebody can look at and fix — refusing it loses the sale rather
 * than the typo.
 */
export const isUsablePhone = (input: unknown): boolean => normalizePhone(input).length >= 6;
