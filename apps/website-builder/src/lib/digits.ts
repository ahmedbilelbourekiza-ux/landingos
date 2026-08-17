/* =============================================================================
 * A digit is a digit, whatever keyboard typed it.
 *
 * NO `server-only` DIRECTIVE, DELIBERATELY: `lib/tracking/events.ts` imports
 * this and carries none itself (the tracking providers' rule), and the pure
 * suite drives it directly (the calc.ts rule). It holds no secret and touches
 * nothing but its argument.
 *
 * WHY THIS EXISTS. This platform sells to Algerian merchants and their
 * customers, who type on Arabic keyboards. `٠٥٥٥١٢٣٤٥٦` and `0555123456` are
 * the same phone number to every human being who reads them, and were two
 * different values to every line of code on this platform — because JavaScript's
 * `\d` matches ASCII `[0-9]` and nothing else, with or without the `u` flag.
 *
 * Measured, not theorised. Two independent consequences, both silent:
 *
 *   1. `normalizePhone` is the UNIQUE KEY on Client. One customer ordering
 *      twice from an Arabic keyboard became two customer records with their
 *      lifetime history split in half — exactly the failure `lib/erp/phone.ts`
 *      opens by describing, arriving through a door it did not check.
 *   2. `phoneCandidates` strips non-`\d` before hashing for Meta/TikTok
 *      advanced matching, so an Arabic-Indic number stripped to the EMPTY
 *      string and the conversion shipped with no phone match key at all. Not a
 *      worse match — no match, and a delivered event that looks like success.
 *
 * THE RULE IT ADDS: fold at the boundary, once, in one function. Folding is not
 * guessing — U+0660..0669 and U+06F0..06F9 each have exactly one ASCII
 * counterpart, so unlike LB.15's comma there is nothing here to be ambiguous
 * about and nothing to refuse.
 * ========================================================================== */

/** Arabic-Indic ٠١٢٣٤٥٦٧٨٩ (U+0660–0669) → 0123456789. */
const ARABIC_INDIC_ZERO = 0x0660;
/** Extended/Eastern Arabic-Indic ۰۱۲۳۴۵۶۷۸۹ (U+06F0–06F9), Persian and Urdu keyboards. */
const EASTERN_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Invisible characters an RTL context inserts and a paste carries along.
 *
 * These are FORMAT characters, not whitespace, so `\s` does not match them and
 * a `.replace(/\s/g, "")` leaves them in place — which is how a pasted
 * `<U+200F>0555123456` became an eleven-character key that matched nothing. Listed by
 * name rather than by a `\p{Cf}` class so each one is a decision somebody can
 * read: LRM, RLM, ALM, the LRE/RLE/PDF/LRO/RLO embedding set, the
 * LRI/RLI/FSI/PDI isolate set, the zero-width joiners, and the BOM.
 */
const BIDI_AND_ZERO_WIDTH =
  /[\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * The same characters, in the one spelling the rest of the platform can compare.
 *
 * Folds both Arabic-Indic digit blocks to ASCII and drops the invisible
 * directional marks. Everything else — spaces, `+`, hyphens, letters — is left
 * exactly as it was, because deciding what those mean is each caller's job and
 * this function has one.
 */
export function foldDigits(input: string): string {
  let out = "";
  for (const ch of input.replace(BIDI_AND_ZERO_WIDTH, "")) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EASTERN_ARABIC_INDIC_ZERO && code <= EASTERN_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EASTERN_ARABIC_INDIC_ZERO);
    } else {
      out += ch;
    }
  }
  return out;
}
