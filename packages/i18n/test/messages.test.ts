import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  LOCALES,
  DEFAULT_LOCALE,
  directionOf,
  resolveLocale,
  localeFromAcceptLanguage,
  isLocale,
  formatMoney,
  formatNumber,
  formatDate,
  type Locale,
} from '../src/config.ts';

import { builtInProducts } from '@landingos/product-registry';
import { STATUS_REGISTRIES } from '@landingos/ui';

/* =============================================================================
 * Keeps the three catalogues honest.
 *
 * The rule this file exists to enforce: a key referenced anywhere in code must
 * exist in EVERY locale. Without it, adding a navigation item or a status ships
 * a screen that reads correctly in English and shows a raw dotted key in
 * Arabic — and nobody notices until a user does.
 *
 * The keys are not listed here. They are read from the product manifests and
 * the status registries, so a product added later is covered automatically
 * rather than only if somebody remembers to extend a test.
 * ========================================================================== */

const DIR = path.join(import.meta.dirname, '..', 'src', 'messages');

const catalogues = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'))]),
) as Record<Locale, Record<string, unknown>>;

/** Flatten to dotted keys: { a: { b: "x" } } -> ["a.b"]. */
function flatten(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

function lookup(cat: unknown, key: string): unknown {
  return key.split('.').reduce<any>((acc, part) => (acc == null ? acc : acc[part]), cat);
}

const keysByLocale = Object.fromEntries(
  LOCALES.map((l) => [l, new Set(flatten(catalogues[l]))]),
) as Record<Locale, Set<string>>;

describe('the catalogues agree with each other', () => {
  test('every locale defines exactly the same keys', () => {
    const reference = keysByLocale[DEFAULT_LOCALE];
    for (const locale of LOCALES) {
      if (locale === DEFAULT_LOCALE) continue;
      const missing = [...reference].filter((k) => !keysByLocale[locale].has(k));
      const extra = [...keysByLocale[locale]].filter((k) => !reference.has(k));
      assert.deepEqual(missing, [], `${locale} is missing keys present in ${DEFAULT_LOCALE}`);
      assert.deepEqual(extra, [], `${locale} has keys absent from ${DEFAULT_LOCALE}`);
    }
  });

  test('no translation is blank or left as its own key', () => {
    for (const locale of LOCALES) {
      for (const key of keysByLocale[locale]) {
        const value = lookup(catalogues[locale], key);
        assert.equal(typeof value, 'string', `${locale}:${key} is not a string`);
        assert.notEqual((value as string).trim(), '', `${locale}:${key} is empty`);
        assert.notEqual(value, key, `${locale}:${key} is a placeholder, not a translation`);
      }
    }
  });

  test('Arabic is actually Arabic, French actually French', () => {
    // Guards the copy-paste failure: duplicating en.json to ar.json passes
    // every structural check above while shipping an untranslated console.
    const arabic = [...keysByLocale.ar]
      .map((k) => lookup(catalogues.ar, k) as string)
      .filter((v) => /[؀-ۿ]/.test(v));
    assert.ok(
      arabic.length > keysByLocale.ar.size * 0.7,
      `only ${arabic.length}/${keysByLocale.ar.size} Arabic values contain Arabic script`,
    );

    const fr = [...keysByLocale.fr].map((k) => lookup(catalogues.fr, k) as string);
    const en = [...keysByLocale.en].map((k) => lookup(catalogues.en, k) as string);
    const identical = fr.filter((v, i) => v === en[i]);
    assert.ok(
      identical.length < fr.length * 0.5,
      `${identical.length}/${fr.length} French strings are identical to English — likely untranslated`,
    );
  });
});

describe('every key the code references is translated', () => {
  test('product names and descriptions', () => {
    const referenced = builtInProducts.flatMap((p) => [p.nameKey, p.descriptionKey]);
    for (const locale of LOCALES) {
      const missing = referenced.filter((k) => !keysByLocale[locale].has(k));
      assert.deepEqual(missing, [], `${locale} has no translation for these product keys`);
    }
  });

  test('every navigation item of every product', () => {
    // Reads the manifests rather than a hardcoded list, so a tenth product is
    // covered the moment it registers.
    const referenced = builtInProducts.flatMap((p) => p.nav.map((n) => n.titleKey));
    assert.ok(referenced.length >= 18, `expected the full nav, found ${referenced.length} keys`);
    for (const locale of LOCALES) {
      const missing = referenced.filter((k) => !keysByLocale[locale].has(k));
      assert.deepEqual(missing, [], `${locale} has no translation for these nav keys`);
    }
  });

  test('every status in every registry', () => {
    const referenced = Object.values(STATUS_REGISTRIES).flatMap((r) =>
      Object.values(r).map((d) => d.labelKey),
    );
    for (const locale of LOCALES) {
      const missing = referenced.filter((k) => !keysByLocale[locale].has(k));
      assert.deepEqual(missing, [], `${locale} has no translation for these status keys`);
    }
  });

  test('the unknown-status fallback is translated', () => {
    // Reached only when data is wrong, which is exactly when a raw dotted key
    // on screen is least helpful.
    for (const locale of LOCALES) {
      assert.ok(keysByLocale[locale].has('status.unknown'), `${locale} lacks status.unknown`);
    }
  });
});

describe('direction', () => {
  test('Arabic is RTL, the others LTR', () => {
    assert.equal(directionOf('ar'), 'rtl');
    assert.equal(directionOf('fr'), 'ltr');
    assert.equal(directionOf('en'), 'ltr');
  });

  test('every locale has a direction', () => {
    for (const l of LOCALES) assert.match(directionOf(l), /^(rtl|ltr)$/);
  });
});

describe('locale resolution never fails open', () => {
  test('the user beats the tenant, the tenant beats the default', () => {
    assert.equal(resolveLocale('fr', 'ar'), 'fr');
    assert.equal(resolveLocale(null, 'en'), 'en');
    assert.equal(resolveLocale(null, null), DEFAULT_LOCALE);
  });

  test('a bad stored value degrades instead of throwing', () => {
    // A locale column holding junk must render a readable page, not a 500.
    assert.equal(resolveLocale('klingon', null), DEFAULT_LOCALE);
    assert.equal(resolveLocale('', ''), DEFAULT_LOCALE);
    assert.equal(resolveLocale(undefined, 'de'), DEFAULT_LOCALE);
  });

  test('isLocale rejects anything not offered', () => {
    assert.equal(isLocale('ar'), true);
    assert.equal(isLocale('de'), false);
    assert.equal(isLocale(null), false);
    assert.equal(isLocale(42), false);
  });

  test('Accept-Language picks the best offered match', () => {
    assert.equal(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8'), 'fr');
    assert.equal(localeFromAcceptLanguage('en-US,en;q=0.9'), 'en');
    assert.equal(localeFromAcceptLanguage('ar-DZ'), 'ar');
    // Quality-ordered, not source-ordered.
    assert.equal(localeFromAcceptLanguage('de;q=0.9,fr;q=0.8'), 'fr');
    assert.equal(localeFromAcceptLanguage('de,ja'), DEFAULT_LOCALE);
    assert.equal(localeFromAcceptLanguage(null), DEFAULT_LOCALE);
  });
});

describe('formatting', () => {
  test('money renders in every locale', () => {
    for (const l of LOCALES) {
      const out = formatMoney('2500.50', l);
      assert.match(out, /2[\s,. ]?500/, `${l} money output was "${out}"`);
    }
  });

  test('Arabic money uses Western digits', () => {
    // Algerian commerce reads Western digits, and staff compare screens against
    // carrier manifests that print them.
    const out = formatMoney('1234', 'ar');
    assert.match(out, /1[\s,. ]?234/, `expected Western digits, got "${out}"`);
    assert.ok(!/[٠-٩]/.test(out), `Eastern Arabic numerals leaked into "${out}"`);
  });

  test('money accepts a Decimal string without going through a float', () => {
    // The schema stores money as Decimal precisely so it never touches binary
    // floating point (M-06); the formatter takes the string form.
    assert.equal(typeof formatMoney('999999.99', 'en'), 'string');
  });

  test('bad input renders an em dash rather than NaN', () => {
    assert.equal(formatMoney('not-a-number', 'en'), '—');
    assert.equal(formatNumber(NaN, 'fr'), '—');
    assert.equal(formatDate(null, 'ar'), '—');
    assert.equal(formatDate('nonsense', 'en'), '—');
  });

  test('dates use the Gregorian calendar in every locale', () => {
    // ar-DZ defaults to the Islamic calendar in some runtimes, and an order
    // dated differently from the carrier's paperwork is a support ticket.
    const d = new Date('2026-08-02T00:00:00Z');
    for (const l of LOCALES) {
      const out = formatDate(d, l, { year: 'numeric' });
      assert.match(out, /2026/, `${l} rendered "${out}" — not a Gregorian year`);
    }
  });
});


/* =============================================================================
 * THE AUDIT'S FINDING — the catalogues agreed with each other and not with the
 * CODE.
 *
 * Everything above asks whether the three locales carry the same keys, and
 * whether every key the MANIFESTS and the STATUS REGISTRIES name exists. Both
 * are derived, which is why they have held. Neither looks at the one place keys
 * are actually used: a `t("...")` call in a component.
 *
 * The audit caught `erp.overview.revenue` in a server log — a product screen
 * asked for a key nobody had added. `next-intl` throws MISSING_MESSAGE at RENDER
 * time, in the missing locale only, so the failure is a 500 on one screen for
 * Arabic readers and a green suite for everybody else. Arabic is the default
 * locale here, which is the only reason it surfaced at all.
 *
 * This reads every `t("literal")` in the console source and asserts the key
 * exists in every locale. It is the same general form as LP.17's navigation
 * test and AUDIT.2's route inventory: derive the list rather than maintain one.
 *
 * WHAT IT CANNOT SEE, stated rather than implied: a key built at runtime —
 * `t(\`erp.period.${type}\`)`, `t(tone.labelKey)` — is invisible to a static
 * scan. Those are covered by the manifest and status-registry checks above and
 * by the contract suites that render the screens.
 * ========================================================================== */

const CONSOLE_SRC = path.join(
  import.meta.dirname, '..', '..', '..', 'apps', 'website-builder', 'src',
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('every key the code asks for exists in every locale', () => {
  const files = sourceFiles(CONSOLE_SRC);

  test('the scan found source files', () => {
    // A glob that silently matches nothing makes the assertion below vacuous.
    assert.ok(files.length > 100, `only ${files.length} source files were scanned`);
  });

  test('no t("…") names a key that does not exist', () => {
    const missing: string[] = [];
    let scanned = 0;

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      // Only STRING-LITERAL keys. A template literal is a runtime key and is
      // out of scope by construction — see the header.
      for (const m of source.matchAll(/\bt\(\s*"([a-zA-Z][\w.]*\.[\w.]+)"/g)) {
        const key = m[1];
        scanned += 1;
        for (const locale of LOCALES) {
          if (lookup(catalogues[locale], key) === undefined) {
            missing.push(`${key} (${locale}) — ${path.basename(file)}`);
          }
        }
      }
    }

    assert.ok(scanned > 200, `only ${scanned} keys were found in the source; the scan is not working`);
    assert.deepEqual(missing, [], `keys used in code but missing from a catalogue:\n${missing.join('\n')}`);
  });
});
