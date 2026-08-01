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
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
