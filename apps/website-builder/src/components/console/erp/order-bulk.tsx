"use client";

import { useRef, useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";
import { cn } from "@/lib/utils";

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
  readonly selectAll: string;
  readonly changeStatus: string;
  readonly apply: string;
  readonly assignTo: string;
  readonly assign: string;
  readonly deleteSelected: string;
  readonly exportSelected: string;
  readonly outcome: string;
  readonly of: string;
  /* LP.9 / R7 — the four restored actions. */
  readonly markFake: string;
  readonly clearFake: string;
  readonly fakeReason: string;
  readonly followupAgent: string;
  readonly assignFollowup: string;
  readonly autoAssign: string;
  readonly carrier: string;
  readonly createShipments: string;
  readonly sendToDelivery: string;
  readonly bookingHint: string;
}

export function OrderBulkBar({
  errors,
  s,
  statuses,
  members,
  /** True only when `seesWholeBook` is — the same predicate the route uses. */
  managesBook,
  /** Follow-up-capable members. Empty when nobody carries the job role, in
   *  which case the control is not offered: the route would answer
   *  "nobody eligible" for every id. */
  followupMembers = [],
  /** The tenant's active carriers. Absent for a caller who may not write
   *  `carrierCode`, which is MANAGER_WRITABLE. */
  carriers = [],
  /** `erp:shipments:write` — what `POST /orders/[id]/shipment` checks, and
   *  therefore what decides whether the two booking controls exist. */
  mayBook,
  /** The route's own ceiling, so the control can say the number rather than
   *  the operator discovering it as a 422. */
  bookLimit,
  children,
}: {
  readonly errors: ActionErrors;
  readonly s: BulkStrings;
  readonly statuses: readonly WriteOption[];
  readonly members: readonly WriteOption[];
  readonly managesBook: boolean;
  readonly followupMembers?: readonly WriteOption[];
  readonly carriers?: readonly WriteOption[];
  readonly mayBook: boolean;
  readonly bookLimit: number;
  readonly children: React.ReactNode;
}) {
  const { run, pending, error } = useApiAction(errors);
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState(statuses[0]?.value ?? "");
  const [assignee, setAssignee] = useState("");
  const [followup, setFollowup] = useState("");
  const [carrier, setCarrier] = useState("");
  const [fakeReason, setFakeReason] = useState("");
  const [outcome, setOutcome] = useState<{ succeeded: number; processed: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const ids = () =>
    form.current ? (new FormData(form.current).getAll("orderId") as string[]) : [];

  /** Every selectable row on THIS page — what "all" means. The route is bounded
   *  per call and the page is fifty rows, so "all" can never mean the whole
   *  book, which is the version of this control that ends in an accident. */
  const boxes = (): HTMLInputElement[] =>
    form.current
      ? Array.from(form.current.querySelectorAll<HTMLInputElement>('input[name="orderId"]'))
      : [];

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

  type BulkAction =
    | "status" | "assign" | "delete"
    | "classify" | "assignFollowup" | "createShipments" | "sendToDelivery";

  const send = async (action: BulkAction, value?: string, extra?: Record<string, unknown>) => {
    const selected = ids();
    if (!selected.length) return;
    setOutcome(null);
    const { ok, data } = await run("POST", "/api/erp/orders/bulk", {
      ids: selected,
      action,
      ...(value === undefined ? {} : { value }),
      ...(extra ?? {}),
    });
    if (ok) {
      const r = data as { succeeded?: number; processed?: number };
      setOutcome({ succeeded: r.succeeded ?? 0, processed: r.processed ?? selected.length });
      setCount(0);
    }
  };

  /** Booking asks a carrier once per order and the route refuses above its own
   *  ceiling by name. Saying the number here means an operator narrows the
   *  selection instead of discovering the limit as a 422. */
  const overBookLimit = count > bookLimit;

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
        /* UI.16 — it follows you down the list.
         *
         * The bar sat above the table in the flow, so selecting row 40 meant
         * scrolling back to the top to act on it — on the one screen where the
         * whole point is acting on many rows at once. `sticky` under the shell
         * header keeps it in view while the table scrolls past.
         *
         * It also changes state rather than only reporting one: with nothing
         * ticked it is a muted strip, and with a selection it takes the
         * selected tint the rows themselves have, so "these rows and this bar
         * are one thing" is said in colour rather than in prose. Every control
         * stays rendered in both states (D-06.4) and stays disabled at zero,
         * which is the rule it already followed. */
        className={cn(
          "sticky top-[calc(var(--console-header-h)+0.5rem)] z-20 flex flex-wrap items-end gap-3",
          "rounded-lg border p-3 backdrop-blur-sm transition-colors duration-(--duration-base)",
          count > 0
            ? "border-surface-selected-border bg-surface-selected shadow-e2"
            : "border-border bg-surface-raised/90",
        )}
      >
        <span
          className="flex items-center gap-2 text-sm font-medium"
          data-testid="bulk-selected"
          // The count changes without anything moving on screen, so it is
          // announced. A supervisor ticking fifty rows with the keyboard has no
          // other way to know where they are.
          aria-live="polite"
        >
          <span
            className={cn(
              "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs tabular-nums",
              count > 0
                ? "bg-primary text-primary-foreground"
                : "bg-surface-sunken text-muted-foreground",
            )}
            dir="ltr"
          >
            {count}
          </span>
          <span className={count > 0 ? "text-foreground" : "text-muted-foreground"}>
            {s.selected}
          </span>
        </span>

        {/* UI.16 — select all.
         *
         * There was none, so "confirm every pending order in Alger from
         * yesterday" — the exact workflow the filter bar exists to enable —
         * ended in ticking up to fifty boxes by hand.
         *
         * It lives here rather than in the table's header cell because the
         * table is a SERVER component and the form is this one's: a control in
         * the header would need its own client boundary and its own way to
         * reach the same checkboxes, which is a second owner of one selection.
         * `indeterminate` is set through a ref because it is a DOM property
         * with no attribute — the state that says "some, not all", which a
         * two-state box cannot express. */}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            ref={(el) => {
              if (el) el.indeterminate = count > 0 && count < boxes().length;
            }}
            type="checkbox"
            data-testid="bulk-select-all"
            checked={count > 0 && count === boxes().length}
            onChange={(e) => {
              for (const box of boxes()) box.checked = e.target.checked;
              setCount(ids().length);
            }}
            className="size-4 shrink-0 cursor-pointer rounded-sm border-input accent-(--primary)"
          />
          {s.selectAll}
        </label>

        <div>
          <label htmlFor="bulk-status" className="ui-label block">
            {s.changeStatus}
          </label>
          <select
            id="bulk-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="ui-control tap mt-1"
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

        {/* LP.9 / R7 — CLASSIFY, offered to everybody the table is.
            `POST /orders/[id]/classify` is `erp:orders:write` plus ownership and
            nothing more, so requiring a manager here would make the bulk action
            STRICTER than the single one: an agent could mark one of their own
            orders fake and not fifty. The reason travels with the mark, because
            a bulk flag with no reason is the one that gets disputed later. */}
        <div>
          <label htmlFor="bulk-fake-reason" className="ui-label block">
            {s.fakeReason}
          </label>
          <input
            id="bulk-fake-reason"
            value={fakeReason}
            onChange={(e) => setFakeReason(e.target.value)}
            className="ui-control tap mt-1"
          />
        </div>
        <ActionButton
          data-testid="bulk-classify-fake"
          pending={pending}
          pendingLabel={s.saving}
          disabled={count === 0}
          onClick={() => void send("classify", "fake", { reason: fakeReason })}
        >
          {s.markFake}
        </ActionButton>
        <ActionButton
          data-testid="bulk-classify-clear"
          pending={pending}
          pendingLabel={s.saving}
          disabled={count === 0}
          onClick={() => void send("classify", "")}
        >
          {s.clearFake}
        </ActionButton>

        {/* Assign and delete are refused for anyone `seesWholeBook` is false
            for — the route says so explicitly — so they are not offered. */}
        {managesBook && (
          <>
            <div>
              <label htmlFor="bulk-assign" className="ui-label block">
                {s.assignTo}
              </label>
              <select
                id="bulk-assign"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="ui-control tap mt-1"
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

            {/* LP.9 / R13 — the follow-up half of assignment, in bulk.
                An empty choice means AUTO: the route treats it as the legacy's
                `auto: !value` and runs the same workload rule the automation
                does. Offered only when somebody carries the follow-up job role,
                because otherwise every id comes back "nobody eligible". */}
            {followupMembers.length > 0 && (
              <>
                <div>
                  <label htmlFor="bulk-followup" className="ui-label block">
                    {s.followupAgent}
                  </label>
                  <select
                    id="bulk-followup"
                    value={followup}
                    onChange={(e) => setFollowup(e.target.value)}
                    className="ui-control tap mt-1"
                  >
                    <option value="">{s.autoAssign}</option>
                    {followupMembers.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <ActionButton
                  data-testid="bulk-assign-followup"
                  pending={pending}
                  pendingLabel={s.saving}
                  disabled={count === 0}
                  onClick={() => void send("assignFollowup", followup)}
                >
                  {s.assignFollowup}
                </ActionButton>
              </>
            )}

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

        {/* LP.9 / R7 — THE HIGHEST-VOLUME MANAGER ACTION THERE IS.
            Booking a day's confirmed orders one at a time is the difference
            between a minute and an hour. Gated on `erp:shipments:write`, which
            is what `POST /orders/[id]/shipment` checks — an agent booking their
            own confirmed order is ordinary work, so `mayBook` is not
            `managesBook`. The carrier picker is, because `carrierCode` is
            MANAGER_WRITABLE. */}
        {mayBook && (
          <>
            {carriers.length > 0 && (
              <>
                <div>
                  <label htmlFor="bulk-carrier" className="ui-label block">
                    {s.carrier}
                  </label>
                  <select
                    id="bulk-carrier"
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    className="ui-control tap mt-1"
                  >
                    <option value="">—</option>
                    {carriers.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <ActionButton
                  data-testid="bulk-send-to-delivery"
                  pending={pending}
                  pendingLabel={s.saving}
                  disabled={count === 0 || overBookLimit || !carrier}
                  onClick={() => void send("sendToDelivery", carrier)}
                >
                  {s.sendToDelivery}
                </ActionButton>
              </>
            )}

            <ActionButton
              data-testid="bulk-create-shipments"
              pending={pending}
              pendingLabel={s.saving}
              disabled={count === 0 || overBookLimit}
              onClick={() => void send("createShipments")}
            >
              {s.createShipments}
            </ActionButton>

            {overBookLimit && (
              <span className="text-xs text-muted-foreground" data-testid="bulk-book-limit">
                {s.bookingHint} {bookLimit}
              </span>
            )}
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
