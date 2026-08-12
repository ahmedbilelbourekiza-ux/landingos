import Link from "next/link";
import { notFound } from "next/navigation";

import { withTenant, Prisma } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import {
  calculatorStrings,
  structuredStrings,
  readFixedCostRows,
} from "@/lib/console/erp-strings";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { ProfitCalculator } from "@/components/console/erp/profit-calculator";
import { FixedCostsEditor } from "@/components/console/erp/settings-structured";
import { readSettings } from "@/lib/erp/settings";
import { prorateMonthlyAmount, alignedRange, monthlyFixedTotal } from "@/lib/erp/prorate";
import { seesWholeBook } from "@/lib/erp/scope";
import { financeEnabledFor } from "@/lib/erp/finance-module";
import { PERIOD_TYPES } from "@/app/api/erp/financial-records/route";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The profit/loss calculator — LP.16d, restoring R9 / LEGACY_PARITY §7.
 *
 * The legacy served this as a standalone HTML file with NO AUTHORIZATION ON THE
 * PAGE AT ALL — the whole company's margins, break-even points and carrier
 * shortfalls, behind a URL. Here it is gated exactly as the finance screen is:
 * `erp:finance:read` is SENSITIVE (D-05.1), so no role grants it implicitly,
 * and the page checks rather than trusting the nav to have hidden the link.
 *
 * WHAT THE SERVER OWNS, AND WHY THE SPLIT IS HERE.
 *
 * The PERIOD lives in the URL and is resolved here, because three things depend
 * on it and none of them belongs in a browser:
 *
 *   - the prorated fixed costs, under the `periodType`-keyed rule in
 *     `lib/erp/prorate.ts` — a screen doing its own ÷4 would eventually
 *     disagree with `prorate-fixed` about what a week costs;
 *   - the one-off charges dated INSIDE the window, which is a query;
 *   - the saved history for this period type.
 *
 * The presets are calendar-ALIGNED (Monday-to-Sunday, the 1st to the 31st), not
 * rolling windows, and that is not a styling choice: four aligned weeks tile
 * into exactly one month, which is what `aggregate` builds a month out of.
 * `orderFilters`' `range=week` is a ROLLING seven days and is right for "what
 * came in recently" — two vocabularies, deliberately not shared, because a
 * single name for both would make them look interchangeable.
 *
 * The A–G working sheet is client state; see the component's own note.
 * ========================================================================== */

const PRESETS = ["day", "week", "month", "quarter", "year"] as const;

/** `YYYY-MM-DD` for a date input, in local time — the same conversion the
 *  finance panel's `dayToEpoch` reverses. */
const dayValue = (ms: number) => {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};

