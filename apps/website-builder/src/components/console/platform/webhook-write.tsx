"use client";

import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { button } from "@/components/console/ui/styles";

/* =============================================================================
 * The webhook write surface (LB.3, W-05).
 *
 * The endpoints API had full CRUD and the screen was read-only: a tenant could
 * not create, pause, test or delete an endpoint through the console at all.
 * Every control here calls the platform API route (D-06.1); the event
 * vocabulary arrives as props from the server, which reads it from the same
 * module the delivery layer filters on — a checkbox list of its own would go
 * stale the day an event is added.
 *
 * The signing secret is write-only: typed here, encrypted at rest, never
 * rendered again anywhere. The panel says so where the operator types it.
 * ========================================================================== */

export interface WebhookEventOption {
  readonly value: string;
  readonly label: string;
}

const BASE = "/api/platform/integrations/webhooks";

/* LB.42 — words arrive as a prop, per this console's convention for client
 * write controls (`lib/console/action-errors.ts`): the server translates once
 * and passes the result down, so the control holds no catalogue of its own. */
export interface WebhookLabels {
  readonly add: string;
  readonly labelPlaceholder: string;
  readonly secretPlaceholder: string;
  readonly subscribedEvents: string;
  readonly creating: string;
  readonly sending: string;
  readonly saving: string;
  readonly deleting: string;
  readonly pause: string;
  readonly activate: string;
  readonly noDeliveriesLoaded: string;
  readonly noDeliveriesYet: string;
  readonly fieldLabel: string;
  readonly fieldUrl: string;
  readonly fieldSecret: string;
  readonly createEndpoint: string;
  readonly sendTest: string;
  readonly confirmDelete: string;
  readonly keepIt: string;
  readonly deleteAction: string;
  readonly deliveries: string;
  readonly secretHint: string;
}

export function WebhookCreatePanel({
  events,
  errors,
  labels,
}: {
  readonly events: readonly WebhookEventOption[];
  readonly errors: ActionErrors;
  readonly labels: WebhookLabels;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [chosen, setChosen] = React.useState<string[]>([]);

  const toggle = (value: string) =>
    setChosen((prev) => (prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]));

  const submit = async () => {
    const { ok } = await run("POST", BASE, {
      label,
      url,
      secret,
      events: chosen,
      isActive: true,
    });
    if (ok) {
      setLabel("");
      setUrl("");
      setSecret("");
      setChosen([]);
      setOpen(false);
    }
  };

  return (
    <section className="mt-4 rounded-lg border border-border" data-testid="webhook-create">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <Plus aria-hidden className="size-4" /> {labels.add}
        </span>
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Rendered always, toggled with hidden (D-06.4). */}
      <div hidden={!open} className="border-t border-border px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {labels.fieldLabel} <span aria-hidden>*</span>
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              placeholder={labels.labelPlaceholder}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {labels.fieldUrl} <span aria-hidden>*</span>
            </span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              dir="ltr"
              inputMode="url"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              placeholder="https://example.com/webhooks/landingos"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">
              {labels.fieldSecret} <span aria-hidden>*</span> — {labels.secretHint}
            </span>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              dir="ltr"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              placeholder={labels.secretPlaceholder}
            />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm text-muted-foreground">{labels.subscribedEvents}</legend>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {events.map((event) => (
              <label key={event.value} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(event.value)}
                  onChange={() => toggle(event.value)}
                  className="mt-0.5"
                />
                <span>
                  <code className="text-xs">{event.value}</code>
                  <span className="block text-xs text-muted-foreground">{event.label}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4">
          <ActionButton
            pending={pending}
            pendingLabel={labels.creating}
            onClick={submit}
            disabled={!label.trim() || !url.trim() || secret.trim().length < 8}
          >
            {labels.createEndpoint}
          </ActionButton>
          <ActionError message={error} />
        </div>
      </div>
    </section>
  );
}

interface DeliveryRow {
  id: string;
  event: string;
  resourceId: string;
  success: boolean;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
}

export function WebhookRowActions({
  id,
  isActive,
  errors,
  labels,
}: {
  readonly id: string;
  readonly isActive: boolean;
  readonly errors: ActionErrors;
  readonly labels: WebhookLabels;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [log, setLog] = React.useState<DeliveryRow[] | null>(null);

  const test = async () => {
    setTestResult(null);
    const { ok, data } = await run("POST", `${BASE}/${id}/test`);
    if (ok && data && typeof data === "object") {
      const r = data as { ok: boolean; statusCode: number | null; error: string | null };
      setTestResult(
        r.ok
          ? `Received — HTTP ${r.statusCode}`
          : `Failed — ${r.error ?? (r.statusCode ? `HTTP ${r.statusCode}` : "no response")}`,
      );
      // The test wrote a delivery row; an open log should show it.
      if (logOpen) void loadLog();
    }
  };

  const loadLog = async () => {
    try {
      const res = await fetch(`${BASE}/${id}/deliveries`, { credentials: "same-origin" });
      const json = await res.json();
      if (json?.success && Array.isArray(json.data?.items)) setLog(json.data.items);
    } catch {
      // The table below says "no deliveries loaded" — a log view failing to
      // load must not look like a log with nothing in it.
      setLog(null);
    }
  };

  const toggleLog = () => {
    const next = !logOpen;
    setLogOpen(next);
    if (next && log === null) void loadLog();
  };

  return (
    <div data-testid="webhook-actions">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton pending={pending} pendingLabel={labels.sending} size="sm" variant="default" onClick={test}>
          {labels.sendTest}
        </ActionButton>
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
              pendingLabel={labels.deleting}
              size="sm"
              variant="danger"
              onClick={() => run("DELETE", `${BASE}/${id}`)}
            >
              {labels.confirmDelete}
            </ActionButton>
            <button type="button" className={button("default", "sm")} onClick={() => setConfirmingDelete(false)}>
              {labels.keepIt}
            </button>
          </>
        ) : (
          <button type="button" className={button("default", "sm")} onClick={() => setConfirmingDelete(true)}>
            {labels.deleteAction}
          </button>
        )}
        <button
          type="button"
          className={button("ghost", "sm")}
          aria-expanded={logOpen}
          onClick={toggleLog}
        >
          {labels.deliveries}
        </button>
      </div>

      {testResult && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="webhook-test-result">
          {testResult}
        </p>
      )}
      <ActionError message={error} />

      <div hidden={!logOpen} className="mt-3">
        {log === null ? (
          <p className="text-xs text-muted-foreground">{labels.noDeliveriesLoaded}</p>
        ) : log.length === 0 ? (
          <p className="text-xs text-muted-foreground">{labels.noDeliveriesYet}</p>
        ) : (
          <ul className="space-y-1 text-xs" data-testid="webhook-deliveries">
            {log.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1">
                <code>{d.event}</code>
                <span className={d.success ? "text-muted-foreground" : "font-medium"}>
                  {d.success ? `HTTP ${d.statusCode}` : d.error ?? "failed"}
                </span>
                <span className="text-muted-foreground">
                  attempt {d.attempts} · {new Date(d.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
