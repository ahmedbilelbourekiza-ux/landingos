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
  readonly exportSelected: string;
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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const ids = () =>
    form.current ? (new FormData(form.current).getAll("orderId") as string[]) : [];

  /**
   * The ticked rows, as a file.
   *
   * A direct `fetch` rather than `useApiAction`, and it is the one control on
   * this surface that needs one: the response is a CSV document, not the JSON
   * envelope every other route answers with, so there is nothing for that hook
   * to parse. It still calls the API route and nothing else (D-06.1) — the
   * difference is only in what comes back.
   *
   * A POST rather than a link, because two hundred cuids do not fit comfortably
   * in a query string and some proxies would truncate them silently. The
   * filter-driven exports above the table ARE links, for the reasons in
   * `order-export.tsx`.
   */
  const exportSelected = async () => {
    const selected = ids();
    if (!selected.length) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const res = await fetch("/api/erp/orders/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "orders", ids: selected }),
      });

      if (!res.ok) {
        // The same envelope every refusal uses, turned into the same message
        // every other control shows. A failed download is otherwise silent:
        // the browser simply does not save a file.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        setDownloadError(errors[body?.error?.code ?? ""] ?? errors[""]);
        return;
      }

      // The filename comes from Content-Disposition, because only the server
      // knows the date it stamped into the file.
      const disposition = res.headers.get("content-disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "orders.csv";

      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = named;
      anchor.click();
      // Revoked on the next tick: revoking synchronously races the click on
      // some browsers and the download silently produces an empty file.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setDownloadError(errors.NETWORK ?? errors[""]);
    } finally {
      setDownloading(false);
    }
  };

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

        {/* Offered to everyone the table is, because the export route is gated
            on `erp:orders:read` and record-scoped: an agent exports their own
            queue, which is what they are already looking at. Withholding a
            control the API accepts is the other half of D-06.2. */}
        <ActionButton
          data-testid="bulk-export"
          pending={downloading}
          pendingLabel={s.saving}
          disabled={count === 0}
          onClick={() => void exportSelected()}
        >
          {s.exportSelected}
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
      <ActionError message={downloadError} />

      {children}
    </form>
  );
}