export default async function ErpCalculatorScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/calculator");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // The same gate the finance screen applies, and for the same reason: this is
  // the company's P&L, and a nav item is a hint while a URL is typeable.
  if (!seesWholeBook(session)) notFound();

  /* LB.18 — the calculator is part of the finance module, not a neighbour of
     it: it writes the records the books are made of. Switched off with them. */
  if (!(await financeEnabledFor(session.auth!.tenantId))) notFound();

  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const requested = one("periodType") ?? "week";
  const periodType = (PERIOD_TYPES as readonly string[]).includes(requested) ? requested : "week";

  const aligned = alignedRange(periodType);
  // A custom range with no dates is not an error — it is the state the screen
  // is in the moment somebody clicks the tab — so it falls back to this week
  // rather than refusing or answering about a window nobody chose.
  const fallback = alignedRange("week")!;
  const startDate = aligned ? aligned.start : Number(one("startDate")) || fallback.start;
  const endDate = aligned ? aligned.end : Number(one("endDate")) || fallback.end;

  const { products, charges, settings, records } = await withTenant(
    session.auth!.tenantId,
    async (db) => ({
      // The catalogue, so every product starts as a block pre-filled with its
      // own prices — the legacy's "load from CRM" without the button.
      products: await db.catalogProduct.findMany({
        where: { archived: false },
        orderBy: { name: "asc" },
        take: 50,
        select: { id: true, name: true, price: true, costPrice: true, packagingCost: true },
      }),
      charges: await db.unexpectedCharge.findMany({
        where: { date: { gte: new Date(startDate), lte: new Date(endDate) } },
        orderBy: { date: "desc" },
        select: { id: true, label: true, amount: true, date: true },
      }),
      settings: await readSettings(db),
      records: await db.financialRecord.findMany({
        where: { periodType },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        take: 50,
        select: {
          id: true, startDate: true, endDate: true, revenue: true,
          netProfit: true, margin: true, notes: true, source: true, createdAt: true,
        },
      }),
    }),
  );

  const monthlyFixed = monthlyFixedTotal(settings.fixedCosts);
  // The ONE proration rule, applied on the server. See lib/erp/prorate.ts.
  const proratedFixed = prorateMonthlyAmount(monthlyFixed, periodType, startDate, endDate);
  const unexpectedTotal = charges.reduce(
    (sum, c) => sum.plus(c.amount ?? 0),
    new Prisma.Decimal(0),
  );

  const mayWrite = can(session.auth!, "erp:finance:write");
  const maySettings = can(session.auth!, "erp:settings:write");
  const errors = actionErrors(t);
  const s = calculatorStrings(t);

  const href = (next: Record<string, string>) => {
    const q = new URLSearchParams({ periodType, ...next });
    return `/console/erp/calculator?${q.toString()}`;
  };

  return (
    <>
      <PageBody>
      <PageHeader title={t("erp.calculator.title")} description={t("erp.calculator.subtitle")} />

      {/* The period. Links, not buttons — a calculation somebody is about to
          save should be linkable, survive a refresh and work before JavaScript,
          the same argument <Pager> makes. */}
      <nav className="mt-4 flex flex-wrap items-center gap-2" data-testid="calc-periods">
        {PRESETS.map((p) => (
          <Link
            key={p}
            href={href({ periodType: p })}
            data-testid="calc-period"
            data-period={p}
            aria-current={periodType === p ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              periodType === p ? "border-primary font-medium" : "border-input"
            }`}
          >
            {t(`erp.period.${p}`)}
          </Link>
        ))}

        <form method="get" action="/console/erp/calculator" className="flex items-end gap-2">
          <input type="hidden" name="periodType" value="custom" />
          <input
            type="date" name="startDate" dir="ltr" aria-label={t("erp.write.from")}
            defaultValue={dayValue(startDate)}
            className="ui-control tap px-2 py-1.5"
          />
          <input
            type="date" name="endDate" dir="ltr" aria-label={t("erp.write.to")}
            defaultValue={dayValue(endDate)}
            className="ui-control tap px-2 py-1.5"
          />
          <button
            type="submit"
            data-testid="calc-custom-apply"
            className="ui-btn ui-btn-default tap"
          >
            {t("erp.period.custom")}
          </button>
        </form>

        <span className="ms-auto text-xs text-muted-foreground" data-testid="calc-range">
          {formatDate(new Date(startDate), locale)} → {formatDate(new Date(endDate), locale)}
        </span>
      </nav>

      <ProfitCalculator
        // Keyed on the window, so changing the period remounts the sheet rather
        // than leaving last week's synced units against this week's costs.
        key={`${periodType}:${startDate}:${endDate}`}
        errors={errors}
        s={s}
        products={products.map((p) => ({
          id: p.id,
          name: p.name ?? "",
          price: (p.price ?? new Prisma.Decimal(0)).toString(),
          costPrice: (p.costPrice ?? new Prisma.Decimal(0)).toString(),
          packagingCost: (p.packagingCost ?? new Prisma.Decimal(0)).toString(),
        }))}
        periodType={periodType}
        startDate={startDate}
        endDate={endDate}
        proratedFixed={proratedFixed.toString()}
        unexpectedTotal={unexpectedTotal.toString()}
        canWrite={mayWrite}
        canAggregate={["month", "quarter", "year"].includes(periodType)}
      />

      {/* The recurring costs, edited HERE as well as on the automation screen —
          the same component calling the same route (D-06.1), not a second write
          path. The legacy put this on the calculator for a reason: the prorated
          figure two panels up is the only place its effect is visible. */}
      {maySettings && (
        <FixedCostsEditor
          key={`fc:${JSON.stringify(settings.fixedCosts)}`}
          errors={errors}
          s={structuredStrings(t)}
          rows={readFixedCostRows(settings.fixedCosts)}
        />
      )}

      <h2 className="mt-8 text-sm font-semibold tracking-tight">{t("erp.calculator.history")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("erp.calculator.historyHint")}</p>

      <div className="mt-2">
        <a
          href={`/api/erp/financial-records/export?periodType=${periodType}`}
          data-testid="calc-export"
          className="ui-btn ui-btn-default tap"
        >
          {t("erp.calculator.exportHistory")}
        </a>
      </div>

      <DataTable
        testId="erp-calculator-history"
        empty={t("erp.finance.none")}
        rows={records}
        rowKey={(r) => r.id}
        columns={[
          {
            id: "period",
            header: t("erp.finance.period"),
            cell: (r) => `${formatDate(r.startDate, locale)} → ${formatDate(r.endDate, locale)}`,
          },
          {
            id: "revenue", header: t("erp.finance.revenue"), numeric: true, align: "end",
            cell: (r) => <span dir="ltr">{r.revenue.toString()}</span>,
          },
          {
            id: "net", header: t("erp.finance.netProfit"), numeric: true, align: "end",
            cell: (r) => <span dir="ltr" className="font-medium">{r.netProfit.toString()}</span>,
          },
          {
            id: "margin", header: t("erp.finance.margin"), numeric: true, align: "end",
            cell: (r) => <span dir="ltr">{r.margin.toFixed(1)}%</span>,
          },
          {
            id: "source",
            header: t("erp.calculator.sourceLabel"),
            // `aggregated` is a different claim from `manual` — one was rolled
            // up from sub-periods, the other typed — and a history that does not
            // say which invites re-aggregating an aggregate.
            cell: (r) => (
              <span className="text-muted-foreground" data-source={r.source ?? "manual"}>
                {t(r.source === "aggregated"
                  ? "erp.calculator.sourceAggregated"
                  : "erp.calculator.sourceManual")}
              </span>
            ),
          },
          { id: "notes", header: t("erp.calculator.notes"), cell: (r) => r.notes ?? "" },
        ]}
      />
      </PageBody>
    </>
  );
}
