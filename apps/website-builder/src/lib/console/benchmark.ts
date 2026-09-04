import type { StatusTone } from "@landingos/ui";

/* =============================================================================
 * TR.2 — the console's ONE severity scale for a measured figure.
 *
 * Four tiers, in the order a merchant reads them: red is bad, orange is nearly
 * bad, blue is nearly good, green is good. They map onto the four semantic
 * tones the design system already carries (`danger`, `warning`, `info`,
 * `success`), so nothing here invents a colour — it only decides which of the
 * existing four a number deserves, and every screen that adopts this file
 * says the same thing with the same colour.
 *
 * THE RULE THAT MATTERS: NO BENCHMARK, NO COLOUR. `tierFor` returns null when
 * it is handed null thresholds, and null renders as neutral grey. A cost per
 * order is not "bad" at 900 DA — it is bad at 900 DA for a product with 700 DA
 * of margin and fine for one with 3,000 — and colouring it from a number this
 * platform made up would be a lie a merchant might act on. So a figure is
 * grey until either the product ships a benchmark it can cite, or the
 * merchant sets their own cut points (see `traffic-tiles.ts`).
 *
 * PURE. No `t()`, no JSX, no database — testable without a server, the same
 * rule `traffic-triage.ts` and `spend-math.ts` follow.
 * ========================================================================== */

export type Tier = "bad" | "almostBad" | "almostGood" | "good";

export const TIERS: readonly Tier[] = ["bad", "almostBad", "almostGood", "good"];

/** Which of the design system's tones each tier renders in. */
export const TIER_TONE: Record<Tier, StatusTone> = {
  bad: "danger",
  almostBad: "warning",
  almostGood: "info",
  good: "success",
};

/**
 * Three cut points that divide the number line into four bands.
 *
 * Read as band CEILINGS when a higher figure is better: everything below
 * `bad` is bad, below `almostBad` is nearly bad, below `almostGood` is nearly
 * good, and the rest is good. When a LOWER figure is better (a cost), the same
 * three numbers are floors and the comparison flips — so a merchant sets
 * "cost per order: 1500 / 1200 / 900" and reads it the same way in both
 * directions: the first number is where it turns bad.
 */
export interface Thresholds {
  readonly bad: number;
  readonly almostBad: number;
  readonly almostGood: number;
}

/**
 * The tier a value falls in, or null when it cannot be judged.
 *
 * Null for a null value (the figure was not measurable — a rate over a zero
 * denominator, an unsynced spend), and null for null thresholds (nobody has
 * said what good looks like). Both render as neutral, and the caller must not
 * tell them apart with a colour.
 */
export function tierFor(
  value: number | null,
  thresholds: Thresholds | null,
  higherIsBetter: boolean,
): Tier | null {
  if (value === null || !Number.isFinite(value) || thresholds === null) return null;
  const { bad, almostBad, almostGood } = thresholds;
  if (higherIsBetter) {
    if (value < bad) return "bad";
    if (value < almostBad) return "almostBad";
    if (value < almostGood) return "almostGood";
    return "good";
  }
  if (value > bad) return "bad";
  if (value > almostBad) return "almostBad";
  if (value > almostGood) return "almostGood";
  return "good";
}

/** The tone for a value, or null for neutral. One call for the common case. */
export function toneFor(
  value: number | null,
  thresholds: Thresholds | null,
  higherIsBetter: boolean,
): StatusTone | null {
  const tier = tierFor(value, thresholds, higherIsBetter);
  return tier === null ? null : TIER_TONE[tier];
}

/**
 * Whether three cut points are usable in the given direction.
 *
 * Strictly monotonic, so no band is empty: a merchant who types 900 / 900 /
 * 900 has not described four bands, and the settings route refuses it rather
 * than storing a scale where "nearly bad" can never happen.
 */
export function validThresholds(t: Thresholds, higherIsBetter: boolean): boolean {
  const nums = [t.bad, t.almostBad, t.almostGood];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  return higherIsBetter
    ? t.bad < t.almostBad && t.almostBad < t.almostGood
    : t.bad > t.almostBad && t.almostBad > t.almostGood;
}
