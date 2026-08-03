"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * The order detail's write controls — Phase 6.3a.
 *
 * The agent's working loop, and the reason `apps/erp` cannot be retired until
 * it exists: start the call, log what happened, record something that was not a
 * call, mark an order fake.
 *
 * NOTHING HERE HOLDS A VOCABULARY. The call results, the note types and their
 * labels all arrive as props, because the lists live in `src/lib/erp/orders.ts`
 * next to the routes that validate against them. A copy in a client component
 * is a copy that is wrong the next time the call-centre invents an outcome —
 * which has already happened once, and is why "tentative3" exists.
 *
 * Every string is a prop too. That is the shape every other client component in
 * this console already has (`TenantSwitcher`, `SignOutButton`, `ConsoleNav`):
 * the server translates, the client renders.
 *
 * WHAT IS DELIBERATELY NOT GATED. The result buttons are offered whether or not
 * a call was started. `POST /call` accepts that and FLAGS it (`noStart`), so
 * hiding the control would refuse work the API allows — and would leave an
 * agent who forgot to press start with no way to record a call they really
 * made. The screen says what happens instead. Never offer a control the API
 * will refuse; equally, never withhold one it accepts.
 * ========================================================================== */

export interface WriteOption {
  readonly value: string;
  readonly label: string;
  /** Tone variables from @landingos/ui, resolved on the server. */
  readonly vars?: Record<string, string>;
}

export interface OrderWriteStrings {
  readonly saving: string;
  readonly callPanel: string;
  readonly startCall: string;
  readonly callRunning: string;
  readonly logResult: string;
  readonly noStartHint: string;
  readonly callNote: string;
  readonly notePanel: string;
  readonly noteKind: string;
  readonly noteDetail: string;
  readonly noteHint: string;
  readonly addNote: string;
  readonly classifyPanel: string;
  readonly classifyHint: string;
  readonly markFake: string;
  readonly clearFake: string;
  readonly fakeReason: string;
  readonly fakeResponsible: string;
}

interface PanelProps {
  readonly orderId: string;
  readonly errors: ActionErrors;
  readonly s: OrderWriteStrings;
}

const FIELD =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/* -----------------------------------------------------------------------------
 * The call
 * -------------------------------------------------------------------------- */

