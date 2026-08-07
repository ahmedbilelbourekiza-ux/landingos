"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { money, add, toString as moneyString, isNegative, ZERO, type Money } from "@/lib/money";
import {
  computeBlock, totalsOf, recordLines, grandTotal as computeGrandTotal,
} from "@/lib/erp/calc";

/* =============================================================================
 * The profit/loss calculator — LP.16d, restoring R9 / LEGACY_PARITY §7 P7.
 *
 * WHAT THIS ACTUALLY IS, because calling it a report gets the design wrong:
 * it is a RECONCILIATION between what the CRM thinks happened and what the
 * delivery company actually paid. The star field on every product block is
 * `G — real revenue received from the carrier`, the figure on the remittance
 * statement. Everything else exists to explain the difference between that
 * number and the theoretical one.
 *
 * WHY THE WORKING SHEET IS CLIENT STATE AND THE PERIOD IS NOT.
 *
 * The A–G inputs are a person thinking: they change on every keystroke, most
 * are never saved, and a round trip per character would make the tool unusable.
 * So the sheet is local. THE PERIOD IS IN THE URL — a preset is a link, custom
 * dates are a GET form — because the period decides what the server reads
 * (prorated fixed costs, this window's one-off charges, the history) and
 * because a calculation somebody is about to save should be linkable to the
 * colleague they are arguing with about it.
 *
 * D-06.1 IS INTACT. Nothing here writes through a new path: the sync reads
 * `GET /api/erp/products/[id]/sales-summary`, the save POSTs
 * `/api/erp/financial-records`, the roll-up reads
 * `GET /api/erp/financial-records/aggregate`. Every one already has contract
 * tests in front of it.
 *
 * MONEY IS NEVER A JS NUMBER HERE. The legacy calculator is `+(el.value)` end
 * to end and stores the result as a permanent record; this one is scaled
 * `bigint` throughout (`lib/money.ts`) and crosses back to the server as
 * strings. That is assumption 7 of this project, and the last place to make an
 * exception for it is the screen that produces the numbers a company files.
 *
 * -----------------------------------------------------------------------------
 * D-LP.16.1 — INCIDENTS ARE PART OF `productCosts` WHEN THE RECORD IS SAVED,
 * AND THE LEGACY DROPPED THEM.
 *
 * The legacy computes `incidents` (returns + exchanges + losses), subtracts it
 * from every product's profit, shows the result in the banner — and then does
 * not send it. `FinancialRecord` has no incidents column, so the saved
 * `netProfit`, derived server-side as revenue minus the five cost lines, comes
 * out HIGHER than the banner the manager was looking at when they pressed save,
 * by exactly the incident total. Two numbers, one period, and the permanent one
 * is the optimistic one.
 *
 * Here the incident total is folded into `productCosts`, which is where a
 * returned or destroyed unit's cost belongs, so THE SAVED RECORD AGREES WITH
 * THE SCREEN THAT PRODUCED IT. The page says so, above the button.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const NUM = `${FIELD} text-end`;

export interface CalculatorStrings {
  readonly saving: string;
  readonly add: string;
  readonly remove: string;
  readonly product: string;
  readonly addProduct: string;
  readonly sync: string;
  readonly syncHint: string;
  readonly noLink: string;
  readonly sellPrice: string;
  readonly buyPrice: string;
  readonly grossMargin: string;
  readonly adsUsd: string;
  readonly rate: string;
  readonly adsDa: string;
  readonly adsPerUnit: string;
  readonly packaging: string;
  readonly shipping: string;
  readonly totalUnitCost: string;
  readonly unitsSold: string;
  readonly caTheoretical: string;
  readonly profitPerUnit: string;
  readonly returnCost: string;
  readonly returnCount: string;
  readonly exchanges: string;
  readonly addExchange: string;
  readonly lossCost: string;
  readonly lossCount: string;
  readonly incidents: string;
  readonly realCa: string;
  readonly caGap: string;
  readonly allCosts: string;
  readonly profit: string;
  readonly roi: string;
  readonly breakEven: string;
  readonly breakEvenNever: string;
  readonly returnRate: string;
  readonly netMargin: string;
  readonly units: string;
  readonly grandTitle: string;
  readonly sumProfit: string;
  readonly otherCosts: string;
  readonly fixedProrated: string;
  readonly unexpected: string;
  readonly grandTotal: string;
  readonly profitable: string;
  readonly losing: string;
  readonly breakingEven: string;
  readonly saveRecord: string;
  readonly saveHint: string;
  readonly customWarning: string;
  readonly notes: string;
  readonly saved: string;
  readonly aggregate: string;
  readonly aggregateHint: string;
  readonly aggregateOnly: string;
  readonly aggregateMissing: string;
  readonly aggregateFrom: string;
  readonly saveAggregate: string;
  readonly incidentsInProductCosts: string;
}

export interface CalcProduct {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly costPrice: string;
  readonly packagingCost: string;
}

interface Exchange {
  readonly id: number;
  readonly cost: string;
}

interface Block {
  readonly pid: string;
  /** The catalogue row this block is linked to, or null for one typed in by
   *  hand. Only a linked block can sync, and the button says so rather than
   *  disappearing. */
  readonly crmId: string | null;
  readonly name: string;
  readonly sellPrice: string;
  readonly buyPrice: string;
  readonly rate: string;
  readonly adsUsd: string;
  readonly packCost: string;
  readonly shipCost: string;
  readonly unitsSold: string;
  readonly retCost: string;
  readonly retCount: string;
  readonly exchanges: readonly Exchange[];
  readonly lossCost: string;
  readonly lossCount: string;
  readonly realCa: string;
  readonly collapsed: boolean;
}

