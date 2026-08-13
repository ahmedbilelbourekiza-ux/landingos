/* =============================================================================
 * How a typed price is read — LB.15.
 *
 * NO `"server-only"` DIRECTIVE, DELIBERATELY: every caller is a client
 * component in the landing-page editor.
 *
 * WHY THIS EXISTS. Money never enters through `type="number"` on this platform
 * (M-05 / D-06): a number input hands back a JS float into a `Decimal` column,
 * and — measured in the running editor — its `step="1"` spinner silently
 * ROUNDS a price. Two arrow-up presses turned 2990.50 into 2992, discarding
 * the centimes on the way. The boxes are therefore plain text with a decimal
 * keypad, exactly as the create screen (`new-landing-form.tsx`), the ERP's
 * order and product panels and LB.20's delivery overrides already are.
 *
 * The moment a box stops being a number input, SOMETHING has to say what the
 * characters mean — and that reading must be identical in the box that
 * validates and in the request that saves, or the editor refuses a price it
 * then sends, or sends one it never showed. One function answers both, which
 * is the rule LB.20 wrote down after the quote and the charge each built their
 * own copy.
 *
 * THE COMMA IS A DECIMAL SEPARATOR, AND AMBIGUITY IS REFUSED RATHER THAN
 * GUESSED. A French or Arabic keypad offers a comma and a merchant in Algeria
 * types `2990,50`. But `1,000` is one thousand to an English reader and one to
 * a French one, and picking either silently is a 1000x error on a price — the
 * one mistake this whole file exists to prevent. A value that cannot be read
 * without guessing is refused by name, and the section shows a translated
 * message.
 * ========================================================================== */

/**
 * The `pattern` both money boxes advertise. Advisory only — this form runs its
 * own validation and never calls `checkValidity()` — but it tells a browser
 * and an assistive technology that one separator is expected, and it is the
 * same shape the create screen has published since LB.6.
 */
export const MONEY_PATTERN = "[0-9]*[.,]?[0-9]*";

/**
 * What a person typed, as a canonical numeric string — or `null` when it
 * cannot be read.
 *
 * Returns a STRING rather than a number on purpose: a canonical `"2990.50"` is
 * what a `Decimal` column wants, and `src/lib/money.ts` records the same rule
 * for the calculator ("everything crosses the boundary as a STRING"). An empty
 * box is `""`, which is a real answer for an optional price and is not the
 * same as unreadable.
 */
export function normaliseTypedMoney(raw: unknown): string | null {
  if (raw === null || raw === undefined) return "";

  // Every kind of space, including the NBSP a French locale groups with and
  // the narrow one Windows inserts: `2 990,50` is one number.
  const text = String(raw).replace(/[\s  ]/g, "");
  if (text === "") return "";

  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;

  // Both separators, or two of either, means thousands grouping is in play and
  // this function would have to guess which one. It does not.
  if (dots + commas > 1) return null;

  let normalised = text;
  if (commas === 1) {
    // `1,000` — a comma followed by exactly three digits is the grouping an
    // English reader writes and the decimal an unlucky French reader could
    // mean. Refused; anything else is unambiguously a decimal separator.
    //
    // THE SAME RULE IS DELIBERATELY NOT APPLIED TO A DOT, and the asymmetry is
    // load-bearing rather than an oversight: a dot is the canonical separator
    // this function EMITS, so `1.000` is what a stored `Decimal` of 1 with
    // three places stringifies to on the way back into the box. Refusing it
    // would put an error on a form nobody had touched — the shape LB.33 spent
    // a slice measuring. A comma never arrives that way; it only ever comes
    // from a person's keypad.
    if (/,\d{3}$/.test(text)) return null;
    normalised = text.replace(",", ".");
  }

  if (!/^\d*(\.\d*)?$/.test(normalised)) return null;
  if (normalised === "." ) return null;
  return normalised;
}

/**
 * The same reading, as the number the pricing form compares and the API's
 * current shape coerces. `null` is "unreadable", `undefined` is "left empty" —
 * the distinction an optional old price depends on.
 */
export function readTypedMoney(raw: unknown): number | null | undefined {
  const text = normaliseTypedMoney(raw);
  if (text === null) return null;
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