export function CallPanel({
  orderId,
  errors,
  s,
  results,
  /** Formatted on the server when `pendingCallStart` is set; null otherwise. */
  runningSince,
}: PanelProps & { results: readonly WriteOption[]; runningSince: string | null }) {
  const { run, pending, error } = useApiAction(errors);
  const [note, setNote] = useState("");

  return (
    <section className="rounded-lg border border-border p-4" data-testid="erp-call-panel">
      <h2 className="text-sm font-medium">{s.callPanel}</h2>

      {runningSince ? (
        // The server's answer, not a timer this component started. A refresh,
        // a second tab or another agent's action all show the same thing.
        <p className="mt-2 text-sm text-muted-foreground" data-testid="call-running">
          {s.callRunning} <span dir="ltr">{runningSince}</span>
        </p>
      ) : (
        <div className="mt-3">
          <ActionButton
            data-testid="call-start"
            pending={pending}
            pendingLabel={s.saving}
            variant="primary"
            onClick={() => run("POST", `/api/erp/orders/${orderId}/call-start`)}
          >
            {s.startCall}
          </ActionButton>
          <p className="mt-2 text-xs text-muted-foreground">{s.noStartHint}</p>
        </div>
      )}

      <h3 className="mt-4 text-xs font-medium text-muted-foreground">{s.logResult}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {results.map((r) => (
          <ActionButton
            key={r.value}
            data-result={r.value}
            style={r.vars}
            pending={pending}
            pendingLabel={s.saving}
            onClick={async () => {
              const ok = await run("POST", `/api/erp/orders/${orderId}/call`, {
                result: r.value,
                ...(note.trim() ? { note: note.trim() } : {}),
              });
              if (ok) setNote("");
            }}
          >
            {r.label}
          </ActionButton>
        ))}
      </div>

      <label htmlFor="call-note" className="mt-3 block text-xs text-muted-foreground">
        {s.callNote}
      </label>
      <textarea
        id="call-note"
        name="call-note"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={`mt-1 ${FIELD}`}
      />

      <ActionError message={error} />
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * A note, which is not a call
 * -------------------------------------------------------------------------- */

export function NotePanel({
  orderId,
  errors,
  s,
  noteTypes,
}: PanelProps & { noteTypes: readonly WriteOption[] }) {
  const { run, pending, error } = useApiAction(errors);
  const [noteType, setNoteType] = useState(noteTypes[0]?.value ?? "");
  const [note, setNote] = useState("");

  return (
    <section className="rounded-lg border border-border p-4" data-testid="erp-note-panel">
      <h2 className="text-sm font-medium">{s.notePanel}</h2>
      {/* Said on the screen because the obvious implementation reuses the call
          path and quietly marks an order confirmed when somebody records
          "customer rang us". The API refuses to; a person should know why. */}
      <p className="mt-1 text-xs text-muted-foreground">{s.noteHint}</p>

      <label htmlFor="note-type" className="mt-3 block text-xs text-muted-foreground">
        {s.noteKind}
      </label>
      <select
        id="note-type"
        name="note-type"
        value={noteType}
        onChange={(e) => setNoteType(e.target.value)}
        className={`mt-1 ${FIELD}`}
      >
        {noteTypes.map((n) => (
          <option key={n.value} value={n.value}>
            {n.label}
          </option>
        ))}
      </select>

      <label htmlFor="note-detail" className="mt-3 block text-xs text-muted-foreground">
        {s.noteDetail}
      </label>
      <textarea
        id="note-detail"
        name="note-detail"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={`mt-1 ${FIELD}`}
      />

      <div className="mt-3">
        <ActionButton
          data-testid="note-submit"
          pending={pending}
          pendingLabel={s.saving}
          onClick={async () => {
            const ok = await run("POST", `/api/erp/orders/${orderId}/note`, {
              noteType,
              ...(note.trim() ? { note: note.trim() } : {}),
            });
            if (ok) setNote("");
          }}
        >
          {s.addNote}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * Fake, or not
 * -------------------------------------------------------------------------- */

export function ClassifyPanel({
  orderId,
  errors,
  s,
  isFake,
}: PanelProps & { isFake: boolean }) {
  const { run, pending, error } = useApiAction(errors);
  const [reason, setReason] = useState("");
  const [responsible, setResponsible] = useState("");

  return (
    <section className="rounded-lg border border-border p-4" data-testid="erp-classify-panel">
      <h2 className="text-sm font-medium">{s.classifyPanel}</h2>
      {/* Classification is orthogonal to status and lives in its own column:
          a confirmed order that turns out to be fake is still confirmed. */}
      <p className="mt-1 text-xs text-muted-foreground">{s.classifyHint}</p>

      {isFake ? (
        <div className="mt-3">
          <ActionButton
            data-testid="classify-clear"
            pending={pending}
            pendingLabel={s.saving}
            onClick={() =>
              run("POST", `/api/erp/orders/${orderId}/classify`, { classification: "" })
            }
          >
            {s.clearFake}
          </ActionButton>
        </div>
      ) : (
        <>
          <label htmlFor="fake-reason" className="mt-3 block text-xs text-muted-foreground">
            {s.fakeReason}
          </label>
          <input
            id="fake-reason"
            name="fake-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />

          <label htmlFor="fake-responsible" className="mt-3 block text-xs text-muted-foreground">
            {s.fakeResponsible}
          </label>
          <input
            id="fake-responsible"
            name="fake-responsible"
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />

          <div className="mt-3">
            <ActionButton
              data-testid="classify-fake"
              pending={pending}
              pendingLabel={s.saving}
              variant="danger"
              onClick={() =>
                run("POST", `/api/erp/orders/${orderId}/classify`, {
                  classification: "fake",
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                  ...(responsible.trim() ? { responsible: responsible.trim() } : {}),
                })
              }
            >
              {s.markFake}
            </ActionButton>
          </div>
        </>
      )}

      <ActionError message={error} />
    </section>
  );
}
