"use client";

import { useRef, useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * Bulk actions over the order book — Phase 6.3b.
 *
 * THE SELECTION IS A FORM, not client state mirroring one. The table stays a
 * SERVER component and is passed in as `children`; the checkboxes it renders are
 * plain inputs, and this component reads them with `FormData`. That is what a
 * form is for, it keeps the list server-rendered — filtering, scoping and paging
 * all still happen in the query (PERF-02) — and there is no second copy of which
 * rows are ticked to fall out of step with the ones on screen.
 *
 * `POST /orders/bulk` is the most valuable endpoint on the surface to point
 * somewhere it should not go: it takes a list of primary keys straight from the
 * request. Nothing here weakens that. Ids outside the caller's record scope are
 * reported "not found" per id by the route, which is why the outcome is shown as
 * a COUNT rather than assumed — forty-nine of fifty is a result, not a failure,
 * and the one that did not move is exactly what a person needs to know.
 * ========================================================================== */

export interface BulkStrings {
  readonly saving: string;
  readonly selected: string;
  readonly changeStatus: string;
  readonly apply: string;
  readonly assignTo: string;
  readonly assign: string;
  readonly deleteSelected: string;
  readonly outcome: string;
  readonly of: string;
}

export function OrderBulkBar({
  errors,
  s,
  statuses,
  members,
  /** True only when `seesWholeBook` is — the same predicate the route uses. */
  managesBook,
  children,
}: {
  readonly errors: ActionErrors;
  readonly s: BulkStrings;
  readonly statuses: readonly WriteOption[];
  readonly members: readonly WriteOption[];
  readonly managesBook: boolean;
  readonly children: React.ReactNode;
}) {
  const { run, pending, error } = useApiAction(errors);
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState(statuses[0]?.value ?? "");
  const [assignee, setAssignee] = useState("");
  const [outcome, setOutcome] = useState<{ succeeded: number; processed: number } | null>(null);

  const ids = () =>
    form.current ? (new FormData(form.current).getAll("orderId") as string[]) : [];

  const send = async (action: "status" | "assign" | "delete", value?: string) => {
    const selected = ids();
    if (!selected.length) return;
    setOutcome(null);
    const { ok, data } = await run("POST", "/api/erp/orders/bulk", {
      ids: selected,
      action,
      ...(value === undefined ? {} : { value }),
    });
    if (ok) {
      const r = data as { succeeded?: number; processed?: number };
      setOutcome({ succeeded: r.succeeded ?? 0, processed: r.processed ?? selected.length });
      setCount(0);
    }
  };

  return (
    <form
      ref={form}
      onSubmit={(e) => e.preventDefault()}
      // Recount from the form itself rather than tracking each box, so the
      // number shown is always what would be sent.
      onChange={() => setCount(ids().length)}
    >
      <div
        data-testid="erp-bulk-bar"
        className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
      >
        <span className="text-sm text-muted-foreground" data-testid="bulk-selected">
          {count} {s.selected}
        </span>

        <div>
          <label htmlFor="bulk-status" className="block text-xs text-muted-foreground">
            {s.changeStatus}
          </label>
          <select
            id="bulk-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {statuses.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <ActionButton
          data-testid="bulk-status-apply"
          pending={pending}
          pendingLabel={s.saving}
          disabled={count === 0}
          onClick={() => void send("status", status)}
        >
          {s.apply}
        </ActionButton>

        {/* Assign and delete are refused for anyone `seesWholeBook` is false
            for — the route says so explicitly — so they are not offered. */}
        {managesBook && (
          <>
            <div>
              <label htmlFor="bulk-assign" className="block text-xs text-muted-foreground">
                {s.assignTo}
              </label>
              <select
                id="bulk-assign"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <ActionButton
              data-testid="bulk-assign-apply"
              pending={pending}
              pendingLabel={s.saving}
              disabled={count === 0}
              onClick={() => void send("assign", assignee)}
            >
              {s.assign}
            </ActionButton>

            <ActionButton
              data-testid="bulk-delete"
              pending={pending}
              pendingLabel={s.saving}
              disabled={count === 0}
              variant="danger"
              onClick={() => void send("delete")}
            >
              {s.deleteSelected}
            </ActionButton>
          </>
        )}

        {outcome && (
          <span className="text-sm" data-testid="bulk-outcome">
            {s.outcome} {outcome.succeeded} {s.of} {outcome.processed}
          </span>
        )}
      </div>

      <ActionError message={error} />

      {children}
    </form>
  );
}
