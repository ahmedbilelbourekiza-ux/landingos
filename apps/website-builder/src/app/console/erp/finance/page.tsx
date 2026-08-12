import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { financeStrings } from "@/lib/console/erp-strings";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import {
  ChargeAddPanel,
  ChargeRemove,
  RecordSavePanel,
} from "@/components/console/erp/finance-write";
import { PERIOD_TYPES } from "@/app/api/erp/financial-records/route";
import { seesWholeBook } from "@/lib/erp/scope";
import { financeEnabledFor } from "@/lib/erp/finance-module";

export const dynamic = "force-dynamic";

/**
 * Saved profit-and-loss records, and one-off expenses.
 *
 * Gated on the same permission the API uses — this is the company's P&L, and
 * D-05.1 made it a permission no role grants implicitly. Checked here rather
 * than trusting the nav to have hidden the link: a nav item is a hint, the URL
 * is typeable.
 *
 * RECORDS ARE INSERT-ONLY, and the screen offers no edit or delete because no
 * such route exists. Saving a period twice inserts a second row; the older one
 * stays forever as a record of what the business looked like at the time each
 * calculation was made. A manager who recalculates March in June wants both
 * answers, because the difference is usually a returned parcel worth explaining
 * — so the list is ordered newest-first WITHIN a period rather than deduped.
 *
 * One-off charges ARE deletable, and that asymmetry is deliberate: a saved P&L
 * is a statement somebody made, a van repair typed in wrong is data entry.
 */
