import { z } from "zod";
import { Prisma } from "@landingos/db";

import { tenantRoute, apiOk, apiError, pagination } from "@/lib/api/route";
import { toJson, toDecimal, toDate } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/** Exported so the finance SCREEN offers exactly what this route accepts. */
export const PERIOD_TYPES = ["day", "week", "month", "quarter", "year", "custom"] as const;

/**
 * Saved profit-and-loss records. INSERT-ONLY.
 *
 * Saving the same period twice never updates the old row — it inserts a new one
 * with a later `createdAt`. The current record for a period is whichever row is
 * newest; the older ones stay forever as a record of what the business looked
 * like AT THE TIME each calculation was made. That is the point: a manager who
 * recalculates March in June wants both answers, because the difference between
 * them is usually a returned parcel and worth explaining.
 *
 * There is deliberately no PATCH and no DELETE. Their absence is the guarantee.
 */
export const GET = tenantRoute("erp:finance:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const periodType = searchParams.get("periodType")?.trim();

  const where = periodType ? { periodType } : {};

  const [items, total] = await Promise.all([
    db.financialRecord.findMany({
      where,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    db.financialRecord.count({ where }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});

const SaveRecord = z.object({
  periodType: z.enum(PERIOD_TYPES),
  startDate: z.union([z.string(), z.number()]),
  endDate: z.union([z.string(), z.number()]),
  revenue: z.union([z.string(), z.number()]).optional(),
  productCosts: z.union([z.string(), z.number()]).optional(),
  shippingCosts: z.union([z.string(), z.number()]).optional(),
  advertisingCosts: z.union([z.string(), z.number()]).optional(),
  fixedExpenses: z.union([z.string(), z.number()]).optional(),
  unexpectedExpenses: z.union([z.string(), z.number()]).optional(),
  notes: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(40).optional(),
  /* The per-product figures behind this total, for drill-down — LP.16d.
   *
   * A SNAPSHOT, not a relation, and deliberately so: it records what each
   * product contributed AT THE TIME the period was stated. A product renamed
   * or archived later must not change what March said, which is the same
   * argument that makes the record itself insert-only.
   *
   * Capped at 200 rows because it is a JSON column on an append-only table and
   * an uncapped one is an unbounded write from a form. */
  productBreakdown: z
    .array(
      z.object({
        name: z.string().trim().max(200),
        profit: z.union([z.string(), z.number()]).optional(),
        revenue: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .max(200)
    .optional(),
});

const ZERO = new Prisma.Decimal(0);
const money = (v: unknown) => toDecimal(v) ?? ZERO;

export const POST = tenantRoute("erp:finance:write", async ({ db, req, session }) => {
  const parsed = SaveRecord.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const input = parsed.data;

  const startDate = toDate(input.startDate);
  const endDate = toDate(input.endDate);
  if (!startDate || !endDate) {
    return apiError(422, "INVALID_INPUT", "A start and end date are required.");
  }
  if (endDate < startDate) {
    return apiError(422, "INVALID_INPUT", "The period ends before it starts.");
  }

  const revenue = money(input.revenue);
  const costs = [
    money(input.productCosts),
    money(input.shippingCosts),
    money(input.advertisingCosts),
    money(input.fixedExpenses),
    money(input.unexpectedExpenses),
  ];

  // DERIVED, never taken from the request. A client-supplied total is an input
  // to be ignored: the whole value of this record is that the arithmetic is the
  // server's, so two people reading the same period cannot see two answers.
  const netProfit = costs.reduce((acc, c) => acc.minus(c), revenue);
  const margin = revenue.isZero() ? ZERO : netProfit.dividedBy(revenue).times(100);

  const created = await db.financialRecord.create({
    data: {
      tenantId: session.auth!.tenantId,
      periodType: input.periodType,
      startDate,
      endDate,
      revenue,
      productCosts: costs[0],
      shippingCosts: costs[1],
      advertisingCosts: costs[2],
      fixedExpenses: costs[3],
      unexpectedExpenses: costs[4],
      netProfit,
      margin,
      notes: input.notes ?? "",
      source: input.source ?? "manual",
      // Money inside the snapshot is stored as the STRING the caller sent, not
      // as a JS number: this column is `Json`, and a float here would reproduce
      // the binary-float bug M-06 removed from every other money value on the
      // row beside it.
      productBreakdown: input.productBreakdown
        ? input.productBreakdown.map((p) => ({
            name: p.name,
            profit: String(p.profit ?? "0"),
            revenue: String(p.revenue ?? "0"),
          }))
        : undefined,
      actorUserId: session.user.id,
    },
  });

  return apiOk(toJson(created), { status: 201 });
});
