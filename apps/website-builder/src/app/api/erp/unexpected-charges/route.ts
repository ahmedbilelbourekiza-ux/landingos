import { z } from "zod";

import { tenantRoute, apiOk, apiError, pagination } from "@/lib/api/route";
import { toJson, toDecimal, toDate } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/**
 * One-off dated expenses.
 *
 * These ARE deletable, unlike FinancialRecord next door, and the difference is
 * deliberate. A saved P&L is a statement somebody made about a period and has
 * historical meaning even when it is later superseded. A van repair typed in
 * with the wrong amount has none — it is data entry, and refusing to let it be
 * corrected would only produce a compensating negative charge.
 */
export const GET = tenantRoute("erp:finance:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  const where = since || until
    ? {
        date: {
          ...(since ? { gte: new Date(Number(since)) } : {}),
          ...(until ? { lte: new Date(Number(until)) } : {}),
        },
      }
    : {};

  const [items, total] = await Promise.all([
    db.unexpectedCharge.findMany({ where, orderBy: { date: "desc" }, skip, take }),
    db.unexpectedCharge.count({ where }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});

const AddCharge = z.object({
  label: z.string().trim().min(1).max(200),
  amount: z.union([z.string(), z.number()]),
  date: z.union([z.string(), z.number()]).optional(),
});

export const POST = tenantRoute("erp:finance:write", async ({ db, req, session }) => {
  const parsed = AddCharge.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const amount = toDecimal(parsed.data.amount);
  if (amount === null) return apiError(422, "INVALID_INPUT", '"amount" must be a number.');

  const created = await db.unexpectedCharge.create({
    data: {
      tenantId: session.auth!.tenantId,
      label: parsed.data.label,
      amount,
      // The day it HAPPENED, not the day it was typed in. A repair entered a
      // week late belongs in the week it happened, or every period boundary
      // reports the wrong number.
      date: toDate(parsed.data.date) ?? new Date(),
    },
  });

  return apiOk(toJson(created), { status: 201 });
});
