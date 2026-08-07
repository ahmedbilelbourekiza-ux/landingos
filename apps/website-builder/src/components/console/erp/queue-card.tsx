"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";
import { ProductThumb } from "./product-thumb";
import { StockChip, type StockLabels } from "./stock-chip";

/* =============================================================================
 * One order in the confirmation agent's queue — Phase 6.4a.
 *
 * This is the port of `apps/erp/agent.html`, and the whole app is one gesture:
 * TAP TO DIAL, then tap the outcome. Everything else on the card exists to make
 * that gesture correct.
 *
 * THE DIAL MUST NOT WAIT FOR THE SERVER, and this is the one place in the write
 * surface where that is true. `POST /call-start` is what makes duration
 * measurable, and duration is what makes the suspicious-call flag mean anything
 * — but an agent on a bad connection still has to be able to ring the customer.
 * So the anchor is a real `tel:` link, its default is never prevented, and the
 * request is fired alongside it. If the request loses, the call is still made
 * and `addCall` records it as `noStart`, which is exactly the state that flag
 * exists to describe. Blocking the dial to guarantee the timestamp would trade
 * the customer's phone call for a metric about it.
 *
 * The vocabularies and every label arrive as props, from the same
 * `lib/erp/orders.ts` the routes validate against.
 * ========================================================================== */

export interface QueueStrings {
  readonly saving: string;
  readonly call: string;
  readonly calling: string;
  readonly logResult: string;
  readonly note: string;
  readonly noteKind: string;
  readonly addNote: string;
  readonly cancel: string;
  readonly attempts: string;
  readonly neverCalled: string;
  readonly overdue: string;
  readonly open: string;
}

export interface QueueOrder {
  readonly id: string;
  readonly reference: string;
  readonly client: string;
  readonly phone: string;
  readonly destination: string;
  readonly product: string;
  readonly price: string;
  readonly placed: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly statusVars: Record<string, string>;
  readonly callCount: number;
  readonly overdue: boolean;
  /** Formatted when `pendingCallStart` is set; null otherwise. */
  readonly callingSince: string | null;
  readonly lastNote: string | null;
  /** PM.2 — the variant's photograph, falling back to the product's own. */
  readonly image: string | null;
  /**
   * PM.5 — the level of the exact variant this order is for.
   *
   * `null` when no catalogue row matches, which is a real state and not a zero:
   * an order whose product name matches nothing moves no stock at all, and
   * showing "0 out of stock" would be a claim about a product that does not
   * exist here.
   */
  readonly stock: { level: number; threshold: number; labels: StockLabels } | null;
  /** Where the parcel is, when there is one. Null while nothing is booked. */
  readonly delivery: { label: string; tracking: string | null } | null;
  /** False once the order reaches a terminal status — see TERMINAL_STATUSES. */
  readonly workable: boolean;
}

