"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * The one-off charge write surface — Phase 6.3d, narrowed by LB.25.
 *
 * This file used to also hold `RecordSavePanel`, the finance screen's manual
 * six-totals form. LB.25 deleted that screen: the calculator's working sheet
 * posts the same route (`POST /api/erp/financial-records`) with the lines
 * DERIVED rather than retyped, so the hand form was a second, blinder way to
 * state the same record. The route is unchanged — nothing stopped accepting
 * manual posts; only the duplicate control went.
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