export default async function ErpFinanceScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/finance");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  if (!seesWholeBook(session)) notFound();

  /* LB.18 — a company that switched the books off does not have this screen,
     and the nav hiding the link is not what makes that true. Same reasoning as
     the permission check above it: a nav item is a hint, the URL is typeable. */
  if (!(await financeEnabledFor(session.auth!.tenantId))) notFound();

  const { records, charges } = await withTenant(session.auth!.tenantId, async (db) => ({
    records: await db.financialRecord.findMany({
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true, periodType: true, startDate: true, endDate: true,
        revenue: true, productCosts: true, shippingCosts: true,
        advertisingCosts: true, fixedExpenses: true, unexpectedExpenses: true,
        netProfit: true, margin: true, createdAt: true,
      },
    }),
    charges: await db.unexpectedCharge.findMany({
      orderBy: { date: "desc" },
      take: 25,
      select: { id: true, label: true, amount: true, date: true },
    }),
  }));

  const currency = session.tenant!.currency;
  const money = (v: { toString(): string }) => formatMoney(v.toString(), locale, currency);

  /* THE AUDIT'S FINDING. `FinancialRecord` is append-only, so saving a period
   * twice keeps BOTH rows — which is the whole point of P5, and
   * `GET /financial-records/versions` answers "what did this week say before".
   * That route had no reader, and this table listed every row flat: two saves
   * of the same week appeared as two adjacent, equally authoritative lines, and
   * nothing said which one the business runs on.
   *
   * Computed here rather than by calling `versions`, and deliberately: the rows
   * are already ordered `startDate desc, createdAt desc`, so the FIRST row for a
   * period is the current one and every later row for the same period is
   * superseded. A second query would be a second answer to a question this list
   * has already sorted itself into.
   *
   * The difference between two versions is almost always a parcel that came
   * back after the first calculation — the single most common thing a manager
   * needs explained, and the reason the older row is kept rather than updated. */
  const seenPeriods = new Set<string>();
  const versioned = records.map((r) => {
    const key = `${r.periodType}:${r.startDate.getTime()}:${r.endDate.getTime()}`;
    const current = !seenPeriods.has(key);
    seenPeriods.add(key);
    return { ...r, current };
  });

  /* Phase 6.3d. Reading the books is `erp:finance:read` (checked above via
     seesWholeBook's sibling gate); WRITING them is `erp:finance:write`, and the
     two are separate permissions on purpose — an accountant may be given the
     read without the ability to state a period. */
  const mayWrite = can(session.auth!, "erp:finance:write");
  const errors = actionErrors(t);
  const s = financeStrings(t);
  const periodTypes = PERIOD_TYPES.map((value) => ({
    value,
    label: t(`erp.period.${value}`),
  }));

  return (
    <>
      <PageBody>
      <PageHeader title={t("erp.finance.title")} description={t("erp.finance.appendOnly")} />

      {/* Saving a period is offered. Editing or deleting a saved one is not,
          and never will be: no such route exists, because the older row IS the
          record of what the business looked like when that calculation was
          made. */}
      {mayWrite && <RecordSavePanel errors={errors} s={s} periodTypes={periodTypes} />}

      <p className="mt-2 text-xs text-muted-foreground" data-testid="finance-versions-hint">
        {t("erp.finance.versionsHint")}
      </p>

      <DataTable
        testId="erp-finance-table"
        empty={t("erp.finance.none")}
        rows={versioned}
        rowKey={(r) => r.id}
        rowAttrs={(r) => ({
          "data-record-id": r.id,
          "data-current": r.current ? "true" : "false",
        })}
        columns={[
          {
            id: "period",
            header: t("erp.finance.period"),
            cell: (r) => (
              <>
                <span className="font-medium">{r.periodType}</span>
                {/* Said on the row. A superseded record is not wrong — it is
                    what the period USED to say — but a manager reading two
                    lines for one week needs to know which is which. */}
                {!r.current && (
                  <span
                    data-badge="superseded"
                    className="ms-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {t("erp.finance.superseded")}
                  </span>
                )}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {formatDate(r.startDate, locale)} → {formatDate(r.endDate, locale)}
                </span>
              </>
            ),
          },
          {
            id: "revenue",
            header: t("erp.finance.revenue"),
            numeric: true,
            align: "end",
            cell: (r) => money(r.revenue),
          },
          {
            id: "costs",
            header: t("erp.finance.costs"),
            numeric: true,
            align: "end",
            cell: (r) => (
              <span className="text-muted-foreground">
                {money(
                  r.productCosts
                    .plus(r.shippingCosts)
                    .plus(r.advertisingCosts)
                    .plus(r.fixedExpenses)
                    .plus(r.unexpectedExpenses),
                )}
              </span>
            ),
          },
          {
            id: "net",
            header: t("erp.finance.netProfit"),
            numeric: true,
            align: "end",
            // Derived by the server when the record was saved, never taken from
            // whoever typed the form. Rendered as stored.
            cell: (r) => <span className="font-medium">{money(r.netProfit)}</span>,
          },
          {
            id: "margin",
            header: t("erp.finance.margin"),
            numeric: true,
            align: "end",
            cell: (r) => (
              <span className="text-muted-foreground" dir="ltr">
                {r.margin.toFixed(1)}%
              </span>
            ),
          },
          {
            id: "saved",
            header: t("erp.finance.saved"),
            cell: (r) => (
              <span className="text-muted-foreground">{formatDate(r.createdAt, locale)}</span>
            ),
          },
        ]}
      />

      <h2 className="mt-8 text-sm font-semibold tracking-tight">{t("erp.finance.charges")}</h2>

      {mayWrite && <ChargeAddPanel errors={errors} s={s} />}

      <DataTable
        testId="erp-charges-table"
        empty={t("common.empty")}
        rows={charges}
        rowKey={(c) => String(c.id)}
        columns={[
          { id: "label", header: t("erp.finance.charges"), cell: (c) => c.label },
          {
            id: "amount",
            header: t("erp.orders.total"),
            numeric: true,
            align: "end",
            cell: (c) => money(c.amount),
          },
          {
            id: "date",
            header: t("erp.orders.placed"),
            // The day it HAPPENED, not the day it was typed in — a repair
            // entered a week late belongs in the week it happened.
            cell: (c) => (
              <span className="text-muted-foreground">{formatDate(c.date, locale)}</span>
            ),
          },
          // Deletable, unlike the records above, and the asymmetry is the
          // schema's: a saved P&L is a statement somebody made, a van repair
          // typed in wrong is data entry.
          ...(mayWrite
            ? [
                {
                  id: "actions",
                  header: "",
                  align: "end" as const,
                  cell: (c: (typeof charges)[number]) => (
                    <ChargeRemove chargeId={String(c.id)} errors={errors} s={s} />
                  ),
                },
              ]
            : []),
        ]}
      />
      </PageBody>
    </>
  );
}
