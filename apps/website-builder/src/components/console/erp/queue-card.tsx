"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

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
      className="rounded-lg border border-border p-4"
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

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="col-span-2">
          <dt className="sr-only">{order.product}</dt>
          <dd className="text-muted-foreground">
            {order.product || "—"}
            {order.price ? ` · ${order.price}` : ""}
          </dd>
        </div>
        <div>
          <dd className="text-muted-foreground">{order.destination || "—"}</dd>
        </div>
        <div className="text-end">
          <dd className="text-muted-foreground">{order.placed}</dd>
        </div>
      </dl>

      {order.lastNote && (
        <p className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-sm">{order.lastNote}</p>
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

      <h3 className="mt-4 text-xs font-medium text-muted-foreground">{s.logResult}</h3>
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
        <label htmlFor={`qnote-type-${order.id}`} className="block text-xs text-muted-foreground">
          {s.noteKind}
        </label>
        <select
          id={`qnote-type-${order.id}`}
          value={noteType}
          onChange={(e) => setNoteType(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
