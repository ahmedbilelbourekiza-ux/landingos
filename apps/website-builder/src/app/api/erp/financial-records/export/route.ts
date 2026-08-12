import { tenantRoute } from "@/lib/api/route";
import { refuseIfFinanceOff } from "@/lib/erp/finance-module";
import { toCsv } from "@/lib/erp/export";

export const dynamic = "force-dynamic";

/**
 * The saved P&L history as a file — LP.16d, the last piece of §7 P7.
 *
 * LP.6 exported ORDERS. This is the finance history and is a different thing:
 * one row per saved period, which is what an accountant is handed at the end of
 * a quarter.
 *
 * THIRTEEN COLUMNS, IN THE LEGACY'S ORDER AND WITH ITS HEADINGS. A header is a
 * contract with whoever opens the file — the same argument D-LP.6.2 makes for
 * the carrier formats — so these stay French and stay in this sequence even
 * though the console is trilingual. Somebody has a spreadsheet with formulas
 * pointing at column H.
 *
 * CSV rather than XLSX, for D-LP.6.1's reason: a writer dependency in the
 * server bundle for one feature. `toCsv` supplies the two properties that are
 * security rather than polish — a leading `=`/`+`/`-`/`@` is neutralised (a
 * note is free text typed by a person) and the file carries a UTF-8 BOM.
 *
 * CAPPED AT 500, the legacy's own cap. A saved record is created by hand, one
 * per period, so 500 is roughly a decade of weeks — and unlike the order export
 * there is no filter to narrow with, so a cap that refuses would leave no way
 * forward.
 */
const LIMIT = 500;

const HEADERS = [
  "Début période", "Fin période", "Type", "Revenu", "Coûts Produits", "Livraison",
  "Publicité", "Charges Fixes", "Charges Imprévues", "Profit Net", "Marge (%)",
  "Source", "Notes",
] as const;

/** `dd/mm/yyyy` — how the legacy wrote it, and what Excel here parses. */
const day = (d: Date) =>
  [String(d.getDate()).padStart(2, "0"), String(d.getMonth() + 1).padStart(2, "0"), d.getFullYear()]
    .join("/");

export const GET = tenantRoute("erp:finance:read", async ({ db, searchParams }) => {
  // LB.18 — a module the company switched off does not accept calls either;
  // hiding the nav item is not what makes it gone.
  const off = await refuseIfFinanceOff(db);
  if (off) return off;

  const periodType = searchParams.get("periodType")?.trim();

  const items = await db.financialRecord.findMany({
    where: periodType ? { periodType } : {},
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: LIMIT,
  });

  const csv = toCsv(
    HEADERS,
    items.map((r) => [
      day(r.startDate),
      day(r.endDate),
      r.periodType,
      // As stored, digit for digit. Formatting a Decimal through a locale here
      // would put thousands separators into a column somebody sums.
      r.revenue.toString(),
      r.productCosts.toString(),
      r.shippingCosts.toString(),
      r.advertisingCosts.toString(),
      r.fixedExpenses.toString(),
      r.unexpectedExpenses.toString(),
      r.netProfit.toString(),
      r.margin.toFixed(1),
      r.source ?? "manual",
      r.notes ?? "",
    ]),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        `attachment; filename="Historique_Financier_${periodType ?? "all"}_${stamp}.csv"`,
      "x-export-rows": String(items.length),
      "cache-control": "no-store",
    },
  });
});
