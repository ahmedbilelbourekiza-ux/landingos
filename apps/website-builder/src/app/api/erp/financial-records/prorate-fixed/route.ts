import { Prisma } from "@landingos/db";

import { tenantRoute, apiOk } from "@/lib/api/route";
import { readSettings } from "@/lib/erp/settings";
import { toDecimal } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 86_400_000;
const MEAN_MONTH_DAYS = 30.44;

/**
 * Recurring monthly fixed costs, prorated onto an arbitrary window.
 *
 * Salaries, rent, a standing subscription — entered once as a monthly figure
 * and then needed for whatever range the manager picks. Proration by day count
 * is what makes "the 3rd to the 19th" answerable at all.
 *
 * Deliberately separate from UnexpectedCharge, which is a one-off with a date:
 * a fixed cost applies to every period, an unexpected one happened on ONE day
 * and only counts toward a calculation whose range includes it. Merging them
 * would either prorate a van repair across the year or charge the rent once.
 */
export const GET = tenantRoute("erp:finance:read", async ({ db, searchParams }) => {
  const settings = await readSettings(db);
  const fixedCosts = Array.isArray(settings.fixedCosts) ? settings.fixedCosts : [];

  const monthly = fixedCosts.reduce(
    (sum: Prisma.Decimal, cost) => sum.plus(toDecimal((cost as { amount?: unknown })?.amount) ?? 0),
    new Prisma.Decimal(0),
  );

  const now = Date.now();
  const since = Number(searchParams.get("since")) || now - 30 * MS_PER_DAY;
  const until = Number(searchParams.get("until")) || now;
  const days = Math.max(0, (until - since) / MS_PER_DAY);

  const prorated = monthly.dividedBy(MEAN_MONTH_DAYS).times(days);

  return apiOk({
    monthlyTotal: monthly.toString(),
    days,
    prorated: prorated.toString(),
    periodType: searchParams.get("periodType") ?? "custom",
  });
});
