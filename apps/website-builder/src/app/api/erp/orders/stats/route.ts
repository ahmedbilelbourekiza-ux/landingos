import { tenantRoute, apiOk } from "@/lib/api/route";
import { scopedWhere } from "@/lib/erp/scope";
import { orderFilters } from "@/lib/erp/orders";

export const dynamic = "force-dynamic";

/**
 * Counts by status for the whole filtered set, without returning any rows.
 *
 * The dashboard tiles used to be computed by downloading every order and
 * counting in the browser. `groupBy` does it in one query and returns numbers
 * rather than a table.
 *
 * This route is also the reason `/orders/stats` needs its own file rather than
 * falling through to `/orders/[id]`: a dynamic segment would match "stats",
 * look it up as an order id, find nothing and 404 a working endpoint. Next
 * resolves a static segment ahead of a dynamic sibling, so the file layout is
 * what prevents it — no exemption list to keep in sync, which is what the ERP
 * needed.
 */
export const GET = tenantRoute("erp:orders:read", async ({ db, session, searchParams }) => {
  const where = scopedWhere(session, orderFilters(searchParams));

  const grouped = await db.fulfillmentOrder.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });

  const out: Record<string, number> = { total: 0 };
  for (const row of grouped) {
    const count = row._count._all;
    out[row.status || "unknown"] = count;
    out.total += count;
  }
  return apiOk(out);
});
