"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { EditField, WriteOption } from "@/components/console/edit-field";

export type { EditField, WriteOption };

/* =============================================================================
 * The order detail's write controls â€” Phase 6.3a.
 *
 * The agent's working loop, and the reason `apps/erp` cannot be retired until
 * it exists: start the call, log what happened, record something that was not a
 * call, mark an order fake.
 *
 * NOTHING HERE HOLDS A VOCABULARY. The call results, the note types and their
 * labels all arrive as props, because the lists live in `src/lib/erp/orders.ts`
 * next to the routes that validate against them. A copy in a client component
 * is a copy that is wrong the next time the call-centre invents an outcome â€”
 * which has already happened once, and is why "tentative3" exists.
 *
 * Every string is a prop too. That is the shape every other client component in
 * this console already has (`TenantSwitcher`, `SignOutButton`, `ConsoleNav`):
 * the server translates, the client renders.
 *
 * WHAT IS DELIBERATELY NOT GATED. The result buttons are offered whether or not
 * a call was started. `POST /call` accepts that and FLAGS it (`noStart`), so
 * hiding the control would refuse work the API allows â€” and would leave an
 * agent who forgot to press start with no way to record a call they really
 * made. The screen says what happens instead. Never offer a control the API
 * will refuse; equally, never withhold one it accepts.
 * ========================================================================== */

export interface OrderWriteStrings {
  readonly saving: string;
  readonly save: string;
  readonly editPanel: string;
  readonly editManagerFields: string;
  readonly reassignPanel: string;
  readonly assignedAgent: string;
  readonly followupAgent: string;
  readonly unassigned: string;
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
 * Editing the order
 * -------------------------------------------------------------------------- */

/* `EditField`, `WriteOption` and `editFingerprint` live in
 * `components/console/edit-field.ts` rather than here: the SERVER calls the
 * fingerprint to key this panel, and a plain function exported from a
 * `"use client"` module is a client reference on the server, not a function.
 * That file records what it cost to learn. */
export function EditPanel({
  orderId,
  errors,
  s,
  fields,
}: PanelProps & { fields: readonly EditField[] }) {
  const { run, pending, error } = useApiAction(errors);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.value])),
  );

  const set = (name: string, value: string) => setDraft((d) => ({ ...d, [name]: value }));

  const agentFields = fields.filter((f) => !f.manager);
  const managerFields = fields.filter((f) => f.manager);

  const render = (f: EditField) => (
    <div key={f.name} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
      <label htmlFor={`edit-${f.name}`} className="block text-xs text-muted-foreground">
        {f.label}
      </label>
      {f.kind === "select" ? (
        <select
          id={`edit-${f.name}`}
          name={f.name}
          value={draft[f.name] ?? ""}
          onChange={(e) => set(f.name, e.target.value)}
          className={`mt-1 ${FIELD}`}
        >
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.kind === "textarea" ? (
        <textarea
          id={`edit-${f.name}`}
          name={f.name}
          rows={2}
          value={draft[f.name] ?? ""}
          onChange={(e) => set(f.name, e.target.value)}
          className={`mt-1 ${FIELD}`}
        />
      ) : f.kind === "checkbox" ? (
        <input
          id={`edit-${f.name}`}
          name={f.name}
          type="checkbox"
          checked={draft[f.name] === "true"}
          onChange={(e) => set(f.name, String(e.target.checked))}
          className="mt-2 h-4 w-4 rounded border-input"
        />
      ) : (
        <input
          id={`edit-${f.name}`}
          name={f.name}
          // `money` stays a text input with `inputMode`, never `type="number"`.
          // A number input hands back a JS float, and 37 columns are Decimal
          // precisely so money never touches binary floating point (M-06).
          type={f.kind === "number" ? "number" : "text"}
          inputMode={f.kind === "money" ? "decimal" : undefined}
          dir={f.kind === "money" || f.kind === "number" ? "ltr" : undefined}
          value={draft[f.name] ?? ""}
          onChange={(e) => set(f.name, e.target.value)}
          className={`mt-1 ${FIELD}`}
        />
      )}
    </div>
  );

  return (
    <section className="rounded-lg border border-border p-4" data-testid="erp-edit-panel">
      <h2 className="text-sm font-medium">{s.editPanel}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">{agentFields.map(render)}</div>

      {managerFields.length > 0 && (
        <>
          {/* Captioned rather than merely present. Price is what payroll and the
              profit calculator are computed from â€” correcting the address on
              your own order is the job, editing the money on it is not. */}
          <h3 className="mt-4 text-xs font-medium text-muted-foreground">
            {s.editManagerFields}
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">{managerFields.map(render)}</div>
        </>
      )}

      <div className="mt-4">
        <ActionButton
          data-testid="edit-save"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          onClick={() => {
            // Only what actually moved. A PATCH of named fields is the reason
            // this is not the ERP's PUT, which read the order, changed one
            // field and sent the whole object back.
            const patch: Record<string, unknown> = {};
            for (const f of fields) {
              const next = draft[f.name] ?? "";
              if (next === f.value) continue;
              patch[f.name] =
                f.kind === "checkbox" ? next === "true"
                  : f.kind === "number" ? Number(next)
                    : next;
            }
            if (!Object.keys(patch).length) return;
            void run("PATCH", `/api/erp/orders/${orderId}`, patch);
          }}
        >
          {s.save}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * Handing the order to somebody else
 * -------------------------------------------------------------------------- */

/**
 * Reassignment, and the one refusal the API makes LOUD.
 *
 * Every other unwritable field is dropped silently; `agentUserId` answers 403
 * with `FORBIDDEN_FIELD`, because silently ignoring it would let an agent
 * believe they had picked up work. This panel is only ever rendered for someone
 * `seesWholeBook` is true for â€” the same predicate `buildPatch` uses to decide
 * that 403 â€” so the loud refusal stays reachable by the API and unreachable
 * from the screen.
 */
export function ReassignPanel({
  orderId,
  errors,
  s,
  members,
  currentAgentUserId,
  currentFollowupUserId,
}: PanelProps & {
  members: readonly WriteOption[];
  currentAgentUserId: string;
  currentFollowupUserId: string;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [agentUserId, setAgentUserId] = useState(currentAgentUserId);
  const [followupUserId, setFollowupUserId] = useState(currentFollowupUserId);

  const picker = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div>
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${FIELD}`}
      >
        <option value="">{s.unassigned}</option>
        {members.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section className="rounded-lg border border-border p-4" data-testid="erp-reassign-panel">
      <h2 className="text-sm font-medium">{s.reassignPanel}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {picker("agentUserId", s.assignedAgent, agentUserId, setAgentUserId)}
        {picker("followupUserId", s.followupAgent, followupUserId, setFollowupUserId)}
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="reassign-save"
          pending={pending}
          pendingLabel={s.saving}
          onClick={() => {
            const patch: Record<string, string | null> = {};
            // `null`, not `""`. The column is nullable and the ERP wrote an
            // empty string when reassignment orphaned an order, which is why
            // `orderScope` has to check both â€” this end sends one of them.
            if (agentUserId !== currentAgentUserId) patch.agentUserId = agentUserId || null;
            if (followupUserId !== currentFollowupUserId) {
              patch.followupUserId = followupUserId || null;
            }
            if (!Object.keys(patch).length) return;
            void run("PATCH", `/api/erp/orders/${orderId}`, patch);
          }}
        >
          {s.save}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}

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
              const { ok } = await run("POST", `/api/erp/orders/${orderId}/call`, {
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
            const { ok } = await run("POST", `/api/erp/orders/${orderId}/note`, {
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
