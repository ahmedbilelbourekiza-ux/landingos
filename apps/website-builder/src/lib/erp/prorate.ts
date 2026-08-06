import { Prisma } from "@landingos/db";

/* =============================================================================
 * Scaling a MONTHLY figure onto a period — LP.16b.
 *
 * A rent, a salary, a standing subscription: entered once as a monthly amount
 * and then needed for whatever window somebody picked. Two callers need it and
 * they must not disagree — fixed costs on a saved P&L, and the salary half of
 * an agent's payroll. The legacy had exactly one function for both, deliberately
 * ("ONE rule, one place, instead of two copies that could drift apart"); the
 * platform had two copies of half of it, and both were the wrong half.
 *
 * THE RULE IS KEYED ON `periodType`, AND THE ALIGNED CASES ARE NOT ROUNDING.
 *
 *   month    → the amount, unchanged
 *   week     → ÷ 4
 *   quarter  → × 3
 *   year     → × 12
 *   day      → ÷ the number of days in THAT month
 *   anything → ÷ 30.44 × the day count
 *
 * `÷ 4` for a week looks arbitrary and is the load-bearing line here. FOUR
 * SAVED WEEKS MUST TILE INTO EXACTLY ONE MONTH, because `aggregate` builds a
 * month by SUMMING four saved weekly records rather than recomputing one:
 * `4 × monthly/4 = monthly`. Day-counting a week instead gives
 * `4 × (7/30.44) × monthly = 0.92 × monthly` — an 8% under-charge of fixed
 * costs on every aggregated month, which compounds to a full month's rent
 * missing from a year and is invisible because every individual number looks
 * plausible.
 *
 * The day-count rule is the RIGHT answer for an arbitrary window ("the 3rd to
 * the 19th") and the wrong one for an aligned one. Both are needed; the
 * `periodType` is what says which, and it is the parameter the platform's
 * routes accepted and echoed back without ever using.
 *
 * 30.44 is 365.25 / 12 — the mean month, so a full month of day-counting comes
 * back to roughly what was entered rather than to a figure that depends on
 * which month it happened to be.
 * ========================================================================== */

const MS_PER_DAY = 86_400_000;
const MEAN_MONTH_DAYS = 30.44;

/** The period vocabulary this rule keys on — the same one `FinancialRecord` stores. */
export type PeriodType = "day" | "week" | "month" | "quarter" | "year" | "custom";

/**
 * Scale `monthly` onto [`start`, `end`] under `periodType`.
 *
 * An unrecognised `periodType` falls through to the day count rather than being
 * refused, exactly like an unknown sort column: this is arithmetic on a figure
 * somebody already entered, and answering "custom" is always defensible where
 * answering nothing is not.
 */
export function prorateMonthlyAmount(
  monthly: Prisma.Decimal,
  periodType: string | null | undefined,
  start: number,
  end: number,
): Prisma.Decimal {
  switch (periodType) {
    case "month":
      return monthly;
    case "week":
      return monthly.dividedBy(4);
    case "quarter":
      return monthly.times(3);
    case "year":
      return monthly.times(12);
    case "day": {
      // The real length of the month the day falls in, not an average: a day in
      // February is a larger share of February's rent than a day in January is
      // of January's, and a manager comparing two days would otherwise see a
      // difference that is not there.
      const d = new Date(Number(start) || 0);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return monthly.dividedBy(daysInMonth || 1);
    }
    default: {
      // `Math.max(1, …)` because a zero-length window is a same-day range, not
      // a free one — and because dividing by an unrounded fraction of a day
      // produces a figure nobody can reconcile against a calendar.
      const days = Math.max(1, Math.round(((Number(end) || 0) - (Number(start) || 0)) / MS_PER_DAY));
      return monthly.dividedBy(MEAN_MONTH_DAYS).times(days);
    }
  }
}

/**
 * Calendar-ALIGNED boundaries for a period type, from a reference instant.
 *
 * "This week" means the real Monday-to-Sunday week, not a rolling seven days,
 * and that distinction is the same tiling argument as `÷ 4` above: four rolling
 * windows overlap and leave gaps, four calendar weeks do not.
 *
 * It is deliberately NOT `orderFilters`' `range=week`, which IS a rolling
 * window and is right for "what came in recently". Two vocabularies, because
 * they answer two different questions — and naming them the same thing is what
 * would make them silently interchangeable.
 *
 * Returns null for `custom`, which has no alignment by definition.
 */
export function alignedRange(
  periodType: string,
  now: Date = new Date(),
): { start: number; end: number } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (periodType) {
    case "day": {
      const start = new Date(y, m, d).getTime();
      return { start, end: start + MS_PER_DAY - 1 };
    }
    case "week": {
      // getDay() is 0=Sunday. Monday is the week's start here because that is
      // the working week these numbers describe.
      const dow = now.getDay();
      const monday = new Date(y, m, d + (dow === 0 ? -6 : 1 - dow)).getTime();
      return { start: monday, end: monday + 7 * MS_PER_DAY - 1 };
    }
    case "month":
      return { start: new Date(y, m, 1).getTime(), end: new Date(y, m + 1, 1).getTime() - 1 };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { start: new Date(y, q, 1).getTime(), end: new Date(y, q + 3, 1).getTime() - 1 };
    }
    case "year":
      return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() - 1 };
    default:
      return null;
  }
}

/** The one shape a fixed-cost row has, wherever it is read. */
export interface FixedCost {
  readonly id?: string;
  readonly label?: string;
  readonly amount?: unknown;
}

/**
 * The monthly total of a tenant's configured fixed costs.
 *
 * Tolerant of a malformed row rather than refusing the whole list: these are
 * validated on the way in (`fixedCosts` is an `array` in `SETTINGS_SCHEMA` and
 * the editor writes `{ id, label, amount }`), but rows written before the
 * editor existed are reachable through the API, and one bad amount must not
 * make a company's rent read as an error.
 */
export function monthlyFixedTotal(value: unknown): Prisma.Decimal {
  const list = Array.isArray(value) ? value : [];
  let total = new Prisma.Decimal(0);
  for (const row of list) {
    const raw = (row as FixedCost)?.amount;
    if (raw === null || raw === undefined || raw === "") continue;
    try {
      total = total.plus(new Prisma.Decimal(String(raw)));
    } catch {
      // Not a number. Skipped, not thrown: see above.
    }
  }
  return total;
}