let seq = 0;
const nextPid = () => `p${++seq}`;

function blankBlock(product?: CalcProduct): Block {
  return {
    pid: nextPid(),
    crmId: product?.id ?? null,
    name: product?.name ?? "",
    sellPrice: product?.price ?? "0",
    buyPrice: product?.costPrice ?? "0",
    // The advertising rate has no source in the CRM — it is what the advertiser
    // paid for dollars that month, and recording it is what makes last month's
    // figure reproducible when the rate has moved since.
    rate: "250",
    adsUsd: "0",
    packCost: product?.packagingCost ?? "0",
    shipCost: "0",
    unitsSold: "0",
    retCost: "0",
    retCount: "0",
    exchanges: [],
    lossCost: "0",
    lossCount: "0",
    realCa: "0",
    collapsed: false,
  };
}

export function ProfitCalculator({
  errors,
  s,
  products,
  periodType,
  startDate,
  endDate,
  proratedFixed,
  unexpectedTotal,
  canWrite,
  canAggregate,
}: {
  readonly errors: ActionErrors;
  readonly s: CalculatorStrings;
  readonly products: readonly CalcProduct[];
  readonly periodType: string;
  readonly startDate: number;
  readonly endDate: number;
  /** Prorated by the server for THIS period, under the rule in lib/erp/prorate.ts. */
  readonly proratedFixed: string;
  /** The one-off charges dated inside this window, already summed. */
  readonly unexpectedTotal: string;
  readonly canWrite: boolean;
  /** Only month, quarter and year are built out of anything smaller. */
  readonly canAggregate: boolean;
}) {
  const { run, pending, error } = useApiAction(errors);
  // One block per catalogue product, and ONE BLANK BLOCK when the catalogue is
  // empty — which is a company's first day, and a screen that renders nothing
  // but an "add" button teaches nobody what this tool is. The legacy opens with
  // a blank product for the same reason.
  const [blocks, setBlocks] = useState<Block[]>(() =>
    products.length ? products.map((p) => blankBlock(p)) : [blankBlock()],
  );
  const [notes, setNotes] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [rolled, setRolled] = useState<null | {
    covered: boolean;
    subRecordsUsed: number;
    subPeriodType?: string;
    revenue?: string;
    productCosts?: string;
    shippingCosts?: string;
    advertisingCosts?: string;
    fixedExpenses?: string;
    unexpectedExpenses?: string;
    netProfit?: string;
    margin?: string;
  }>(null);

  const patch = (pid: string, next: Partial<Block>) =>
    setBlocks((all) => all.map((b) => (b.pid === pid ? { ...b, ...next } : b)));

  const computed = blocks.map((b) => [b, computeBlock(b)] as const);
  const totals = totalsOf(computed.map(([, c]) => c));

  const fixed = money(proratedFixed);
  const unexpected = money(unexpectedTotal);
  const other = add(fixed, unexpected);
  const grandTotal = computeGrandTotal(totals, fixed, unexpected);

  const fmt = (v: Money) => moneyString(v, 2);
  const pct = (v: Money) => `${moneyString(v, 1)}%`;

  /** Overwrites EXACTLY the five fields the CRM can answer for. Ad spend, the
   *  rate, shipping and every incident stay as they were typed — the sync is
   *  not a reset, and treating it as one would throw away the half of the sheet
   *  that only a person knows. */
  const syncBlock = async (b: Block) => {
    if (!b.crmId) return;
    setSyncing(b.pid);
    try {
      const res = await fetch(
        `/api/erp/products/${b.crmId}/sales-summary?since=${startDate}&until=${endDate}`,
        { credentials: "same-origin" },
      );
      const envelope = await res.json().catch(() => null);
      if (!res.ok || !envelope?.success) return;
      const d = envelope.data as {
        deliveredCount: number; returnedCount: number; realCA: string;
        avgBuyPrice: string; avgPackagingCost: string;
      };
      patch(b.pid, {
        unitsSold: String(d.deliveredCount ?? 0),
        retCount: String(d.returnedCount ?? 0),
        realCa: String(d.realCA ?? "0"),
        buyPrice: String(d.avgBuyPrice ?? "0"),
        // The two are separate on the wire precisely so filling one does not
        // require guessing the other — see the route's own note on P1.
        packCost: String(d.avgPackagingCost ?? "0"),
      });
    } finally {
      setSyncing(null);
    }
  };

  const saveRecord = () => {
    // The six lines, built by the same function the unit test checks against
    // the route's own derivation — D-LP.16.1 lives there, not here.
    const lines = recordLines(totals, fixed, unexpected);
    return run("POST", "/api/erp/financial-records", {
      periodType,
      startDate,
      endDate,
      revenue: fmt(lines.revenue),
      productCosts: fmt(lines.productCosts),
      shippingCosts: fmt(lines.shippingCosts),
      advertisingCosts: fmt(lines.advertisingCosts),
      fixedExpenses: fmt(lines.fixedExpenses),
      unexpectedExpenses: fmt(lines.unexpectedExpenses),
      notes: notes.trim() || undefined,
      source: "manual",
      productBreakdown: computed.map(([b, c]) => ({
        name: b.name || b.pid,
        profit: fmt(c.profit),
        revenue: fmt(c.realCa),
      })),
    });
  };

  const loadAggregate = async () => {
    const res = await fetch(
      `/api/erp/financial-records/aggregate?periodType=${periodType}&startDate=${startDate}&endDate=${endDate}`,
      { credentials: "same-origin" },
    );
    const envelope = await res.json().catch(() => null);
    setRolled(envelope?.success ? envelope.data : { covered: false, subRecordsUsed: 0 });
  };

  const saveAggregate = () => {
    if (!rolled?.covered) return;
    return run("POST", "/api/erp/financial-records", {
      periodType, startDate, endDate,
      revenue: rolled.revenue, productCosts: rolled.productCosts,
      shippingCosts: rolled.shippingCosts, advertisingCosts: rolled.advertisingCosts,
      fixedExpenses: rolled.fixedExpenses, unexpectedExpenses: rolled.unexpectedExpenses,
      notes: `${s.aggregateFrom} ${rolled.subRecordsUsed} × ${rolled.subPeriodType}`,
      source: "aggregated",
    });
  };

  const tone = (v: Money) =>
    isNegative(v) ? "text-[var(--color-danger-fg,#b91c1c)]" : "text-[var(--color-success-fg,#15803d)]";

  return (
    <div data-testid="erp-calculator">
      {/* The whole business, at the top, because it is the only number most
          people open this screen for. */}
      <section
        className="mt-4 rounded-lg border border-border bg-surface-raised p-4"
        data-testid="calc-banner"
        data-grand-total={fmt(grandTotal)}
      >
        <p className="text-xs text-muted-foreground">{s.grandTotal}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone(grandTotal)}`} dir="ltr">
          {fmt(grandTotal)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isNegative(grandTotal) ? s.losing : grandTotal === ZERO ? s.breakingEven : s.profitable}
        </p>
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          data-testid="calc-add-product"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setBlocks((all) => [...all, blankBlock()])}
        >
          {s.addProduct}
        </ActionButton>
      </div>

      {/* One block per product, A–G. */}
      {computed.map(([b, c]) => (
        <section
          key={b.pid}
          data-testid="calc-product"
          data-pid={b.pid}
          data-profit={fmt(c.profit)}
          className="mt-4 rounded-lg border border-border bg-surface-raised p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={s.product}
              data-testid="calc-name"
              value={b.name}
              onChange={(e) => patch(b.pid, { name: e.target.value })}
              className={`${FIELD} max-w-xs`}
            />
            <span className={`text-sm font-medium ${tone(c.profit)}`} dir="ltr">{fmt(c.profit)}</span>

            <ActionButton
              data-testid="calc-sync"
              data-pid={b.pid}
              pending={syncing === b.pid}
              pendingLabel={s.saving}
              disabled={!b.crmId}
              title={b.crmId ? s.syncHint : s.noLink}
              onClick={() => void syncBlock(b)}
            >
              {s.sync}
            </ActionButton>

            <ActionButton
              data-testid="calc-toggle"
              pending={false}
              pendingLabel={s.saving}
              onClick={() => patch(b.pid, { collapsed: !b.collapsed })}
            >
              {b.collapsed ? "▸" : "▾"}
            </ActionButton>

            <ActionButton
              data-testid="calc-remove-product"
              pending={false}
              pendingLabel={s.saving}
              variant="danger"
              onClick={() => setBlocks((all) => all.filter((x) => x.pid !== b.pid))}
            >
              {s.remove}
            </ActionButton>
          </div>

          {/* `hidden`, never unmounted — D-06.4. A collapsed block's vocabulary
              still exists for a contract test and for assistive technology. */}
          <div hidden={b.collapsed} className="mt-3 grid gap-4 lg:grid-cols-3">
            {/* A — the sale */}
            <div className="rounded-md border border-border p-3">
              {field(s.sellPrice, `sell-${b.pid}`, b.sellPrice, (v) => patch(b.pid, { sellPrice: v }))}
              {field(s.buyPrice, `buy-${b.pid}`, b.buyPrice, (v) => patch(b.pid, { buyPrice: v }))}
              {derived(s.grossMargin, fmt(c.grossMargin))}
            </div>

            {/* B — advertising, bought in USD and accounted in DA */}
            <div className="rounded-md border border-border p-3">
              {field(s.adsUsd, `ads-${b.pid}`, b.adsUsd, (v) => patch(b.pid, { adsUsd: v }))}
              {field(s.rate, `rate-${b.pid}`, b.rate, (v) => patch(b.pid, { rate: v }))}
              {derived(s.adsDa, fmt(c.adsDa))}
              {derived(s.adsPerUnit, fmt(c.adsPerUnit))}
            </div>

            {/* C — packaging, shipping, volume */}
            <div className="rounded-md border border-border p-3">
              {field(s.packaging, `pack-${b.pid}`, b.packCost, (v) => patch(b.pid, { packCost: v }))}
              {field(s.shipping, `ship-${b.pid}`, b.shipCost, (v) => patch(b.pid, { shipCost: v }))}
              {field(s.unitsSold, `units-${b.pid}`, b.unitsSold, (v) => patch(b.pid, { unitsSold: v }))}
              {derived(s.totalUnitCost, fmt(c.totalUnitCost))}
              {derived(s.caTheoretical, fmt(c.caTheoretical))}
              {derived(s.profitPerUnit, fmt(c.profitPerUnitTheoretical))}
            </div>

            {/* D/E/F — incidents. Returns and losses are a count × a cost; an
                EXCHANGE is not, because each one costs what it costs, which is
                why it is a list. */}
            <div className="rounded-md border border-border p-3">
              {field(s.returnCost, `retc-${b.pid}`, b.retCost, (v) => patch(b.pid, { retCost: v }))}
              {field(s.returnCount, `retn-${b.pid}`, b.retCount, (v) => patch(b.pid, { retCount: v }))}
              {field(s.lossCost, `lossc-${b.pid}`, b.lossCost, (v) => patch(b.pid, { lossCost: v }))}
              {field(s.lossCount, `lossn-${b.pid}`, b.lossCount, (v) => patch(b.pid, { lossCount: v }))}
              {derived(s.incidents, fmt(c.incidents))}
            </div>

            <div className="rounded-md border border-border p-3" data-testid="calc-exchanges">
              <p className="text-xs text-muted-foreground">{s.exchanges}</p>
              {b.exchanges.map((x) => (
                <div key={x.id} className="mt-2 flex items-center gap-2">
                  <input
                    aria-label={s.exchanges}
                    data-testid="calc-exchange"
                    inputMode="decimal"
                    dir="ltr"
                    value={x.cost}
                    onChange={(e) =>
                      patch(b.pid, {
                        exchanges: b.exchanges.map((y) =>
                          y.id === x.id ? { ...y, cost: e.target.value } : y,
                        ),
                      })
                    }
                    className={NUM}
                  />
                  <button
                    type="button"
                    data-testid="calc-exchange-remove"
                    onClick={() =>
                      patch(b.pid, { exchanges: b.exchanges.filter((y) => y.id !== x.id) })
                    }
                    className="ui-btn ui-btn-default ui-btn-sm tap"
                  >
                    ×
                  </button>
                </div>
              ))}
              <ActionButton
                data-testid="calc-add-exchange"
                pending={false}
                pendingLabel={s.saving}
                onClick={() =>
                  patch(b.pid, {
                    exchanges: [
                      ...b.exchanges,
                      { id: (b.exchanges.at(-1)?.id ?? 0) + 1, cost: "0" },
                    ],
                  })
                }
              >
                {s.addExchange}
              </ActionButton>
            </div>

            {/* G — what the carrier actually paid, and the six KPIs */}
            <div className="rounded-md border border-border p-3">
              {field(s.realCa, `ca-${b.pid}`, b.realCa, (v) => patch(b.pid, { realCa: v }))}
              {derived(s.caGap, fmt(c.caGap))}
              {derived(s.allCosts, fmt(c.allCosts))}
              {derived(s.profit, fmt(c.profit))}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs" data-testid="calc-kpis">
                {kpi(s.roi, pct(c.roi))}
                {kpi(s.profitPerUnit, fmt(c.profitPerUnit))}
                {/* The one a manager acts on: how many more units before this
                    product stops losing money, and "never" when the unit price
                    does not cover the unit cost. */}
                {kpi(
                  s.breakEven,
                  c.breakEvenUnits === null
                    ? s.breakEvenNever
                    : `${c.breakEvenUnits} ${s.units}`,
                )}
                {kpi(s.returnRate, pct(c.returnRate))}
                {kpi(s.adsPerUnit, fmt(c.adsPerUnit))}
                {kpi(s.netMargin, pct(c.netMargin))}
              </dl>
            </div>
          </div>
        </section>
      ))}

      {/* The business aggregate — fixed and unexpected costs subtracted ONCE. */}
      <section className="mt-6 rounded-lg border border-border bg-surface-raised p-4" data-testid="calc-grand">
        <h2 className="text-sm font-semibold tracking-tight">{s.grandTitle}</h2>
        <dl className="mt-3 grid gap-1 text-sm">
          {row(s.sumProfit, fmt(totals.sumProfit))}
          {row(s.fixedProrated, fmt(fixed))}
          {row(s.unexpected, fmt(unexpected))}
          {row(s.otherCosts, fmt(other))}
          {row(s.grandTotal, fmt(grandTotal), "font-semibold")}
        </dl>
      </section>

      {canWrite && (
        <section className="mt-6 rounded-lg border border-border bg-surface-raised p-4" data-testid="calc-save">
          <h2 className="text-sm font-semibold tracking-tight">{s.saveRecord}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{s.saveHint}</p>
          <p className="mt-1 text-xs text-muted-foreground">{s.incidentsInProductCosts}</p>
          {/* An honest warning rather than a refusal: a custom range saves fine
              and can simply never be rolled up later, because `aggregate` only
              looks at clean calendar units. */}
          {periodType === "custom" && (
            <p className="mt-1 text-xs" data-testid="calc-custom-warning">{s.customWarning}</p>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <label htmlFor="calc-notes" className="ui-label block">
                {s.notes}
              </label>
              <input
                id="calc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <ActionButton
              data-testid="calc-save-record"
              pending={pending}
              pendingLabel={s.saving}
              variant="primary"
              onClick={() => void saveRecord()}
            >
              {s.saveRecord}
            </ActionButton>
          </div>

          <ActionError message={error} />
        </section>
      )}

      {/* The roll-up. Reads only what was already saved — it touches no orders
          and no inventory, which is the requirement's own fast path. */}
      <section className="mt-6 rounded-lg border border-border bg-surface-raised p-4" data-testid="calc-aggregate">
        <h2 className="text-sm font-semibold tracking-tight">{s.aggregate}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {canAggregate ? s.aggregateHint : s.aggregateOnly}
        </p>

        <div className="mt-3">
          <ActionButton
            data-testid="calc-aggregate-run"
            pending={false}
            pendingLabel={s.saving}
            disabled={!canAggregate}
            onClick={() => void loadAggregate()}
          >
            {s.aggregate}
          </ActionButton>
        </div>

        {rolled && !rolled.covered && (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="calc-aggregate-missing">
            {s.aggregateMissing}
          </p>
        )}

        {rolled?.covered && (
          <div className="mt-3" data-testid="calc-aggregate-result">
            <p className="text-xs text-muted-foreground">
              {s.aggregateFrom} {rolled.subRecordsUsed} × {rolled.subPeriodType}
            </p>
            <dl className="mt-2 grid gap-1 text-sm">
              {row(s.sumProfit, String(rolled.netProfit))}
              {row(s.fixedProrated, String(rolled.fixedExpenses))}
            </dl>
            {canWrite && (
              <div className="mt-3">
                <ActionButton
                  data-testid="calc-aggregate-save"
                  pending={pending}
                  pendingLabel={s.saving}
                  variant="primary"
                  onClick={() => void saveAggregate()}
                >
                  {s.saveAggregate}
                </ActionButton>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Small renderers, kept here so the blocks above read as arithmetic
 * -------------------------------------------------------------------------- */

function field(label: string, id: string, value: string, onChange: (v: string) => void) {
  return (
    <div className="mt-2 first:mt-0">
      <label htmlFor={id} className="ui-label block">{label}</label>
      {/* Money is a text input with a decimal keypad, never type="number" — a
          number input hands back a JS float and every one of these is parsed as
          an exact decimal (M-06, lib/money.ts). */}
      <input
        id={id}
        data-testid="calc-field"
        data-field={id}
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${NUM}`}
      />
    </div>
  );
}

function derived(label: string, value: string) {
  return (
    <div className="mt-2 flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid="calc-derived" data-label={label} dir="ltr" className="font-medium">
        {value}
      </span>
    </div>
  );
}

function kpi(label: string, value: string) {
  return (
    <div key={label}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-testid="calc-kpi" data-label={label} dir="ltr" className="font-medium">{value}</dd>
    </div>
  );
}

function row(label: string, value: string, extra = "") {
  return (
    <div key={label} className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-testid="calc-total" data-label={label} dir="ltr" className={extra}>{value}</dd>
    </div>
  );
}
