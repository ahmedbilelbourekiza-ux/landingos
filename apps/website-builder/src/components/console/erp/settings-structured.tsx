"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * The two settings that had no control at all — LP.16b, closing N23.
 *
 * `fixedCosts` (an array) and `defaultCarrierByChannel` (an object) are both
 * declared in `SETTINGS_SCHEMA`, both validated by `validateSettings`, and both
 * READ by real code. Neither was reachable by any control, because
 * `/console/erp/automation` builds its fields with
 * `spec.type !== "object" && spec.type !== "array"` — which is the RIGHT rule
 * and was chosen deliberately, so a structured setting added later cannot
 * silently render as a checkbox. The fix is the missing editors, not a change
 * to that filter.
 *
 * WHAT THE ABSENCE COST, stated because it is the reason this file exists:
 * `prorate-fixed` summed an always-empty list, so **every P&L record ever saved
 * through this console is missing its rent and salaries** — and the figure was
 * not absent, it was `0`, which reads as "there are none".
 *
 * NOT A JSON TEXTAREA. A textarea would accept anything the server's
 * `typeof value === "object"` check happens to allow, which is exactly how a
 * settings table becomes a scratchpad: `{"amount": "12OO"}` validates, saves,
 * and quietly contributes nothing to the total forever. Each editor knows the
 * shape of its own rows.
 *
 * D-06.1 — both call `PUT /api/erp/settings`, the route the automation form
 * already uses, and add no write path of their own. D-06.3 — no optimistic UI:
 * the panel is keyed on what the server returned, so a save remounts it on
 * what was stored.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface StructuredStrings {
  readonly saving: string;
  readonly save: string;
  readonly add: string;
  readonly remove: string;
  readonly fixedCosts: string;
  readonly fixedCostsHint: string;
  readonly label: string;
  readonly monthlyAmount: string;
  readonly monthlyTotal: string;
  readonly noFixedCosts: string;
  readonly channelCarriers: string;
  readonly channelCarriersHint: string;
  readonly noChannels: string;
  readonly none: string;
}

export interface FixedCostRow {
  readonly id: string;
  readonly label: string;
  readonly amount: string;
}

/** A stable row id, so React keys survive an edit and a removal mid-list. */
const rowId = () => `fc_${Math.random().toString(36).slice(2, 10)}`;

/* -----------------------------------------------------------------------------
 * fixedCosts — the recurring monthly list
 * -------------------------------------------------------------------------- */

export function FixedCostsEditor({
  errors,
  s,
  rows,
}: {
  readonly errors: ActionErrors;
  readonly s: StructuredStrings;
  readonly rows: readonly FixedCostRow[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const [draft, setDraft] = useState<FixedCostRow[]>(() => rows.map((r) => ({ ...r })));

  const set = (id: string, patch: Partial<FixedCostRow>) =>
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Displayed from the DRAFT, so a manager sees what they are about to commit
  // rather than what is stored. Deliberately not the server's number: the
  // server's is on the calculator, beside the period it was prorated onto.
  const total = draft.reduce((sum, r) => {
    const n = Number(String(r.amount).trim());
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="erp-fixed-costs">
      <h2 className="text-sm font-medium">{s.fixedCosts}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{s.fixedCostsHint}</p>

      <div className="mt-3 flex flex-col gap-2">
        {draft.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="fixed-costs-empty">
            {s.noFixedCosts}
          </p>
        )}
        {draft.map((row, i) => (
          <div key={row.id} className="flex items-end gap-2" data-fixed-cost={row.id}>
            <div className="flex-[2]">
              <label htmlFor={`fc-label-${row.id}`} className="ui-label block">
                {i === 0 ? s.label : ""}
              </label>
              <input
                id={`fc-label-${row.id}`}
                data-testid="fixed-cost-label"
                value={row.label}
                onChange={(e) => set(row.id, { label: e.target.value })}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <div className="flex-1">
              <label htmlFor={`fc-amount-${row.id}`} className="ui-label block">
                {i === 0 ? s.monthlyAmount : ""}
              </label>
              {/* Money is a text input with a decimal keypad, never
                  type="number" — a number input hands back a JS float and this
                  is summed into a Decimal column (M-06). */}
              <input
                id={`fc-amount-${row.id}`}
                data-testid="fixed-cost-amount"
                inputMode="decimal"
                dir="ltr"
                value={row.amount}
                onChange={(e) => set(row.id, { amount: e.target.value })}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <button
              type="button"
              data-testid="fixed-cost-remove"
              onClick={() => setDraft((d) => d.filter((r) => r.id !== row.id))}
              className="ui-btn ui-btn-default tap"
            >
              {s.remove}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ActionButton
          data-testid="fixed-cost-add"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setDraft((d) => [...d, { id: rowId(), label: "", amount: "" }])}
        >
          {s.add}
        </ActionButton>

        <ActionButton
          data-testid="fixed-costs-save"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          onClick={() =>
            void run("PUT", "/api/erp/settings", {
              // Blank rows are dropped rather than stored: a row with no label
              // and no amount is a half-finished thought, and storing it means
              // the list grows every time somebody clicks add and changes their
              // mind. The amount is sent as a STRING — it is summed as a
              // Decimal, and a JS number would round it on the way in.
              fixedCosts: draft
                .filter((r) => r.label.trim() || String(r.amount).trim())
                .map((r) => ({
                  id: r.id,
                  label: r.label.trim(),
                  amount: String(r.amount).trim() || "0",
                })),
            })
          }
        >
          {s.save}
        </ActionButton>

        <span className="ms-auto text-sm" data-testid="fixed-costs-total" dir="ltr">
          {s.monthlyTotal}: {total}
        </span>
      </div>

      <ActionError message={error} />
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * defaultCarrierByChannel — one carrier per sales channel
 * -------------------------------------------------------------------------- */

export interface ChannelRow {
  readonly id: string;
  readonly name: string;
}

export function ChannelCarrierEditor({
  errors,
  s,
  channels,
  carriers,
  value,
}: {
  readonly errors: ActionErrors;
  readonly s: StructuredStrings;
  readonly channels: readonly ChannelRow[];
  /** The tenant's ACTIVE carrier codes — the vocabulary the shipment path
   *  resolves against, so a code that would book nothing cannot be chosen. */
  readonly carriers: readonly { readonly code: string; readonly name: string }[];
  readonly value: Readonly<Record<string, string>>;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...value }));

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="erp-channel-carriers">
      <h2 className="text-sm font-medium">{s.channelCarriers}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{s.channelCarriersHint}</p>

      {channels.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="channel-carriers-empty">
          {s.noChannels}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {channels.map((c) => (
            <div key={c.id} data-channel={c.id}>
              <label htmlFor={`cc-${c.id}`} className="ui-label block">
                {c.name}
              </label>
              <select
                id={`cc-${c.id}`}
                data-testid="channel-carrier-select"
                value={draft[c.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                className={`mt-1 ${FIELD}`}
              >
                <option value="">{s.none}</option>
                {carriers.map((carrier) => (
                  <option key={carrier.code} value={carrier.code}>
                    {carrier.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <ActionButton
          data-testid="channel-carriers-save"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          disabled={channels.length === 0}
          onClick={() =>
            void run("PUT", "/api/erp/settings", {
              // An empty choice is REMOVED from the map rather than stored as
              // "". A stored empty string is a configured answer that means
              // nothing, and the resolver would have to know to disbelieve it.
              defaultCarrierByChannel: Object.fromEntries(
                Object.entries(draft).filter(([, code]) => code),
              ),
            })
          }
        >
          {s.save}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}
