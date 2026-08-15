"use client";

import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { button } from "@/components/console/ui/styles";
import { TRACKING_PROVIDERS, trackingProvider } from "@/lib/tracking/config";

/* =============================================================================
 * The tracking-integration write surface (LB.5).
 *
 * The provider catalogue is imported DIRECTLY from lib/tracking/config —
 * directive-free, no secrets, and it carries RegExp validators that cannot
 * cross the server-props boundary. Same one the API route validates against,
 * so the form and the refusal cannot disagree (the edit-field.ts pattern).
 *
 * Server credentials are write-only: typed here, encrypted at rest, shown
 * never again. Every control calls the platform API route (D-06.1).
 * ========================================================================== */

const BASE = "/api/platform/integrations/tracking";

/* LB.42 — the panel takes its words as a PROP rather than reading a
 * catalogue. That is this console's stated convention for client write
 * controls (see `lib/console/action-errors.ts`): the server translates once
 * and hands the result down, so a write control never depends on whether
 * messages happen to be available client-side. */
export interface TrackingLabels {
  readonly connect: string;
  readonly platform: string;
  readonly labelPlaceholder: string;
  readonly managedBy: string;
  readonly operator: string;
  readonly connecting: string;
  readonly saving: string;
  readonly removing: string;
  readonly pause: string;
  readonly activate: string;
  readonly fieldLabel: string;
  readonly testCodeHint: string;
  readonly connectAction: string;
  readonly confirmRemove: string;
  readonly keepIt: string;
  readonly remove: string;
}

export function TrackingCreatePanel({
  errors,
  labels,
}: {
  readonly errors: ActionErrors;
  readonly labels: TrackingLabels;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = React.useState(false);
  const [provider, setProvider] = React.useState(TRACKING_PROVIDERS[0].id);
  const [label, setLabel] = React.useState("");
  const [publicId, setPublicId] = React.useState("");
  const [serverToken, setServerToken] = React.useState("");
  const [testCode, setTestCode] = React.useState("");
  const [managedBy, setManagedBy] = React.useState<"customer" | "platform">("customer");
  const [settings, setSettings] = React.useState<Record<string, string>>({});

  const spec = trackingProvider(provider)!;

  const submit = async () => {
    const { ok } = await run("POST", BASE, {
      provider,
      label,
      publicId,
      serverToken: serverToken.trim() || undefined,
      testCode: testCode.trim() || undefined,
      settings,
      managedBy,
      isActive: true,
    });
    if (ok) {
      setLabel("");
      setPublicId("");
      setServerToken("");
      setTestCode("");
      setSettings({});
      setOpen(false);
    }
  };

  const input = "w-full rounded-md border border-border bg-background px-3 py-2";

  return (
    <section className="mt-4 rounded-lg border border-border" data-testid="tracking-create">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <Plus aria-hidden className="size-4" /> {labels.connect}
        </span>
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Rendered always, toggled with hidden (D-06.4). */}
      <div hidden={!open} className="border-t border-border px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{labels.platform}</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
              {TRACKING_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {labels.fieldLabel} <span aria-hidden>*</span>
            </span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={input}
              placeholder={labels.labelPlaceholder} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {spec.publicIdLabel} <span aria-hidden>*</span> — {spec.publicIdHint}
            </span>
            <input value={publicId} onChange={(e) => setPublicId(e.target.value)} dir="ltr"
              className={`${input} font-mono text-xs`} />
          </label>
          {spec.serverTokenLabel && (
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                {spec.serverTokenLabel} — stored encrypted, shown only now
              </span>
              <input value={serverToken} onChange={(e) => setServerToken(e.target.value)} dir="ltr"
                className={`${input} font-mono text-xs`} />
            </label>
          )}
          {spec.supportsTestCode && (
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                {labels.testCodeHint}
              </span>
              <input value={testCode} onChange={(e) => setTestCode(e.target.value)} dir="ltr"
                className={`${input} font-mono text-xs`} />
            </label>
          )}
          {spec.settingsFields.map((field) => (
            <label key={field.key} className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                {field.label} {field.required && <span aria-hidden>*</span>}
              </span>
              <input
                value={settings[field.key] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [field.key]: e.target.value }))}
                dir="ltr"
                className={`${input} font-mono text-xs`}
              />
            </label>
          ))}
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{labels.managedBy}</span>
            <select value={managedBy} onChange={(e) => setManagedBy(e.target.value as "customer" | "platform")} className={input}>
              <option value="customer">This company (customer-owned)</option>
              <option value="platform">{labels.operator}</option>
            </select>
          </label>
        </div>

        <div className="mt-4">
          <ActionButton
            pending={pending}
            pendingLabel={labels.connecting}
            onClick={submit}
            disabled={!label.trim() || !publicId.trim()}
          >
            {labels.connectAction}
          </ActionButton>
          <ActionError message={error} />
        </div>
      </div>
    </section>
  );
}

export function TrackingRowActions({
  id,
  isActive,
  errors,
  labels,
}: {
  readonly id: string;
  readonly isActive: boolean;
  readonly errors: ActionErrors;
  readonly labels: TrackingLabels;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  return (
    <div data-testid="tracking-actions">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          pending={pending}
          pendingLabel={labels.saving}
          size="sm"
          variant="default"
          onClick={() => run("PATCH", `${BASE}/${id}`, { isActive: !isActive })}
        >
          {isActive ? labels.pause : labels.activate}
        </ActionButton>
        {confirmingDelete ? (
          <>
            <ActionButton
              pending={pending}
              pendingLabel={labels.removing}
              size="sm"
              variant="danger"
              onClick={() => run("DELETE", `${BASE}/${id}`)}
            >
              {labels.confirmRemove}
            </ActionButton>
            <button type="button" className={button("default", "sm")} onClick={() => setConfirmingDelete(false)}>
              {labels.keepIt}
            </button>
          </>
        ) : (
          <button type="button" className={button("default", "sm")} onClick={() => setConfirmingDelete(true)}>
            {labels.remove}
          </button>
        )}
      </div>
      <ActionError message={error} />
    </div>
  );
}
