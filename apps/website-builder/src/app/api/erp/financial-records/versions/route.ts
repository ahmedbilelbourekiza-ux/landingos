import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { toJson, toDate } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/**
 * Every version ever saved for ONE exact period — LP.16c, P5.
 *
 * "What did we think the week of 5 January looked like, and when did that
 * change?" Records are insert-only, so the data has always been here; there was
 * no way to ask the question. `GET /financial-records` lists periods; this
 * lists the SAVES of one period, newest first.
 *
 * The difference between two versions of the same week is almost always a
 * parcel that came back after the first calculation was made — which is the
 * single most common thing a manager needs explained, and the reason the older
 * row is kept rather than updated.
 *
 * All three parameters are REQUIRED and none has a default. A version list is
 * only meaningful for one exact period; defaulting the window would answer a
 * question nobody asked with a list that looks authoritative.
 */
export const GET = tenantRoute("erp:finance:read", async ({ db, searchParams }) => {
  const periodType = searchParams.get("periodType")?.trim();
  const startDate = toDate(searchParams.get("startDate"));
  const endDate = toDate(searchParams.get("endDate"));

  if (!periodType || !startDate || !endDate) {
    return apiError(422, "INVALID_INPUT", "periodType, startDate and endDate are required.");
  }

  const items = await db.financialRecord.findMany({
    where: { periodType, startDate, endDate },
    orderBy: { createdAt: "desc" },
  });

  return apiOk({
    periodType,
    startDate: startDate.getTime(),
    endDate: endDate.getTime(),
    items: items.map(toJson),
    total: items.length,
  });
});
