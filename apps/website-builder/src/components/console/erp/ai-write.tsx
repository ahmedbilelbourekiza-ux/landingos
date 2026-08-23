"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * Configuring the assistants — LP.17, narrowed by PF.1.
 *
 * PROVIDERS ARE NOT CONFIGURED HERE ANY MORE. The model credential is the
 * OPERATOR's — one platform-wide PlatformCredential row installed by an
 * attended script (`lib/platform/platform-ai.ts`) — so the provider panel,
 * its key field and its five routes are gone: a tenant neither sees nor
 * supplies an AI key. What remains tenant-owned is the ASSISTANTS, which are
 * prompts and permission requests, not credentials.
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
  readonly cancel: string;
  readonly remove: string;
  readonly name: string;
  readonly create: string;
  readonly addAgent: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly role: string;
  readonly permissions: string;
  readonly permissionsHint: string;
  readonly enabled: string;
}

/* -----------------------------------------------------------------------------
 * Assistants
 * -------------------------------------------------------------------------- */

export function AgentCreatePanel({
  errors, s, permissions, roles,
}: {
  readonly errors: ActionErrors;
  readonly s: AiStrings;
  /** `ALL_AI_PERMISSIONS`, from the module the route validates against. */
  readonly permissions: readonly { value: string; label: string }[];
  readonly roles: readonly string[];
}) {
  const { run, pending, error } = useApiAction(errors);
  // No provider select since PF.1: every assistant runs on the platform's
  // provider, so there is nothing for `providerId` to choose between.
  const blank = { name: "", description: "", role: roles[0] ?? "general", systemPrompt: "" };
  const [f, setF] = useState(blank);
  const [granted, setGranted] = useState<string[]>([]);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="ai-agent-panel">
      <h2 className="text-sm font-semibold tracking-tight">{s.addAgent}</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ai-a-name" className="ui-label block">{s.name}</label>
          <input id="ai-a-name" value={f.name} onChange={(e) => set("name", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ai-a-desc" className="ui-label block">{s.description}</label>
          <input id="ai-a-desc" value={f.description} onChange={(e) => set("description", e.target.value)} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="ai-a-role" className="ui-label block">{s.role}</label>
          <select id="ai-a-role" value={f.role} onChange={(e) => set("role", e.target.value)} className={`mt-1 ${FIELD}`}>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="ai-a-prompt" className="ui-label block">{s.systemPrompt}</label>
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
