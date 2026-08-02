export {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  isLocale,
  directionOf,
  resolveLocale,
  localeFromAcceptLanguage,
  localeTag,
  formatMoney,
  formatNumber,
  formatDate,
  type Locale,
  type Direction,
} from './config.ts';

import ar from './messages/ar.json' with { type: 'json' };
import fr from './messages/fr.json' with { type: 'json' };
import en from './messages/en.json' with { type: 'json' };

/** Every catalogue, keyed by locale. */
export const messages = { ar, fr, en } as const;
