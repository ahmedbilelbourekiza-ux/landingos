import { tenantRoute, apiError } from "@/lib/api/route";
import { toCsv, EXPORT_LIMIT } from "@/lib/erp/export";
import {
  CLIENT_SELECT, clientFilters, clientHistoryPhones, withDerived,
} from "@/lib/erp/clients";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The customer registry as a file — LP.10, the last quarter of R5.
 *
 * A COD business runs its repeat-purchase campaigns out of a spreadsheet: the
 * customers in Alger who have taken delivery three times get an SMS. Until this
 * route the registry could be read on a screen and left the building by no
 * route at all — while the schema carried five `imported*` columns for the
 * inbound half that also did not exist.
 *
 * D-LP.6.2 APPLIES UNCHANGED: THE EXPORT IS THE LIST. The same query string
 * goes through the same `clientFilters` and `clientHistoryPhones` the screen
 * uses, so a file and the filter bar that produced it cannot disagree about
 * what "customers in Alger with three deliveries" contained.
 *
 * Sharing `toCsv` and `EXPORT_LIMIT` with the order export is not tidiness. It
 * is what carries the two spreadsheet properties that are security rather than
 * polish: a cell beginning `=`, `+`, `-` or `@` is a FORMULA to Excel — and a
 * customer name arrives from a storefront, typed by a stranger — and the file
 * needs a UTF-8 BOM or every accented wilaya opens as mojibake.
 * ========================================================================== */

/** The legacy's own column names, so a file exported here re-imports there. */
const HEADERS = [
  "Name", "Phone", "Wilaya", "Commune", "Address",
  "Total Orders", "Confirmed", "Cancelled", "Delivered",
  "Total Spent", "Avg Order Value",
  "First Order", "Last Order",
  "Imported Orders", "Imported Spent", "Import Source",
] as const;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export const GET = tenantRoute("erp:clients:read", async ({ db, searchParams }) => {
  const phones = await clientHistoryPhones(db, searchParams);
  const where = {
    ...clientFilters(searchParams),
    // `phones` is null when neither history filter was asked for. An empty
    // ARRAY is different and must be honoured: it means "the filter matched no
    // orders", so the file is empty — not unfiltered.
    ...(phones === null ? {} : { phone: { in: phones } }),
  };

  const total = await db.client.count({ where });
  if (total > EXPORT_LIMIT) {
    // Named refusal, never a short file that looks complete (LP.6).
    return apiError(
      422,
      "TOO_MANY_ROWS",
      `This export would be ${total} rows; the limit is ${EXPORT_LIMIT}. Narrow the filters.`,
      { total, limit: EXPORT_LIMIT },
    );
  }

  const rows = await db.client.findMany({
    where,
    orderBy: [{ lastOrderAt: "desc" }, { id: "desc" }],
    take: EXPORT_LIMIT,
    select: CLIENT_SELECT,
  });

  const body = toCsv(
    HEADERS,
    rows.map((raw) => {
      const c = withDerived(raw);
      return [
        c.name ?? "",
        // The display form, which is what a person dials, with the normalised
        // form as the fallback so a row is never phone-less.
        c.phoneDisplay || c.phone,
        c.wilaya ?? "", c.commune ?? "", c.address ?? "",
        c.totalOrders, c.confirmedOrders, c.cancelledOrders, c.deliveredOrders,
        c.totalSpent.toString(), c.avgOrderValue.toFixed(2),
        day(c.firstOrderAt), day(c.lastOrderAt),
        // Carried so an old-CRM import is not invisible in the export: in and
        // back out again is the same data, which is the round trip the legacy's
        // comment on this promises.
        c.importedTotalOrders || "", c.importedTotalSpent.toString(), c.importedSource ?? "",
      ];
    }),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="Clients_${stamp}.csv"`,
      // A customer list must never sit in a shared cache.
      "cache-control": "no-store",
    },
  });
});
