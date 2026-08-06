import { tenantRoute, apiOk } from "@/lib/api/route";
import { readSettings } from "@/lib/erp/settings";
import { prorateMonthlyAmount, monthlyFixedTotal } from "@/lib/erp/prorate";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 86_400_000;

/**
 * Recurring monthly fixed costs, prorated onto the selected period.
 *
 * Salaries, rent, a standing subscription — entered once as a monthly figure
 * and then needed for whatever range the manager picks.
 *
 * Deliberately separate from UnexpectedCharge, which is a one-off with a date:
 * a fixed cost applies to every period, an unexpected one happened on ONE day
 * and only counts toward a calculation whose range includes it. Merging them
 * would either prorate a van repair across the year or charge the rent once.
 *
 * LP.16b. TWO THINGS WERE WRONG HERE AND BOTH WERE SILENT.
 *
 *  1. `periodType` WAS ACCEPTED AND ECHOED WITHOUT BEING USED. Every window got
 *     the day-count rule, so a week charged `7/30.44 = 0.23` of a month instead
 *     of a quarter — and four saved weeks then summed to 92% of a month, which
 *     is what `aggregate` builds a month out of. See `lib/erp/prorate.ts`.
 *
 *  2. THE PARAMETER NAMES DID NOT MATCH THE CALLER. The calculator sends
 *     `startDate`/`endDate`; this route read `since`/`until` and defaulted to
 *     the last 30 days when they were absent, so it answered confidently about
 *     a window nobody asked about. Both spellings are accepted now, the
 *     legacy's first.
 */
export const GET = tenantRoute("erp:finance:read", async ({ db, searchParams }) => {
  const settings = await readSettings(db);
  const monthly = monthlyFixedTotal(settings.fixedCosts);

  const periodType = searchParams.get("periodType") ?? "custom";
  const now = Date.now();
  const num = (...names: string[]) => {
    for (const name of names) {
      const raw = searchParams.get(name);
      if (raw !== null && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
    }
    return null;
  };
  const start = num("startDate", "since") ?? now - 30 * MS_PER_DAY;
  const end = num("endDate", "until") ?? now;

  const prorated = prorateMonthlyAmount(monthly, periodType, start, end);

  return apiOk({
    periodType,
    monthlyTotal: monthly.toString(),
    startDate: start,
    endDate: end,
    // Kept for the callers that read it, and still what the day-count branch
    // divides by — but it is no longer what decides the answer.
    days: Math.max(0, (end - start) / MS_PER_DAY),
    prorated: prorated.toString(),
  });
});
