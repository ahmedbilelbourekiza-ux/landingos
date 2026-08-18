import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mutedPairFor, mixOklabHex } from '../src/lib/landing/color-math.ts';
import { DEFAULT_THEME } from '../src/types/theme.ts';

/* =============================================================================
 * test/theme-contrast.test.ts — LB.55.
 *
 * A pure suite (no server, no database) over the muted surface/ink pair the
 * theme provider derives. It exists because the defect it pins was invisible
 * to every other suite: no suite renders a theme, so four sub-AA contrast
 * failures sat on the live page (order-summary labels 2.47:1, values 3.98:1,
 * footer 3.93:1) through six Lighthouse runs on two days while everything
 * here was green.
 *
 * The theme CONTRACT (builder-sections' extraction test) guarantees AA for
 * text↔background and the button pair, and says nothing about `muted` — on an
 * extracted theme `muted` is routinely a mid-tone lifted from the photograph.
 * The pair rule closes that gap: any surface that carries theme ink must be
 * tinted toward the background until full text holds AA on it, and muted ink
 * must strengthen from LB.53's 78% mix until it holds AA on that surface.
 * ========================================================================== */

/** WCAG relative luminance and contrast, computed independently of the
 *  implementation so this asserts the RESULT rather than restating the code
 *  (the same stance builder-sections takes on extracted themes). */
const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, bl] = ch.map(f);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** The palettes that matter: the shipped default, the LIVE page's palette the
 *  defect was measured on (dedima's extracted browns), a dark merchant theme
 *  with the same mid-tone muted, a theme whose text barely clears AA on its
 *  own background (no contrast budget to spend on muting), and a degenerate
 *  row where muted equals the text colour. */
const PALETTES = {
  default: { text: DEFAULT_THEME.text, background: DEFAULT_THEME.background, muted: DEFAULT_THEME.muted },
  liveDedima: { text: '#111111', background: '#fcf8f4', muted: '#7c716a' },
  darkMerchant: { text: '#FAFAFA', background: '#141414', muted: '#7c716a' },
  barelyAA: { text: '#757575', background: '#ffffff', muted: '#808080' },
  mutedIsText: { text: '#111111', background: '#FAF9F6', muted: '#111111' },
} as const;

describe('the muted pair holds AA wherever the template puts it', () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    test(`${name}: ink on surface, text on surface, ink on background`, () => {
      const { surface, ink } = mutedPairFor(palette);
      assert.match(surface, /^#[0-9a-f]{6}$/i);
      assert.match(ink, /^#[0-9a-f]{6}$/i);

      // The order summary's labels (ink on the tinted card).
      assert.ok(
        contrast(ink, surface) >= 4.5,
        `${name}: muted ink on muted surface is ${contrast(ink, surface).toFixed(2)}`,
      );
      // The order summary's values and the reviews avatar (full text on it).
      assert.ok(
        contrast(palette.text, surface) >= 4.5,
        `${name}: full text on muted surface is ${contrast(palette.text, surface).toFixed(2)}`,
      );
      // The footer and every text-muted-foreground on the plain background.
      assert.ok(
        contrast(ink, palette.background) >= 4.5,
        `${name}: muted ink on the background is ${contrast(ink, palette.background).toFixed(2)}`,
      );
    });
  }

  test('the live palette that shipped the defect now passes with room', () => {
    // The exact numbers measured on selliora1.com/dedima, 17–18 Aug: labels
    // 2.47:1, values 3.98:1 — full-strength muted under ink. The derived pair
    // must not merely scrape 4.5 on this palette; it has ~7:1 available.
    const { surface, ink } = mutedPairFor(PALETTES.liveDedima);
    assert.ok(contrast(ink, surface) >= 6, `only ${contrast(ink, surface).toFixed(2)}`);
    assert.ok(contrast(PALETTES.liveDedima.text, surface) >= 10);
  });

  test('a healthy theme actually mutes — the pair is not a flattening', () => {
    // If the derivation "passed" by always answering full text on the plain
    // background, it would be correct and useless. Where headroom exists the
    // ink must differ from the text and the surface must keep the muted hue.
    const { surface, ink } = mutedPairFor(PALETTES.liveDedima);
    assert.notEqual(ink.toLowerCase(), PALETTES.liveDedima.text.toLowerCase());
    assert.notEqual(surface.toLowerCase(), PALETTES.liveDedima.background.toLowerCase());
    // And the muting is LB.53's ratio when affordable, not something new.
    assert.equal(ink, mixOklabHex(PALETTES.liveDedima.text, PALETTES.liveDedima.background, 0.78));
  });

  test('a theme with no contrast budget degrades to plain readable', () => {
    // barelyAA's text/background is ~4.6:1 — ANY muting of ink or tinting of
    // surface drops below AA. The honest outcome is full text on the plain
    // background, not a prettier failure.
    const { surface, ink } = mutedPairFor(PALETTES.barelyAA);
    assert.equal(surface.toLowerCase(), PALETTES.barelyAA.background.toLowerCase());
    assert.equal(ink.toLowerCase(), PALETTES.barelyAA.text.toLowerCase());
  });

  test('a malformed stored colour degrades to a readable pair, not a crash', () => {
    for (const bad of ['', 'oops', '#12345', '#gggggg'] as const) {
      const pair = mutedPairFor({ text: bad, background: '#ffffff', muted: '#808080' });
      assert.ok(contrast(pair.ink, pair.surface) >= 4.5);
    }
    // A malformed MUTED alone falls back to the background (tint no-op) while
    // keeping the real text's ink.
    const pair = mutedPairFor({ text: '#111111', background: '#ffffff', muted: 'nope' });
    assert.equal(pair.surface.toLowerCase(), '#ffffff');
    assert.ok(contrast(pair.ink, pair.surface) >= 4.5);
  });
});

describe('the oklab mix is the CSS arithmetic, not an approximation of it', () => {
  test('endpoints and midpoint behave', () => {
    assert.equal(mixOklabHex('#112233', '#aabbcc', 1), '#112233');
    assert.equal(mixOklabHex('#112233', '#aabbcc', 0), '#aabbcc');
    // Oklab's black/white midpoint is ~#636363 — the value CSS
    // `color-mix(in oklab, black, white)` computes. An sRGB average would say
    // #808080 and CIELAB ~#777777; landing in either band would mean the mix
    // runs in the wrong space and every derived tint drifts from what LB.53's
    // shipped color-mix() rendered.
    const mid = mixOklabHex('#000000', '#ffffff', 0.5);
    const grey = parseInt(mid.slice(1, 3), 16);
    assert.ok(grey >= 0x60 && grey <= 0x68, `midpoint ${mid} is out of the oklab band`);
  });
});
