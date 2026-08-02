/* =============================================================================
 * Locales, direction, and formatting (M-20, decision D4).
 *
 * Three locales across both consoles and the storefront: Arabic, French,
 * English. Arabic is the default because it is what both products already
 * speak to their users.
 *
 * WHY DIRECTION IS A TOKEN AND NOT A BRANCH. Arabic is RTL and the other two
 * are LTR, and the temptation is an `isRtl` check scattered through
 * components. Every layout in packages/ui uses CSS logical properties instead
 * — margin-inline-start rather than margin-left, border-inline-end rather than
 * border-right — so one implementation serves all three and the direction is
 * declared once, on <html dir>. R-10: shadcn/ui is not uniformly RTL-safe, so
 * this has to be a rule from the first component rather than a later pass.
 *
 * NO LOCALE IN THE CONSOLE URL. Decision D2 already puts tenant slugs at the
 * path root (`/acme/product`), which shares a namespace with the platform's
 * own routes (R-08). Adding a locale segment would put a second variable in
 * that same namespace, and `/fr` would be indistinguishable from a tenant
 * called "fr". The console resolves locale from the signed-in user, falling
 * back to their tenant's default. Public storefront pages are a different
 * problem — they need a stable indexable URL per language — and that is
 * settled in 4.5 along with the rest of public routing.
 * ========================================================================== */

export const LOCALES = ['ar', 'fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

export type Direction = 'rtl' | 'ltr';

const DIRECTION: Record<Locale, Direction> = {
  ar: 'rtl',
  fr: 'ltr',
  en: 'ltr',
};

/** Native names, so the switcher reads in the language it offers. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ar: 'العربية',
  fr: 'Français',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): Direction {
  return DIRECTION[locale];
}

/**
 * Resolve the locale to use, in order of specificity: the user's own choice,
 * then their tenant's default, then Arabic.
 *
 * Never throws and never returns something outside LOCALES — a bad value in
 * the database must degrade to a readable page, not a crash.
 */
export function resolveLocale(
  userLocale?: string | null,
  tenantLocale?: string | null,
): Locale {
  if (isLocale(userLocale)) return userLocale;
  if (isLocale(tenantLocale)) return tenantLocale;
  return DEFAULT_LOCALE;
}

/**
 * Best match from an Accept-Language header. Used only before sign-in, since
 * afterwards the user's stored preference wins.
 */
export function localeFromAcceptLanguage(header?: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/* ---------------------------------------------------------------------------
 * Formatting
 *
 * Money is formatted from a string, never a JS number. The schema stores every
 * monetary column as Decimal precisely so values do not pass through binary
 * floating point (M-06), and parsing one into a Number here to format it would
 * reintroduce the drift at the last possible moment.
 * ------------------------------------------------------------------------- */

const BCP47: Record<Locale, string> = {
  ar: 'ar-DZ',
  fr: 'fr-DZ',
  en: 'en-DZ',
};

export function localeTag(locale: Locale): string {
  return BCP47[locale];
}

/**
 * Format money for display.
 *
 * `latn` is forced for Arabic: Algerian commerce reads Western digits, and
 * ar-DZ would otherwise render Eastern Arabic numerals that staff comparing a
 * screen against a carrier's manifest cannot match at a glance.
 */
export function formatMoney(
  amount: string | number,
  locale: Locale,
  currency = 'DZD',
): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(`${BCP47[locale]}-u-nu-latn`, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(`${BCP47[locale]}-u-nu-latn`).format(value);
}

export function formatDate(
  date: Date | string | null | undefined,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  // Gregorian explicitly: ar-DZ defaults to the Islamic calendar in some
  // runtimes, and an order dated by a different calendar than the carrier's
  // paperwork is a support ticket.
  return new Intl.DateTimeFormat(`${BCP47[locale]}-u-ca-gregory-nu-latn`, options).format(d);
}
