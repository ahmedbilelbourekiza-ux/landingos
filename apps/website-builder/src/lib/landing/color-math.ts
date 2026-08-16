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

/**
 * `readableOn` for hex-string call sites (the theme provider holds hex).
 * Tolerant of non-hex input — a malformed stored colour degrades to white
 * text rather than a crashed storefront.
 */
export function readableTextOnHex(surface: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(surface)) return "#ffffff";
  return rgbToHex(readableOn(parseHex(surface)));
}
