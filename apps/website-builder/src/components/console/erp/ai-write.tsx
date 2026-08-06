"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * Configuring the assistant — LP.17.
 *
 * A PROVIDER IS A BILLING ACCOUNT. Adding one commits the company to per-token
 * charges, which is why every control here is behind `erp:settings:write` and
 * why the key is a password field that is never read back: `apiKey` is absent
 * from the route's `select`, not masked afterwards, so a key that is never
 * loaded cannot be leaked by a logger or by a field somebody adds in six months.
 *
 * AN ASSISTANT'S PERMISSION LIST IS A REQUEST, NOT A GRANT. It is clamped per
 * CALLER at use time, so an assistant configured by a manager with
 * `read_analytics` gives an agent nothing extra. The form says so, because a
 * checkbox list that looks like a grant is how somebody talks themselves into
 * believing the assistant is a way around a permission.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface AiStrings {
  readonly saving: string;
  readonly save: string;
  readonly cancel: string;
  readonly remove: string;
  readonly addProvider: string;
  readonly name: string;
  readonly type: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly create: string;
  readonly makeDefault: string;
  readonly addAgent: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly role: string;
  readonly provider: string;
  readonly permissions: string;
  readonly permissionsHint: string;
  readonly enabled: string;
  readonly none: string;
  readonly keyKept: string;
}

export interface ProviderRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly baseUrl: string | null;
  readonly defaultModel: string | null;
  readonly active: boolean;
  readonly isDefault: boolean;
}

/* -----------------------------------------------------------------------------
 * Providers
 * -------------------------------------------------------------------------- */

