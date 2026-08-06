"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * Connecting a storefront — LP.15, restoring R8.
 *
 * The channel API has had full CRUD since Phase 5.3c and **no screen and no nav
 * item**, so a tenant could not connect a Shopify store through the console at
 * all — and the webhook URL, which is generated on create, was never shown
 * again by anything.
 *
 * THE WEBHOOK URL IS THE PRODUCT OF THIS SCREEN. Everything else configures it;
 * that string is what somebody pastes into Shopify. It is displayed with a copy
 * control and is never truncated, because a URL truncated with an ellipsis and
 * then copied is a URL that silently does not work.
 *
 * D-06.1: every control calls the route. D-06.3: on success the router refreshes
 * and the server re-renders. A credential is never echoed back — the API answers
 * with the mask, and sending the mask BACK is dropped by the route rather than
 * written (which would replace a real secret with four bullets and silently stop
 * every genuine webhook).
 * ========================================================================== */

export interface ChannelStrings {
  readonly saving: string;
  readonly newChannel: string;
  readonly name: string;
  readonly platform: string;
  readonly brand: string;
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly webhookSecret: string;
  readonly webhookUrl: string;
  readonly webhookHint: string;
  readonly create: string;
  readonly save: string;
  readonly cancel: string;
  readonly test: string;
  readonly testing: string;
  readonly logs: string;
  readonly hideLogs: string;
  readonly noLogs: string;
  readonly deactivate: string;
  readonly activate: string;
  readonly maskKeeps: string;
  readonly noAdapter: string;
  readonly structural: string;
}

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function ChannelCreatePanel({
  errors,
  s,
  platforms,
}: {
  readonly errors: ActionErrors;
  readonly s: ChannelStrings;
  readonly platforms: readonly (WriteOption & { registered: boolean })[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: "", platform: platforms[0]?.value ?? "", brand: "",
    apiUrl: "", apiKey: "", apiSecret: "", webhookSecret: "",
  });

  const set = (k: keyof typeof draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const create = async () => {
    const { ok } = await run("POST", "/api/erp/sales-channels", draft);
    if (ok) {
      setOpen(false);
      setDraft({ name: "", platform: platforms[0]?.value ?? "", brand: "", apiUrl: "", apiKey: "", apiSecret: "", webhookSecret: "" });
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="channel-create">
      <button
        type="button"
        data-testid="channel-create-toggle"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-input px-3 py-1.5 text-sm font-medium"
      >
        {s.newChannel}
      </button>

      {/* D-06.4: rendered always, toggled with `hidden`. Mounting on click means
          the offered vocabulary only exists after JavaScript runs — unassertable
          by a contract test and unreadable to assistive tech until somebody
          clicks. */}
      <div hidden={!open} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ch-name" className="block text-xs text-muted-foreground">{s.name}</label>
          <input id="ch-name" value={draft.name} onChange={(e) => set("name", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ch-platform" className="block text-xs text-muted-foreground">{s.platform}</label>
          <select
            id="ch-platform"
            value={draft.platform}
            onChange={(e) => set("platform", e.target.value)}
            className={`mt-1 ${FIELD}`}
          >
            {platforms.map((p) => (
              // The label says when a platform has no live integration, so the
              // choice is informed rather than discovered later as a structural
              // test result.
              <option key={p.value} value={p.value}>
                {p.registered ? p.label : `${p.label} — ${s.noAdapter}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ch-brand" className="block text-xs text-muted-foreground">{s.brand}</label>
          <input id="ch-brand" value={draft.brand} onChange={(e) => set("brand", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ch-url" className="block text-xs text-muted-foreground">{s.apiUrl}</label>
          <input id="ch-url" value={draft.apiUrl} onChange={(e) => set("apiUrl", e.target.value)} className={`mt-1 ${FIELD}`} dir="ltr" />
        </div>
        <div>
          <label htmlFor="ch-key" className="block text-xs text-muted-foreground">{s.apiKey}</label>
          <input id="ch-key" type="password" autoComplete="off" value={draft.apiKey} onChange={(e) => set("apiKey", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ch-webhook-secret" className="block text-xs text-muted-foreground">{s.webhookSecret}</label>
          <input id="ch-webhook-secret" type="password" autoComplete="off" value={draft.webhookSecret} onChange={(e) => set("webhookSecret", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>

        <div className="sm:col-span-2">
          <ActionButton
            data-testid="channel-create-submit"
            pending={pending}
            pendingLabel={s.saving}
            disabled={!draft.name.trim()}
            onClick={() => void create()}
          >
            {s.create}
          </ActionButton>
        </div>
      </div>

      <ActionError message={error} />
    </section>
  );
}

interface LogRow {
  id: string;
  event: string;
  result: string;
  message: string | null;
  createdAt: string;
}

export function ChannelRowActions({
  channel,
  errors,
  s,
}: {
  readonly channel: {
    id: string;
    active: boolean;
    platform: string | null;
    webhookEndpoint: string | null;
    registered: boolean;
  };
  readonly errors: ActionErrors;
  readonly s: ChannelStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [result, setResult] = useState<{ ok: boolean; message: string; structural?: boolean } | null>(null);
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const test = async () => {
    setResult(null);
    const { ok, data } = await run("POST", `/api/erp/sales-channels/${channel.id}/test`, {});
    if (ok) {
      const r = data as { ok?: boolean; message?: string; structural?: boolean };
      setResult({ ok: Boolean(r.ok), message: r.message ?? "", structural: r.structural });
    }
  };

  const toggleLogs = async () => {
    if (logs) {
      setLogs(null);
      return;
    }
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/erp/sales-channels/${channel.id}/logs?limit=25`, {
        credentials: "same-origin",
      });
      const envelope = await res.json().catch(() => null);
      setLogs(res.ok && envelope?.success ? (envelope.data.items as LogRow[]) : []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  const setActive = async (active: boolean) => {
    if (active) await run("PUT", `/api/erp/sales-channels/${channel.id}`, { active: true, webhookEnabled: true });
    else await run("DELETE", `/api/erp/sales-channels/${channel.id}`);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="channel-row-actions">
      <div className="flex flex-wrap gap-2">
        <ActionButton
          data-testid={`channel-test-${channel.id}`}
          pending={pending}
          pendingLabel={s.testing}
          onClick={() => void test()}
        >
          {s.test}
        </ActionButton>
        <ActionButton
          data-testid={`channel-logs-${channel.id}`}
          pending={loadingLogs}
          pendingLabel={s.saving}
          onClick={() => void toggleLogs()}
        >
          {logs ? s.hideLogs : s.logs}
        </ActionButton>
        <ActionButton
          data-testid={`channel-active-${channel.id}`}
          pending={pending}
          pendingLabel={s.saving}
          variant={channel.active ? "danger" : "default"}
          onClick={() => void setActive(!channel.active)}
        >
          {channel.active ? s.deactivate : s.activate}
        </ActionButton>
      </div>

      {result && (
        <p
          data-testid={`channel-test-result-${channel.id}`}
          data-ok={result.ok}
          data-structural={result.structural ? "true" : "false"}
          className="text-xs text-muted-foreground"
        >
          {result.message}
        </p>
      )}

      {logs && (
        <ul data-testid={`channel-log-list-${channel.id}`} className="space-y-1 text-xs">
          {logs.length === 0 && <li className="text-muted-foreground">{s.noLogs}</li>}
          {logs.map((l) => (
            <li key={l.id} data-log-event={l.event} data-log-result={l.result}>
              <span className="font-mono">{l.event}</span>
              {" · "}
              {l.message}
            </li>
          ))}
        </ul>
      )}

      <ActionError message={error} />
    </div>
  );
}
