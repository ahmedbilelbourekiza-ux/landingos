/* =============================================================================
 * WCAG colour arithmetic, importable from EITHER side of the client boundary.
 *
 * Extracted from lib/landing/palette.ts (LB.22) when the theme provider — a
 * client component — needed `readableOn` for the discount badge (LB.51):
 * palette.ts is `server-only` and imports sharp, so importing it from a
 * client component would drag an image codec toward the browser bundle. The
 * maths moved here and palette.ts imports it back, so the contrast rule that
 * "stops the feature shipping unreadable buttons" still has exactly ONE
 * definition (the quote=charge rule, applied to colour).
 * ========================================================================== */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const rgbToHex = ({ r, g, b }: Rgb): string =>
  "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

/** WCAG relative luminance. The sRGB gamma expansion matters — a linear
 *  average of channels calls mid-blue and mid-yellow equally bright, and they
 *  are not remotely. */
export function luminance({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const WHITE: Rgb = { r: 255, g: 255, b: 255 };
/** Not pure black: #111 on a coloured surface reads as deliberate, #000 as a
 *  fault. The contrast difference against anything mid-tone is negligible. */
export const NEAR_BLACK: Rgb = { r: 17, g: 17, b: 17 };

/**
 * The readable foreground for a surface: whichever of near-black and white
 * contrasts more. Chosen, not assumed — this is the single line that stops the
 * feature shipping unreadable buttons.
 */
export function readableOn(surface: Rgb): Rgb {
  return contrastRatio(surface, NEAR_BLACK) >= contrastRatio(surface, WHITE)
    ? NEAR_BLACK
    : WHITE;
}

/** Parse `#rrggbb` back to RGB — for the tests, and for asserting contrast. */
export function parseHex(value: string): Rgb {
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/* -----------------------------------------------------------------------------
 * Oklab mixing — the same arithmetic as CSS `color-mix(in oklab, …)`, done in
 * JS so the result is a CONCRETE hex: assertable by the contract suite,
 * greppable in served HTML as a deploy marker, and independent of whether the
 * customer's WebView knows `color-mix()` (the storefront's audience skews to
 * older Android). LB.53 shipped the 78% muted-ink mix as a CSS color-mix
 * string; this keeps its arithmetic and moves WHERE it runs.
 * -------------------------------------------------------------------------- */

interface Oklab { L: number; A: number; B: number }

function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb({ L, A, B }: Oklab): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const unlin = (c: number) =>
    255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);
  return {
    r: unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** Perceptual blend of two hex colours; `weightOfA` 1 = all a, 0 = all b. */
export function mixOklabHex(aHex: string, bHex: string, weightOfA: number): string {
  const w = clamp(weightOfA, 0, 1);
  const a = rgbToOklab(parseHex(aHex));
  const b = rgbToOklab(parseHex(bHex));
  return rgbToHex(
    oklabToRgb({
      L: a.L * w + b.L * (1 - w),
      A: a.A * w + b.A * (1 - w),
      B: a.B * w + b.B * (1 - w),
    }),
  );
}

export interface MutedPair {
  /** The tinted surface secondary UI paints (order summary, footer band). */
  surface: string;
  /** The muted ink that sits on that surface — and on the plain background. */
  ink: string;
}

/**
 * The theme's muted SURFACE and muted INK, chosen by contrast rather than
 * assumed (LB.22's rule, applied to the muted palette — LB.55).
 *
 * Why derivation and not `theme.muted` directly: the theme contract guarantees
 * text↔background and button pairs at AA and says NOTHING about `muted`. On an
 * extracted theme, `muted` is routinely a mid-tone lifted from the photograph
 * (dedima's is #7c716a), and full-strength mid-tone under theme ink measured
 * 2.47–3.98:1 on the live page — the "surface colours used as ink" defect
 * class, arrived at from the surface side.
 *
 * The rule: the surface starts as a 30% tint of `muted` over the background
 * (keeps the theme's hue; on an already-light muted this is visually the same
 * surface) and BACKS OFF toward the background until full text holds AA on it.
 * The ink starts at LB.53's 78% text mix and STRENGTHENS toward full text
 * until it holds AA on that surface. Both loops terminate at values the theme
 * contract itself guarantees (surface = background, ink = text), so a theme
 * with no contrast budget degrades to plain readable rather than pretty and
 * unreadable.
 */
export function mutedPairFor(theme: {
  text: string;
  background: string;
  muted: string;
}): MutedPair {
  // A malformed stored colour degrades to a readable constant pair, the same
  // tolerance readableTextOnHex extends — never a crashed storefront.
  if (!HEX_RE.test(theme.text) || !HEX_RE.test(theme.background)) {
    return { surface: "#ffffff", ink: "#3c4149" };
  }
  const muted = HEX_RE.test(theme.muted) ? theme.muted : theme.background;
  const text = parseHex(theme.text);

  let tint = 0.3;
  let surface = mixOklabHex(muted, theme.background, tint);
  while (tint > 0 && contrastRatio(text, parseHex(surface)) < 4.5) {
    tint = Math.max(0, tint - 0.05);
    surface = mixOklabHex(muted, theme.background, tint);
  }

  let weight = 0.78;
  let ink = mixOklabHex(theme.text, theme.background, weight);
  while (weight < 1 && contrastRatio(parseHex(ink), parseHex(surface)) < 4.5) {
    weight = Math.min(1, weight + 0.02);
    ink = mixOklabHex(theme.text, theme.background, weight);
  }

  return { surface, ink };
}

/**
 * `readableOn` for hex-string call sites (the theme provider holds hex).
 * Tolerant of non-hex input — a malformed stored colour degrades to white
 * text rather than a crashed storefront.
 */
export function readableTextOnHex(surface: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(surface)) return "#ffffff";
  return rgbToHex(readableOn(parseHex(surface)));
}
