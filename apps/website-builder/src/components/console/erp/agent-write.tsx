"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * The team — Phase 6.3d.
 *
 * WHAT THIS SCREEN CANNOT DO, AND WHY THERE IS NO BUTTON FOR IT:
 *
 *   - Adding a person. `POST /api/erp/agents` answers 501: inviting somebody is
 *     a PLATFORM action (M-02). Routing it through a product would give every
 *     product a way to create accounts in every other one.
 *   - Changing the platform ROLE. `PATCH /agents/[id]` deliberately does not
 *     accept it, for the same reason. What this screen edits is the JOB —
 *     confirmation, follow-up, both — which the ERP kept separate from the
 *     privilege so a follow-up agent could also be a manager.
 *   - Suspending yourself, or the owner. The API answers 422 to both
 *     (`CANNOT_SUSPEND_SELF`, `CANNOT_SUSPEND_OWNER`): the first ends the
 *     session doing the suspending and leaves nobody able to undo it.
 *
 * TWO STORES, TWO REQUESTS, ON PURPOSE. `jobRole` is a column on Membership
 * because the platform models it; the pay rates go to ProductSetting because the
 * platform must never learn what an ERP payroll rate is (D-05.4). Days off are a
 * third route again. They are separate writes because they are separate
 * concerns, and folding them into one endpoint is what would put a payroll rate
 * on a platform table.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface AgentStrings {
  readonly saving: string;
  readonly save: string;
  readonly edit: string;
  readonly cancel: string;
  readonly jobRole: string;
  readonly salary: string;
  readonly perConfirmed: string;
  readonly perDelivered: string;
  readonly daysOff: string;
  readonly suspend: string;
  readonly reactivate: string;
  /** Seven, Sunday first — matching JS getDay(), which is what is stored. */
  readonly days: readonly string[];
}

export interface AgentPay {
  readonly baseSalaryMonthly: string;
  readonly payPerConfirmedOrder: string;
  readonly payPerDeliveredOrder: string;
}

export function AgentRowActions({
  userId,
  suspended,
  jobRole,
  pay,
  daysOff,
  jobRoles,
  isSelf,
  isOwner,
  errors,
  s,
}: {
  readonly userId: string;
  readonly suspended: boolean;
  readonly jobRole: string;
  readonly pay: AgentPay;
  readonly daysOff: readonly number[];
  readonly jobRoles: readonly WriteOption[];
  readonly isSelf: boolean;
  readonly isOwner: boolean;
  readonly errors: ActionErrors;
  readonly s: AgentStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ jobRole: jobRole || jobRoles[0]?.value || "", ...pay });
  const [days, setDays] = useState<number[]>([...daysOff]);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const money = (
    k: "baseSalaryMonthly" | "payPerConfirmedOrder" | "payPerDeliveredOrder",
    label: string,
  ) => (
    <div>
      <label htmlFor={`agent-${k}-${userId}`} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <input
        id={`agent-${k}-${userId}`} inputMode="decimal" dir="ltr"
        value={f[k]} onChange={(e) => set(k, e.target.value)} className={`mt-1 ${FIELD}`}
      />
    </div>
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton
          data-testid="agent-edit-toggle"
          data-user-id={userId}
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? s.cancel : s.edit}
        </ActionButton>

        {/* Neither refusal is reachable from this screen, because neither
            control is offered. */}
        {!isSelf && !isOwner && (
          <ActionButton
            data-testid={suspended ? "agent-reactivate" : "agent-suspend"}
            data-user-id={userId}
            pending={pending}
            pendingLabel={s.saving}
            variant={suspended ? "default" : "danger"}
            onClick={() =>
              void run(
                "POST",
                `/api/erp/agents/${userId}/${suspended ? "reactivate" : "suspend"}`,
              )
            }
          >
            {suspended ? s.reactivate : s.suspend}
          </ActionButton>
        )}
      </div>

      {/* HIDDEN, not unmounted. What this panel OFFERS — the job roles, the pay
          fields, the seven days — is part of the document whether or not
          somebody has opened it. Mounting it on click would mean the vocabulary
          only exists after JavaScript runs: unreachable to a contract test
          asserting the offered set equals what the API accepts, and unreadable
          to assistive tech until the click happens. */}
      <div
        hidden={!open}
        className="w-full max-w-md space-y-3 rounded-md border border-border p-3 text-start"
        data-testid="agent-edit-panel"
      >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`agent-jobRole-${userId}`}
                className="block text-xs text-muted-foreground"
              >
                {s.jobRole}
              </label>
              <select
                id={`agent-jobRole-${userId}`}
                value={f.jobRole}
                onChange={(e) => set("jobRole", e.target.value)}
                className={`mt-1 ${FIELD}`}
              >
                {jobRoles.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            {money("baseSalaryMonthly", s.salary)}
            {money("payPerConfirmedOrder", s.perConfirmed)}
            {money("payPerDeliveredOrder", s.perDelivered)}
          </div>

          <fieldset>
            <legend className="text-xs text-muted-foreground">{s.daysOff}</legend>
            {/* Seven checkboxes, indexed 0–6 Sunday-first because that is what
                getDay() returns and what the config stores. The route DROPS an
                out-of-range value rather than refusing the batch, precisely
                because this is a row of checkboxes — junk means a client bug,
                not somebody's intent, and refusing would lose the six good ones. */}
            <div className="mt-1 flex flex-wrap gap-2">
              {s.days.map((label, index) => (
                <label key={index} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    data-day={index}
                    checked={days.includes(index)}
                    onChange={(e) =>
                      setDays((d) =>
                        e.target.checked ? [...d, index] : d.filter((x) => x !== index),
                      )
                    }
                    className="h-4 w-4 rounded border-input"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <ActionButton
            data-testid="agent-save"
            data-user-id={userId}
            pending={pending}
            pendingLabel={s.saving}
            variant="primary"
            onClick={async () => {
              const { ok } = await run("PATCH", `/api/erp/agents/${userId}`, {
                jobRole: f.jobRole,
                baseSalaryMonthly: f.baseSalaryMonthly || "0",
                payPerConfirmedOrder: f.payPerConfirmedOrder || "0",
                payPerDeliveredOrder: f.payPerDeliveredOrder || "0",
              });
              // Sequential, and the second only if the first succeeded: a
              // rejected job role must not leave the days off applied, which
              // would be a half-saved form reporting failure.
              if (!ok) return;
              const saved = await run("PUT", `/api/erp/agents/${userId}/days-off`, {
                weeklyDaysOff: [...days].sort((a, b) => a - b),
              });
              if (saved.ok) setOpen(false);
            }}
          >
            {s.save}
          </ActionButton>
      </div>

      <ActionError message={error} />
    </div>
  );
}