export function ProviderCreatePanel({
  errors, s, types,
}: {
  readonly errors: ActionErrors;
  readonly s: AiStrings;
  /** The route's own enum, so a type it would refuse cannot be offered. */
  readonly types: readonly string[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const blank = { name: "", type: types[0] ?? "openai-compat", baseUrl: "", apiKey: "", defaultModel: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="ai-provider-panel">
      <h2 className="text-sm font-medium">{s.addProvider}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="ai-p-name" className="block text-xs text-muted-foreground">{s.name}</label>
          <input id="ai-p-name" value={f.name} onChange={(e) => set("name", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ai-p-type" className="block text-xs text-muted-foreground">{s.type}</label>
          <select id="ai-p-type" value={f.type} onChange={(e) => set("type", e.target.value)} className={`mt-1 ${FIELD}`}>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ai-p-url" className="block text-xs text-muted-foreground">{s.baseUrl}</label>
          <input id="ai-p-url" dir="ltr" value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ai-p-key" className="block text-xs text-muted-foreground">{s.apiKey}</label>
          {/* type="password" and never read back — the route does not select it. */}
          <input id="ai-p-key" type="password" autoComplete="off" dir="ltr"
            value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ai-p-model" className="block text-xs text-muted-foreground">{s.defaultModel}</label>
          <input id="ai-p-model" dir="ltr" value={f.defaultModel} onChange={(e) => set("defaultModel", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="ai-provider-create" pending={pending} pendingLabel={s.saving}
          variant="primary" disabled={!f.name.trim()}
          onClick={async () => {
            const { ok } = await run("POST", "/api/erp/ai/providers", {
              name: f.name.trim(), type: f.type,
              ...(f.baseUrl.trim() ? { baseUrl: f.baseUrl.trim() } : {}),
              ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}),
              ...(f.defaultModel.trim() ? { defaultModel: f.defaultModel.trim() } : {}),
            });
            if (ok) setF(blank);
          }}
        >
          {s.create}
        </ActionButton>
      </div>
      <ActionError message={error} />
    </section>
  );
}

export function ProviderRowActions({
  provider, errors, s,
}: {
  readonly provider: ProviderRow;
  readonly errors: ActionErrors;
  readonly s: AiStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {/* D-06.2: the route refuses a default that is not active, so the control
          that would trip it is not offered. */}
      {!provider.isDefault && provider.active && (
        <ActionButton
          data-testid="ai-provider-default" data-provider-id={provider.id}
          pending={pending} pendingLabel={s.saving}
          onClick={() => void run("POST", `/api/erp/ai/providers/${provider.id}/default`, {})}
        >
          {s.makeDefault}
        </ActionButton>
      )}
      <ActionButton
        data-testid="ai-provider-delete" data-provider-id={provider.id}
        pending={pending} pendingLabel={s.saving} variant="danger"
        onClick={() => void run("DELETE", `/api/erp/ai/providers/${provider.id}`)}
      >
        {s.remove}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Assistants
 * -------------------------------------------------------------------------- */

export function AgentCreatePanel({
  errors, s, providers, permissions, roles,
}: {
  readonly errors: ActionErrors;
  readonly s: AiStrings;
  readonly providers: readonly { id: string; name: string }[];
  /** `ALL_AI_PERMISSIONS`, from the module the route validates against. */
  readonly permissions: readonly { value: string; label: string }[];
  readonly roles: readonly string[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const blank = { name: "", description: "", providerId: "", role: roles[0] ?? "general", systemPrompt: "" };
  const [f, setF] = useState(blank);
  const [granted, setGranted] = useState<string[]>([]);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="ai-agent-panel">
      <h2 className="text-sm font-medium">{s.addAgent}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ai-a-name" className="block text-xs text-muted-foreground">{s.name}</label>
          <input id="ai-a-name" value={f.name} onChange={(e) => set("name", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ai-a-desc" className="block text-xs text-muted-foreground">{s.description}</label>
          <input id="ai-a-desc" value={f.description} onChange={(e) => set("description", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ai-a-provider" className="block text-xs text-muted-foreground">{s.provider}</label>
          <select id="ai-a-provider" value={f.providerId} onChange={(e) => set("providerId", e.target.value)} className={`mt-1 ${FIELD}`}>
            <option value="">{s.none}</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ai-a-role" className="block text-xs text-muted-foreground">{s.role}</label>
          <select id="ai-a-role" value={f.role} onChange={(e) => set("role", e.target.value)} className={`mt-1 ${FIELD}`}>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="ai-a-prompt" className="block text-xs text-muted-foreground">{s.systemPrompt}</label>
        <textarea id="ai-a-prompt" rows={3} value={f.systemPrompt}
          onChange={(e) => set("systemPrompt", e.target.value)} className={`mt-1 ${FIELD}`} />
      </div>

      <fieldset className="mt-3" data-testid="ai-agent-permissions">
        <legend className="text-xs text-muted-foreground">{s.permissions}</legend>
        {/* Said on the page: this is a request, clamped per caller at use time. */}
        <p className="mt-1 text-xs text-muted-foreground">{s.permissionsHint}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {permissions.map((p) => (
            <label key={p.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" data-permission={p.value}
                checked={granted.includes(p.value)}
                onChange={(e) =>
                  setGranted((g) => (e.target.checked ? [...g, p.value] : g.filter((x) => x !== p.value)))
                }
                className="h-4 w-4 rounded border-input"
              />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <ActionButton
          data-testid="ai-agent-create" pending={pending} pendingLabel={s.saving}
          variant="primary" disabled={!f.name.trim()}
          onClick={async () => {
            const { ok } = await run("POST", "/api/erp/ai/agents", {
              name: f.name.trim(),
              ...(f.description.trim() ? { description: f.description.trim() } : {}),
              ...(f.providerId ? { providerId: f.providerId } : {}),
              ...(f.systemPrompt.trim() ? { systemPrompt: f.systemPrompt.trim() } : {}),
              role: f.role,
              permissions: granted,
              enabled: true,
            });
            if (ok) { setF(blank); setGranted([]); }
          }}
        >
          {s.create}
        </ActionButton>
      </div>
      <ActionError message={error} />
    </section>
  );
}

export function AgentRowActions({
  agentId, enabled, errors, s,
}: {
  readonly agentId: string;
  readonly enabled: boolean;
  readonly errors: ActionErrors;
  readonly s: AiStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ActionButton
        data-testid="ai-agent-toggle" data-agent-id={agentId}
        pending={pending} pendingLabel={s.saving}
        onClick={() => void run("PUT", `/api/erp/ai/agents/${agentId}`, { enabled: !enabled })}
      >
        {enabled ? s.cancel : s.enabled}
      </ActionButton>
      <ActionButton
        data-testid="ai-agent-delete" data-agent-id={agentId}
        pending={pending} pendingLabel={s.saving} variant="danger"
        onClick={() => void run("DELETE", `/api/erp/ai/agents/${agentId}`)}
      >
        {s.remove}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}
