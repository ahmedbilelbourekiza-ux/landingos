"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * The books — Phase 6.3d.
 *
 * The asymmetry this file exists to render correctly, and which the schema
 * already encodes:
 *
 *   A SAVED P&L HAS NO EDIT AND NO DELETE. Records are insert-only. Saving a
 *   period twice inserts a second row and the first stays forever as what the
 *   business looked like at the time that calculation was made — a manager who
 *   recalculates March in June wants both answers, because the difference is
 *   usually a returned parcel and worth explaining. There is no route to edit
 *   one, so there is no control here, and `screens.test.ts` asserts the absence.
 *
 *   A ONE-OFF CHARGE IS DELETABLE. A saved P&L is a statement somebody made; a
 *   van repair typed in with the wrong amount is data entry, and refusing to let
 *   it be corrected would only produce a compensating negative charge.
 *
 * NET PROFIT IS NOT AN INPUT. The route derives it from revenue minus the five
 * cost lines and ignores whatever the request claims — a contract test posts
 * `netProfit: 999999` and expects 37000 back. A box for it would be a field
 * whose value the server throws away, which is a lie about what the person is
 * doing. Same for margin.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface FinanceStrings {
  readonly saving: string;
  readonly addCharge: string;
  readonly label: string;
  readonly amount: string;
  readonly date: string;
  readonly add: string;
  readonly remove: string;
  readonly savePanel: string;
  readonly periodType: string;
  readonly from: string;
  readonly to: string;
  readonly revenue: string;
  readonly productCosts: string;
  readonly shippingCosts: string;
  readonly advertisingCosts: string;
  readonly fixedExpenses: string;
  readonly unexpectedExpenses: string;
  readonly derivedHint: string;
  readonly saveRecord: string;
}

/** A date input gives `YYYY-MM-DD`; the route takes epoch ms. Local midnight. */
const dayToEpoch = (value: string) => new Date(`${value}T00:00:00`).getTime();

/* -----------------------------------------------------------------------------
 * One-off charges
 * -------------------------------------------------------------------------- */

export function ChargeAddPanel({
  errors,
  s,
}: {
  readonly errors: ActionErrors;
  readonly s: FinanceStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-charge-panel">
      <h2 className="text-sm font-semibold tracking-tight">{s.addCharge}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="charge-label" className="ui-label block">
            {s.label}
          </label>
          <input
            id="charge-label" value={label} onChange={(e) => setLabel(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        <div>
          <label htmlFor="charge-amount" className="ui-label block">
            {s.amount}
          </label>
          {/* Money is a text input with a decimal keypad, never type="number":
              a number input hands back a JS float and this is a Decimal column. */}
          <input
            id="charge-amount" inputMode="decimal" dir="ltr"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        <div>
          <label htmlFor="charge-date" className="ui-label block">
            {s.date}
          </label>
          {/* The day it HAPPENED, not the day it was typed in. A repair entered
              a week late belongs in the week it happened, or every period
              boundary reports the wrong number. Blank means today, which is what
              the route already defaults to. */}
          <input
            id="charge-date" type="date" dir="ltr"
            value={date} onChange={(e) => setDate(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="charge-add"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          disabled={!label.trim() || !amount.trim()}
          onClick={async () => {
            const { ok } = await run("POST", "/api/erp/unexpected-charges", {
              label: label.trim(),
              amount: amount.trim(),
              ...(date ? { date: dayToEpoch(date) } : {}),
            });
            if (ok) { setLabel(""); setAmount(""); setDate(""); }
          }}
        >
          {s.add}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}

export function ChargeRemove({
  chargeId,
  errors,
  s,
}: {
  readonly chargeId: string;
  readonly errors: ActionErrors;
  readonly s: FinanceStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  return (
    <>
      <ActionButton
        data-testid="charge-remove"
        data-charge-id={chargeId}
        pending={pending}
        pendingLabel={s.saving}
        variant="danger"
        onClick={() => void run("DELETE", `/api/erp/unexpected-charges/${chargeId}`)}
      >
        {s.remove}
      </ActionButton>
      <ActionError message={error} />
    </>
  );
}

/* -----------------------------------------------------------------------------
 * Saving a period
 * -------------------------------------------------------------------------- */

export function RecordSavePanel({
  errors,
  s,
  periodTypes,
}: {
  readonly errors: ActionErrors;
  readonly s: FinanceStrings;
  readonly periodTypes: readonly WriteOption[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const blank = {
    periodType: periodTypes[0]?.value ?? "custom",
    startDate: "", endDate: "",
    revenue: "", productCosts: "", shippingCosts: "",
    advertisingCosts: "", fixedExpenses: "", unexpectedExpenses: "",
  };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const money = (k: keyof typeof f, label: string) => (
    <div>
      <label htmlFor={`fin-${k}`} className="ui-label block">{label}</label>
      <input
        id={`fin-${k}`} inputMode="decimal" dir="ltr"
        value={f[k]} onChange={(e) => set(k, e.target.value)} className={`mt-1 ${FIELD}`}
      />
    </div>
  );

  const dated = Boolean(f.startDate && f.endDate);
  // The route refuses a period that ends before it starts, so the control does
  // too rather than offering a button that 422s.
  const ordered = dated && dayToEpoch(f.endDate) >= dayToEpoch(f.startDate);

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-record-panel">
      <h2 className="text-sm font-semibold tracking-tight">{s.savePanel}</h2>
      {/* Said on the page: the total is the server's arithmetic, so two people
          reading the same period cannot see two answers. */}
      <p className="mt-1 text-xs text-muted-foreground">{s.derivedHint}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="fin-periodType" className="ui-label block">
            {s.periodType}
          </label>
          <select
            id="fin-periodType" value={f.periodType}
            onChange={(e) => set("periodType", e.target.value)} className={`mt-1 ${FIELD}`}
          >
            {periodTypes.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fin-startDate" className="ui-label block">
            {s.from}
          </label>
          <input
            id="fin-startDate" type="date" dir="ltr"
            value={f.startDate} onChange={(e) => set("startDate", e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        <div>
          <label htmlFor="fin-endDate" className="ui-label block">{s.to}</label>
          <input
            id="fin-endDate" type="date" dir="ltr"
            value={f.endDate} onChange={(e) => set("endDate", e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        {money("revenue", s.revenue)}
        {money("productCosts", s.productCosts)}
        {money("shippingCosts", s.shippingCosts)}
        {money("advertisingCosts", s.advertisingCosts)}
        {money("fixedExpenses", s.fixedExpenses)}
        {money("unexpectedExpenses", s.unexpectedExpenses)}
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="record-save"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          disabled={!ordered}
          onClick={async () => {
            const { ok } = await run("POST", "/api/erp/financial-records", {
              periodType: f.periodType,
              startDate: dayToEpoch(f.startDate),
              endDate: dayToEpoch(f.endDate),
              // Empty means zero, not absent: a cost line left blank is a real
              // claim that it was nothing, and the server would default it
              // anyway. Sending it explicitly keeps the two readings identical.
              revenue: f.revenue || "0",
              productCosts: f.productCosts || "0",
              shippingCosts: f.shippingCosts || "0",
              advertisingCosts: f.advertisingCosts || "0",
              fixedExpenses: f.fixedExpenses || "0",
              unexpectedExpenses: f.unexpectedExpenses || "0",
            });
            if (ok) setF(blank);
          }}
        >
          {s.saveRecord}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}
