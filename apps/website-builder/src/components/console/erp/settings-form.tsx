"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { SettingField } from "@/components/console/setting-field";

/* =============================================================================
 * The ERP's own settings — Phase 6.3d.
 *
 * THE TYPES ARE THE POINT. `validateSettings` refuses a string where a boolean
 * belongs, and the comment on that rule calls it the single most valuable line
 * in the file: `if (s.autoSuspend)` is TRUE for the STRING "false", so a typo
 * would switch on automatic account suspension for the whole company. A form
 * that posts every field as text would meet that refusal on every save, so this
 * one converts by the field's declared kind before sending.
 *
 * AN INVALID BATCH CHANGES NOTHING. The route validates the whole body and
 * writes only if every key passed, so a request carrying one good key and one
 * bad one leaves the good key unapplied. That is why the form sends ONLY what
 * actually moved: a stale untouched field cannot fail the batch that a different
 * field was being changed in.
 *
 * The cross-field rule — `workHoursEnd` must exceed `workHoursStart` — is
 * checked on the server against the MERGED result, not the submitted keys,
 * because sending one of them alone is only invalid in combination with what is
 * stored. The screen does not second-guess it; it renders the refusal.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function SettingsForm({
  errors,
  fields,
  saving,
  save,
  atomicHint,
}: {
  readonly errors: ActionErrors;
  readonly fields: readonly SettingField[];
  readonly saving: string;
  readonly save: string;
  readonly atomicHint: string;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="erp-settings-form">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key} data-setting={f.key}>
            <label htmlFor={`set-${f.key}`} className="ui-label block">
              {f.label}
            </label>

            {f.kind === "boolean" ? (
              <input
                id={`set-${f.key}`}
                type="checkbox"
                checked={draft[f.key] === "true"}
                onChange={(e) => set(f.key, String(e.target.checked))}
                className="mt-2 h-4 w-4 rounded border-input"
              />
            ) : f.kind === "enum" ? (
              <select
                id={`set-${f.key}`}
                value={draft[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                className={`mt-1 ${FIELD}`}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              // A whole number with the route's own bounds on the control. Not
              // money — none of these are — so `type="number"` is right here in
              // a way it never is for a Decimal column.
              <input
                id={`set-${f.key}`}
                type="number"
                min={f.min}
                max={f.max}
                step={1}
                dir="ltr"
                value={draft[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                className={`mt-1 ${FIELD}`}
              />
            )}
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{atomicHint}</p>

      <div className="mt-3">
        <ActionButton
          data-testid="settings-save"
          pending={pending}
          pendingLabel={saving}
          variant="primary"
          onClick={() => {
            const body: Record<string, unknown> = {};
            for (const f of fields) {
              const next = draft[f.key] ?? "";
              if (next === f.value) continue;
              body[f.key] =
                f.kind === "boolean" ? next === "true"
                  : f.kind === "number" ? Number(next)
                    : next;
            }
            if (!Object.keys(body).length) return;
            void run("PUT", "/api/erp/settings", body);
          }}
        >
          {save}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}
