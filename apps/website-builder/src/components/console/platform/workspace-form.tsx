"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { button } from "@/components/console/ui/styles";

/* The workspace-defaults form — B9. One PATCH to /api/platform/workspace;
 * the slug is displayed, immutable, beside the fields that move. */

export interface WorkspaceValues {
  readonly name: string;
  readonly locale: string;
  readonly currency: string;
  readonly timezone: string;
}

export function WorkspaceForm({
  slug,
  initial,
  locales,
  currencies,
  timezones,
  s,
  errors,
}: {
  readonly slug: string;
  readonly initial: WorkspaceValues;
  readonly locales: readonly { value: string; label: string }[];
  readonly currencies: readonly string[];
  readonly timezones: readonly string[];
  readonly s: {
    name: string; slug: string; slugHint: string; locale: string;
    currency: string; timezone: string; save: string; saved: string;
  };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();
  const [values, setValues] = React.useState<WorkspaceValues>(initial);
  const [saved, setSaved] = React.useState(false);

  const set = (key: keyof WorkspaceValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { ok } = await run("PATCH", "/api/platform/workspace", values);
    if (ok) {
      setSaved(true);
      router.refresh();
    }
  };

  return (
    <form
      onSubmit={submit}
      data-testid="workspace-form"
      className="grid max-w-2xl gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2"
    >
      <div className="space-y-1">
        <label htmlFor="ws-name" className="ui-label">{s.name}</label>
        <input
          id="ws-name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          required
          maxLength={120}
          className="ui-control tap w-full"
        />
      </div>

      <div className="space-y-1">
        <span className="ui-label">{s.slug}</span>
        <p dir="ltr" className="ui-control flex items-center bg-muted/40 font-mono text-muted-foreground">
          /{slug}
        </p>
        <p className="text-[11px] text-muted-foreground">{s.slugHint}</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="ws-locale" className="ui-label">{s.locale}</label>
        <select
          id="ws-locale"
          value={values.locale}
          onChange={(e) => set("locale", e.target.value)}
          className="ui-control tap w-full"
        >
          {locales.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="ws-currency" className="ui-label">{s.currency}</label>
        <select
          id="ws-currency"
          value={values.currency}
          onChange={(e) => set("currency", e.target.value)}
          className="ui-control tap w-full"
        >
          {currencies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="ws-timezone" className="ui-label">{s.timezone}</label>
        <select
          id="ws-timezone"
          value={values.timezone}
          onChange={(e) => set("timezone", e.target.value)}
          className="ui-control tap w-full"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={button("primary", "md")}>
          {pending ? "…" : s.save}
        </button>
        {saved && (
          <span role="status" data-testid="workspace-saved" className="text-sm text-muted-foreground">
            {s.saved}
          </span>
        )}
        <ActionError message={error} />
      </div>
    </form>
  );
}
