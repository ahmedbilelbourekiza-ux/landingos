import { Prisma } from "@landingos/db";
import { refuseIfFinanceOff } from "@/lib/erp/finance-module";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { toDate } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/**
 * Roll already-saved sub-period records up into one figure — LP.16c, P6.
 *
 * The requirement this exists for says it plainly: *"Monthly reports must
 * automatically use the saved weekly records… Yearly reports must automatically
 * use the saved monthly records."* A quarter is not recomputed from raw orders;
 * it is the three months somebody already stated, added up.
 *
 * IT TOUCHES NO ORDERS AND NO INVENTORY. That is the whole point — it is the
 * fast path, and it is also the HONEST path: recomputing March in June gives a
 * different answer to the one March was closed with (a parcel came back), and a
 * year built out of twelve recomputations would silently disagree with the
 * twelve months the business actually reported.
 *
 * NOTHING IS SAVED HERE. The result is computed and returned; it becomes a
 * record only when somebody POSTs it back with `source: "aggregated"`. A GET
 * that writes a permanent financial record would be a GET with a side effect on
 * the books.
 *
 * TWO PROPERTIES THAT ARE EASY TO GET WRONG, AND BOTH ARE ARITHMETIC:
 *
 *  1. ONE VERSION PER SUB-PERIOD. Records are insert-only, so re-saving a
 *     corrected week leaves two rows for that week. Summing both charges the
 *     week twice. Only the NEWEST save of each distinct (start, end) counts —
 *     which is also the only reading consistent with "the current record for a
 *     period is whichever row is newest".
 *
 *  2. `covered: false` NAMES WHAT IS MISSING rather than returning a smaller
 *     number. A month built from three of its four weeks is not a month, and
 *     the failure a partial silently-shorter total produces is a business that
 *     believes it made more than it did.
 *
 * `fixedExpenses` is summed like any other column and NOT recomputed, because
 * each sub-record already stores its own prorated share. That is exactly why
 * the week rule is `÷ 4` and not a day count — see `lib/erp/prorate.ts`.
 */

/** What a period is built out of. Nothing rolls up into a week or a day. */
const SUB_PERIOD: Record<string, string> = {
  month: "week",
  quarter: "month",
  year: "month",
};

const COST_COLUMNS = [
  "productCosts",
  "shippingCosts",
  "advertisingCosts",
  "fixedExpenses",
  "unexpectedExpenses",
] as const;

export const GET = tenantRoute("erp:finance:read", async ({ db, searchParams }) => {
  // LB.18 — a module the company switched off does not accept calls either;
  // hiding the nav item is not what makes it gone.
  const off = await refuseIfFinanceOff(db);
  if (off) return off;

  const periodType = searchParams.get("periodType")?.trim();
  const startDate = toDate(searchParams.get("startDate"));
  const endDate = toDate(searchParams.get("endDate"));

  if (!periodType || !startDate || !endDate) {
    return apiError(422, "INVALID_INPUT", "periodType, startDate and endDate are required.");
  }

  const subPeriodType = SUB_PERIOD[periodType];
  if (!subPeriodType) {
    // Refused by NAME rather than answered with zeroes. "There is nothing
    // smaller than a week to add up" is a different fact from "the weeks you
    // are asking about made no money", and a caller told the second when the
    // first is true will go looking for missing orders.
    return apiOk({
      covered: false,
      subRecordsUsed: 0,
      reason: "no_smaller_unit",
      periodType,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
    });
  }

  const rows = await db.financialRecord.findMany({
    where: {
      periodType: subPeriodType,
      // By START, half-open. A week beginning inside the month belongs to it;
      // one beginning on the 1st of the next does not, even though a
      // Monday-to-Sunday week routinely straddles the boundary. Matching by
      // overlap instead would count that week in both months.
      startDate: { gte: startDate, lt: endDate },
    },
    orderBy: { createdAt: "desc" },
  });

  // Newest save per distinct period — see property 1 above.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.startDate.getTime()}:${row.endDate.getTime()}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const used = [...latest.values()];

  if (!used.length) {
    return apiOk({
      covered: false,
      subRecordsUsed: 0,
      reason: "no_saved_sub_records",
      subPeriodType,
      periodType,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
    });
  }

  const ZERO = new Prisma.Decimal(0);
  const sum = (key: "revenue" | (typeof COST_COLUMNS)[number]) =>
    used.reduce((acc, r) => acc.plus(r[key] ?? ZERO), ZERO);

  const revenue = sum("revenue");
  const costs = Object.fromEntries(COST_COLUMNS.map((c) => [c, sum(c)])) as Record<
    (typeof COST_COLUMNS)[number],
    Prisma.Decimal
  >;
  // Derived here the same way POST derives it, so aggregating a period and
  // saving it produce the same two numbers rather than two opinions.
  const netProfit = COST_COLUMNS.reduce((acc, c) => acc.minus(costs[c]), revenue);
  const margin = revenue.isZero() ? ZERO : netProfit.dividedBy(revenue).times(100);

  return apiOk({
    covered: true,
    subRecordsUsed: used.length,
    subPeriodType,
    periodType,
    startDate: startDate.getTime(),
    endDate: endDate.getTime(),
    revenue: revenue.toString(),
    productCosts: costs.productCosts.toString(),
    shippingCosts: costs.shippingCosts.toString(),
    advertisingCosts: costs.advertisingCosts.toString(),
    fixedExpenses: costs.fixedExpenses.toString(),
    unexpectedExpenses: costs.unexpectedExpenses.toString(),
    netProfit: netProfit.toString(),
    margin: margin.toString(),
    // Which sub-periods went in, so a manager can see the three weeks that were
    // found and notice the fourth that was not.
    covers: used
      .map((r) => ({ startDate: r.startDate.getTime(), endDate: r.endDate.getTime() }))
      .sort((a, b) => a.startDate - b.startDate),
  });
});
