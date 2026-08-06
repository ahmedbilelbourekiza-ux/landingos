/* =============================================================================
 * Exact decimal arithmetic that also runs in a browser — LP.16d.
 *
 * NO `"server-only"` DIRECTIVE, DELIBERATELY. This is imported by a client
 * component, and it is the one place in the console where money is added,
 * multiplied and divided outside Postgres.
 *
 * WHY THIS EXISTS RATHER THAN `+(el.value)`.
 *
 * The legacy profit calculator is `Number(...)` end to end — 1,244 lines of
 * binary floating point, and the figure that comes out of it is POSTed and
 * stored as the company's permanent record of a month. `0.1 + 0.2` is
 * `0.30000000000000004`; multiply a shipping cost by 260 units and add six of
 * those and the total is off by an amount that is small, real, and impossible
 * to reconcile against a carrier's statement. Assumption 7 of this project says
 * money is a Decimal formatted from its string form and never a JS float, and a
 * calculator is the last place to make an exception.
 *
 * WHY NOT `Prisma.Decimal`. It arrives through `@landingos/db`, which is
 * server-only and drags a client into the bundle. The operations here are
 * `+ − × ÷` on values with at most three decimal places; sixty lines of scaled
 * `bigint` is exact for all of them and ships nothing.
 *
 * THE REPRESENTATION. A `Money` is a `bigint` of MICROS — the value times
 * 10^6. Six places is deliberate: a price and a quantity each carry at most
 * three, so every product in this calculator (`unit × units`, `usd × rate`) is
 * exact rather than rounded. Division rounds half away from zero, because a
 * ratio of two money values is not a money value and has to stop somewhere.
 *
 * Everything crosses the boundary as a STRING. `toString` is what a route
 * parses into a `Decimal`; a number would undo the whole point on the way out.
 * ========================================================================== */

export type Money = bigint;

const PLACES = 6;
const UNIT = 1_000_000n;

export const ZERO: Money = 0n;

/**
 * Parse whatever a text input or an API string carries.
 *
 * Anything unparseable is ZERO rather than an error: every one of these values
 * comes from a box a person is still typing into, and a half-typed `-` must
 * leave the rest of the sheet computable. A field that is WRONG rather than
 * empty is the caller's problem to show, not this function's to throw about.
 */
export function money(value: unknown): Money {
  if (typeof value === "bigint") return value;
  if (value === null || value === undefined) return ZERO;

  const text = String(value).trim().replace(/\s/g, "");
  if (!text) return ZERO;

  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m) return ZERO;

  const [, sign, whole, frac = ""] = m;
  if (!whole && !frac) return ZERO;

  // Pad or truncate the fraction to exactly PLACES. Truncation past the sixth
  // decimal is the only lossy step in this module and cannot be reached by any
  // input the calculator offers.
  const fixed = (frac + "0".repeat(PLACES)).slice(0, PLACES);
  const magnitude = BigInt((whole || "0") + fixed);
  return sign === "-" ? -magnitude : magnitude;
}

/** A whole count — units sold, a return count — as a Money for mixed arithmetic. */
export function count(value: unknown): Money {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? BigInt(n) * UNIT : ZERO;
}

export const add = (a: Money, b: Money): Money => a + b;
export const sub = (a: Money, b: Money): Money => a - b;

/** Round half away from zero, which is what a person doing this by hand does. */
function scaledDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

export const mul = (a: Money, b: Money): Money => scaledDivide(a * b, UNIT);

/** Division by zero is ZERO, not Infinity — see `breakEven` for the one case
 *  where "cannot" is a real answer and is reported as one. */
export const div = (a: Money, b: Money): Money => (b === 0n ? ZERO : scaledDivide(a * UNIT, b));

export const isNegative = (a: Money): boolean => a < 0n;
export const isZero = (a: Money): boolean => a === 0n;
export const gt = (a: Money, b: Money): boolean => a > b;

/** `profit / basis × 100`, as a percentage Money. Zero basis → zero. */
export const percent = (part: Money, whole: Money): Money =>
  whole === 0n ? ZERO : mul(div(part, whole), 100n * UNIT);

/**
 * How many more units cover the fixed and variable costs.
 *
 * `null` when a unit does not pay for itself — the answer the legacy shows as
 * `∞`, and the one that ends a product line. Reporting a huge number instead
 * would suggest the problem is volume when it is price.
 */
export function breakEven(allCosts: Money, contributionPerUnit: Money): number | null {
  if (contributionPerUnit <= 0n) return null;
  const exact = div(allCosts, contributionPerUnit);
  // Ceiling: selling 12.3 units is selling 13.
  const whole = exact / UNIT;
  return Number(exact % UNIT === 0n ? whole : whole + 1n);
}

/** The canonical string a route parses back into a `Decimal`. */
export function toString(value: Money, places = 2): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;

  const dropped = PLACES - Math.max(0, Math.min(PLACES, places));
  const divisor = 10n ** BigInt(dropped);
  const rounded = dropped === 0 ? magnitude : scaledDivide(magnitude, divisor);

  const scale = 10n ** BigInt(PLACES - dropped);
  const whole = rounded / scale;
  const frac = rounded % scale;

  const text = places > 0
    ? `${whole}.${String(frac).padStart(PLACES - dropped, "0")}`
    : String(whole);
  return negative && (whole !== 0n || frac !== 0n) ? `-${text}` : text;
}