export function QueueCard({
  order,
  results,
  noteTypes,
  errors,
  s,
  detailHref,
}: {
  readonly order: QueueOrder;
  readonly results: readonly WriteOption[];
  readonly noteTypes: readonly WriteOption[];
  readonly errors: ActionErrors;
  readonly s: QueueStrings;
  readonly detailHref: string;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [noting, setNoting] = useState(false);
  const [noteType, setNoteType] = useState(noteTypes[0]?.value ?? "");
  const [note, setNote] = useState("");

  return (
    <li
      data-order-id={order.id}
      data-overdue={order.overdue ? "true" : "false"}
      className="rounded-lg border border-border bg-surface-raised p-4"
      style={order.overdue ? { borderColor: "var(--danger-border)" } : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={detailHref}
            className="font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
            dir="ltr"
          >
            {order.reference}
          </a>
          <p className="mt-0.5 truncate font-medium">{order.client || "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.overdue && (
            <span
              data-testid="queue-overdue"
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{
                color: "var(--danger-fg)",
                backgroundColor: "var(--danger-bg)",
                borderColor: "var(--danger-border)",
              }}
            >
              {s.overdue}
            </span>
          )}
          <span
            data-status={order.status}
            className="rounded-full border px-2 py-0.5 text-xs"
            style={order.statusVars}
          >
            {order.statusLabel}
          </span>
        </div>
      </div>

      {/* PM.2 / PM.5 — WHAT IS BEING SOLD, AND WHETHER THERE IS ANY LEFT.
       *
       * This is the screen an agent says "yes" on, and until now it was the
       * screen with the least information about the thing they were promising:
       * a product NAME, no photograph, and no idea whether the size the
       * customer asked for ran out this morning. Confirming a variant that is
       * gone dispatches a courier for nothing and gets the customer rung back
       * to be told no — and the legacy CRM, which shows a photograph on every
       * order, at least made the product recognisable.
       *
       * The chip only appears when the level is a problem (`onlyWhenAlert`): a
       * green pill on every card is how the two that matter disappear. */}
      <div className="mt-3 flex items-start gap-3">
        <ProductThumb src={order.image} alt="" size="sm" />
        <dl className="min-w-0 flex-1 text-sm">
          <div>
            <dt className="sr-only">{order.product}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="truncate text-foreground">{order.product || "—"}</span>
              {order.stock && (
                <StockChip
                  stock={order.stock.level}
                  threshold={order.stock.threshold}
                  labels={order.stock.labels}
                  onlyWhenAlert
                />
              )}
            </dd>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-muted-foreground">
            <dd>
              {order.destination || "—"}
              {order.price ? ` · ${order.price}` : ""}
            </dd>
            <dd>{order.placed}</dd>
          </div>
        </dl>
      </div>

      {order.lastNote && (
        <p className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-sm">{order.lastNote}</p>
      )}

      {/* Where the parcel is. The ERP opened a modal for this; the full event
          timeline already lives on the order detail, so the card carries the
          one line a customer actually rings to ask about and links to the rest.
          Only ever rendered when a shipment exists. */}
      {order.delivery && (
        <p
          data-testid="queue-delivery"
          className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          <span>{order.delivery.label}</span>
          {order.delivery.tracking && (
            <span className="font-mono text-xs" dir="ltr">{order.delivery.tracking}</span>
          )}
          <a href={detailHref} className="underline underline-offset-2">{s.open}</a>
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {order.callCount > 0
          ? `${order.callCount} ${s.attempts}`
          : s.neverCalled}
        {order.callingSince && (
          <span data-testid="queue-calling" className="ms-2">
            · {s.calling} <span dir="ltr">{order.callingSince}</span>
          </span>
        )}
      </p>

      {/* An order only reaches this card in a terminal status when the agent
          has filtered for one deliberately — to answer "where is my parcel?".
          The ERP's card dropped the dial and the result buttons there and kept
          the note, and that boundary is part of what is being ported: the queue
          is for orders still to be worked. Changing a settled one is a
          deliberate act on the order detail, which has the full call panel. */}
      {order.workable && (
      <>
      {/* The gesture. A real anchor, so the phone dials even with no network —
          and `call-start` rides along rather than gating it. */}
      <a
        data-testid="queue-dial"
        data-order-id={order.id}
        href={`tel:${order.phone}`}
        onClick={() => {
          void run("POST", `/api/erp/orders/${order.id}/call-start`);
        }}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-3 text-base font-medium text-primary-foreground"
      >
        {s.call} <span dir="ltr" className="font-mono text-sm">{order.phone}</span>
      </a>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.logResult}</h3>
      {/* Thumb-sized targets in a grid, not a row: this is worked one-handed on
          a phone while the agent is still talking. */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {results.map((r) => (
          <ActionButton
            key={r.value}
            data-result={r.value}
            data-order-id={order.id}
            style={r.vars}
            pending={pending}
            pendingLabel={s.saving}
            className="rounded-md border px-3 py-2.5 text-sm font-medium disabled:opacity-50"
            onClick={() => {
              void run("POST", `/api/erp/orders/${order.id}/call`, { result: r.value });
            }}
          >
            {r.label}
          </ActionButton>
        ))}
      </div>
      </>
      )}

      <div className="mt-3">
        <ActionButton
          data-testid="queue-note-toggle"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setNoting((n) => !n)}
          aria-expanded={noting}
        >
          {noting ? s.cancel : s.note}
        </ActionButton>
      </div>

      {/* Hidden, not unmounted — the note types are part of the document
          whether or not anybody opened the panel (D-06.4). */}
      <div hidden={!noting} className="mt-2 space-y-2" data-testid="queue-note-panel">
        <label htmlFor={`qnote-type-${order.id}`} className="ui-label block">
          {s.noteKind}
        </label>
        <select
          id={`qnote-type-${order.id}`}
          value={noteType}
          onChange={(e) => setNoteType(e.target.value)}
          className="ui-control tap w-full"
        >
          {noteTypes.map((n) => (
            <option key={n.value} value={n.value}>{n.label}</option>
          ))}
        </select>
        <textarea
          aria-label={s.note}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="ui-control tap w-full"
        />
        <ActionButton
          data-testid="queue-note-save"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          onClick={async () => {
            const { ok } = await run("POST", `/api/erp/orders/${order.id}/note`, {
              noteType,
              ...(note.trim() ? { note: note.trim() } : {}),
            });
            if (ok) { setNote(""); setNoting(false); }
          }}
        >
          {s.addNote}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </li>
  );
}
