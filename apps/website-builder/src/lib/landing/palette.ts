import "server-only";

import sharp from "sharp";

/* =============================================================================
 * A storefront theme, extracted from a product photograph — LB.22.
 *
 * THE HARD PART IS NOT FINDING THE COLOURS. Averaging pixels is four lines.
 * The part that decides whether this feature is worth shipping is that the
 * result must be READABLE: an automatically generated theme that puts white
 * text on a pale yellow buy button is worse than no feature at all, because it
 * ships a broken storefront to a real customer and the merchant only finds out
 * from their conversion rate.
 *
 * So every colour this produces is checked against WCAG contrast before it is
 * returned, and the two that carry text — `primaryForeground` on `primary`,
 * and `text` on `background` — are CHOSEN by contrast rather than derived and
 * hoped over. The extracted hue survives in the parts where being wrong is
 * cosmetic (the accent, the card tint, the border) and yields where being
 * wrong is a lost sale.
 *
 * WHY NOT A DEPENDENCY. `sharp` is already here for uploads and can resample an
 * image to a small raster in one call; the quantiser below is a histogram over
 * ~4 096 pixels. A colour-thief package would be a new dependency, a new
 * licence and a new supply-chain surface for thirty lines of arithmetic.
 * ========================================================================== */

export interface ExtractedTheme {
  readonly primary: string;
  readonly primaryForeground: string;
  readonly accent: string;
  readonly background: string;
  readonly card: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/* --- colour maths, in the smallest amount that does the job ---------------- */

const hex = ({ r, g, b }: Rgb) =>
  "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** WCAG relative luminance. The sRGB gamma expansion matters — a linear
 *  average of channels calls mid-blue and mid-yellow equally bright, and they
 *  are not remotely. */
function luminance({ r, g, b }: Rgb): number {
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

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
/** Not pure black: #111 on a coloured surface reads as deliberate, #000 as a
 *  fault. The contrast difference against anything mid-tone is negligible. */
const NEAR_BLACK: Rgb = { r: 17, g: 17, b: 17 };

/**
 * The readable foreground for a surface: whichever of near-black and white
 * contrasts more. Chosen, not assumed — this is the single line that stops the
 * feature shipping unreadable buttons.
 */
function readableOn(surface: Rgb): Rgb {
  return contrastRatio(surface, NEAR_BLACK) >= contrastRatio(surface, WHITE)
    ? NEAR_BLACK
    : WHITE;
}

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === R ? ((G - B) / d + (G < B ? 6 : 0))
      : max === G ? (B - R) / d + 2
        : (R - G) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
      : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/* --- extraction ----------------------------------------------------------- */

/**
 * The dominant colour, by a histogram over a small raster.
 *
 * QUANTISED TO A 5-BIT-PER-CHANNEL GRID (32 levels) before counting. A raw
 * histogram of 24-bit colour on a photograph finds 4 000 buckets of one pixel
 * each and the "most common colour" is noise. Bucketing first is what makes
 * "most of this photograph is this colour" a real answer.
 *
 * NEAR-WHITE AND NEAR-BLACK ARE EXCLUDED FROM THE VOTE. Product photography is
 * overwhelmingly shot on a white sweep, so the honest dominant colour of most
 * of these images is the backdrop — which would theme every storefront white on
 * white. Very dark pixels go for the same reason (shadow, not subject). If the
 * image is nothing BUT those, the caller gets null and no theme is invented.
 */
function dominantColours(pixels: Buffer, channels: number): Rgb[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i + channels - 1 < pixels.length; i += channels) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    // Transparent pixels are not part of the subject.
    if (channels === 4 && pixels[i + 3] < 128) continue;

    const { s, l } = toHsl({ r, g, b });
    if (l > 0.92 || l < 0.08) continue;   // backdrop and shadow
    if (s < 0.12 && l > 0.75) continue;   // washed-out near-white grey

    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    // The bucket's MEAN, not its centre: the grid is for counting, and
    // returning the grid point would visibly posterise the result.
    .map((x) => ({ r: x.r / x.count, g: x.g / x.count, b: x.b / x.count }));
}

/**
 * Build a full theme from an image.
 *
 * Returns null when the image yields nothing to build from — a pure-white
 * cutout, a transparent PNG, an unreadable file. Null is a real answer here and
 * the caller reports it; inventing a plausible theme from no evidence would be
 * the worst outcome, because it looks like it worked.
 */
export async function themeFromImage(input: Buffer): Promise<ExtractedTheme | null> {
  let raw: { data: Buffer; info: sharp.OutputInfo };
  try {
    raw = await sharp(input)
      // 64×64 is ~4 096 samples: enough for a stable histogram, small enough
      // that this is microseconds rather than a job.
      .resize(64, 64, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    // Not an image, or one sharp refuses. The caller turns this into a
    // refusal the merchant can read.
    return null;
  }

  const colours = dominantColours(raw.data, raw.info.channels);
  if (colours.length === 0) return null;

  const base = colours[0];
  const { h, s } = toHsl(base);
  // A photograph's dominant colour is often too dark or too washed to be a
  // BUTTON. The hue is the signal; the saturation and lightness are pinned to
  // a range that reads as a deliberate brand colour.
  const primary = fromHsl(h, clamp(s, 0.45, 0.85), clamp(toHsl(base).l, 0.36, 0.52));

  /* The accent is the second distinct hue if the photograph has one, and a
   * rotation of the primary if it does not. "Distinct" is more than 25° away —
   * closer than that and the two read as one colour used twice. */
  const second = colours.slice(1).find((c) => {
    const d = Math.abs(toHsl(c).h - h);
    return Math.min(d, 360 - d) > 25;
  });
  const accent = second
    ? fromHsl(toHsl(second).h, clamp(toHsl(second).s, 0.4, 0.8), 0.45)
    : fromHsl(h + 150, clamp(s, 0.4, 0.8), 0.45);

  // The page's surfaces: the hue, barely there. A storefront tinted 4% toward
  // the product's colour reads as considered; at 20% it reads as a theme
  // somebody could not switch off.
  const background = fromHsl(h, 0.10, 0.985);
  const card = { r: 255, g: 255, b: 255 };
  const text = readableOn(background);
  const muted = fromHsl(h, 0.08, 0.45);
  const border = fromHsl(h, 0.10, 0.90);

  return {
    primary: hex(primary),
    // CHOSEN by contrast, never derived. This is the pair that would otherwise
    // ship an unreadable buy button.
    primaryForeground: hex(readableOn(primary)),
    accent: hex(accent),
    background: hex(background),
    card: hex(card),
    text: hex(text),
    muted: hex(muted),
    border: hex(border),
  };
}

/** Parse `#rrggbb` back to RGB — for the tests, and for asserting contrast. */
export function parseHex(value: string): Rgb {
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}
