// Slug + currency helpers for the landing create form. Kept local to this
// flow rather than promoted to a shared util — these are the only places
// they're used today, and the project rule is to not build generic systems
// for single use cases.

// Common COD operating currencies. DZD (Algerian Dinar) leads as the project
// default. Small, fixed list — a select is the right UI. Adding a currency is
// a one-line edit here, not a database migration.
export const CURRENCIES = [
  { code: "DZD", label: "DZD — Algerian Dinar" },
  { code: "MAD", label: "MAD — Moroccan Dirham" },
  { code: "TND", label: "TND — Tunisian Dinar" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "SAR", label: "SAR — Saudi Riyal" },
  { code: "AED", label: "AED — UAE Dirham" },
] as const;

// Converts a title to a URL-safe slug. Lowercase, hyphen-separated, strips
// accents and non-alphanumerics. Good enough for human-readable URLs; the
// backend will re-validate on insert.
//
// A RESULT WITHOUT A LETTER IS NOT A SLUG. The strip is lossy for Arabic \u2014
// every Arabic letter is a "non-alphanumeric" to this charset \u2014 so an Arabic
// title keeps only its DIGITS: slugify("\u0633\u0627\u0639\u0629 \u0628\u0631\u0648 0") was "0", and the create
// form derived it silently. The page then published at /0, the home card,
// the category card and the DOMAIN SITEMAP all linked it, the address got
// shared and indexed \u2014 and the moment the merchant fixed the meaningless
// slug, every distributed link 404'd (found as a real 404 at
// selliora1.com/0; reproduced end to end). "0" is the common case (prices,
// phone digits) but "2", "5", "2024" are the same bug. An all-digit
// derivation now yields "" \u2014 the same honest answer an all-Arabic title
// gives \u2014 so the form asks the merchant for an address instead of inventing
// one they never chose.
export function slugify(input: string): string {
  const slug = slugCharset(input);
  return SLUG_HAS_LETTER.test(slug) ? slug : "";
}

/* THE LETTER RULE, in one place, because it was written four times and one
 * copy was missing.
 *
 * LB.54 gated three server write paths — create, the general PATCH, and the
 * category create — each with its own inline `/[a-z]/`. The AI generate route
 * (LB.24, shipped days earlier) validated slugs with the CHARSET half alone,
 * so the rule that closed `/0` had a door it never covered: measured, a
 * caller-supplied `slug:"0"` produced a page at `/0`, and a model answering
 * `"0"` or `"2024"` produced `/0-2` and `/2024`, while the three gated routes
 * refused the identical value with 422.
 *
 * A regex repeated four times is four chances to add a fifth writer that
 * forgets it — this project's own rule, stated after the quote and the charge
 * each built their own copy. One definition, imported by every path that
 * accepts a slug. */
export const SLUG_HAS_LETTER = /[a-z]/;

/** The message every write path gives when a slug carries no letter. Shared
 * for the same reason the regex is: a merchant should not get a different
 * sentence depending on which door refused them. */
export const SLUG_NEEDS_LETTER = "the address needs at least one letter";

/** Is this an address a human can be given? Charset-valid AND letter-bearing.
 * Takes an already-charset-filtered slug; use `slugify` to derive one. */
export function slugHasLetter(slug: string): boolean {
  return SLUG_HAS_LETTER.test(slug);
}

/** The charset half alone \u2014 what a slug INPUT applies per keystroke. The
 * letter rule cannot live here: it would erase a digit-first address
 * ("2024-promo") as it is being typed. Deriving from a title goes through
 * `slugify`; a hand-typed value is filtered here and judged on submit. */
export function slugCharset(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
