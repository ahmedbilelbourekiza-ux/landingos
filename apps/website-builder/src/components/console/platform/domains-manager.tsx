"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { button } from "@/components/console/ui/styles";

/* The interactive half of the custom-domains screen — B5. Add, verify,
 * make-primary, delete; every call answers to the routes' own gates. The
 * server page re-renders the list after each action via router.refresh(). */

export interface DomainRow {
  readonly id: string;
  readonly domain: string;
  readonly verificationToken: string;
  readonly verifiedAt: string | null;
  readonly isPrimary: boolean;
}

export interface DomainStrings {
  readonly add: string;
  readonly placeholder: string;
  readonly verify: string;
  readonly verified: string;
  readonly pending: string;
  readonly makePrimary: string;
  readonly primary: string;
  readonly remove: string;
  readonly confirmRemove: string;
  readonly recordName: string;
  readonly recordValue: string;
  readonly txtHint: string;
  readonly cnameHint: string;
}

export function DomainsManager({
  rows,
  platformHost,
  s,
  errors,
}: {
  readonly rows: readonly DomainRow[];
  readonly platformHost: string;
  readonly s: DomainStrings;
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();
  const [domain, setDomain] = React.useState("");
  const [armedId, setArmedId] = React.useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;
    const { ok } = await run("POST", "/api/platform/domains", { domain: domain.trim() });
    if (ok) {
      setDomain("");
      router.refresh();
    }
  };

  const act = async (method: "POST" | "PATCH" | "DELETE", path: string) => {
    const { ok } = await run(method, path);
    if (ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="domains-manager">
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder={s.placeholder}
          dir="ltr"
          className="ui-control min-w-64 flex-1 font-mono"
          aria-label={s.placeholder}
        />
        <button type="submit" disabled={pending} className={button("primary", "md")}>
          {pending ? "…" : s.add}
        </button>
      </form>
      <ActionError message={error} />

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.id}
            data-domain={row.domain}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span dir="ltr" className="font-mono text-sm font-medium">{row.domain}</span>
              {row.isPrimary && (
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {s.primary}
                </span>
              )}
              <span
                data-verified={String(!!row.verifiedAt)}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {row.verifiedAt ? s.verified : s.pending}
              </span>
              <span className="ms-auto flex items-center gap-2">
                {!row.verifiedAt && (
                  <ActionButton
                    pending={pending}
                    pendingLabel="…"
                    size="sm"
                    variant="default"
                    onClick={() => act("POST", `/api/platform/domains/${row.id}/verify`)}
                  >
                    {s.verify}
                  </ActionButton>
                )}
                {row.verifiedAt && !row.isPrimary && (
                  <ActionButton
                    pending={pending}
                    pendingLabel="…"
                    size="sm"
                    variant="default"
                    onClick={() => act("PATCH", `/api/platform/domains/${row.id}`)}
                  >
                    {s.makePrimary}
                  </ActionButton>
                )}
                <ActionButton
                  pending={pending}
                  pendingLabel="…"
                  size="sm"
                  variant={armedId === row.id ? "danger" : "ghost"}
                  onClick={() =>
                    armedId === row.id
                      ? act("DELETE", `/api/platform/domains/${row.id}`)
                      : setArmedId(row.id)
                  }
                  onBlur={() => setArmedId(null)}
                >
                  {armedId === row.id ? s.confirmRemove : s.remove}
                </ActionButton>
              </span>
            </div>

            {!row.verifiedAt && (
              <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3 text-xs">
                <p className="text-muted-foreground">{s.txtHint}</p>
                <div className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
                  <span className="text-muted-foreground">{s.recordName}</span>
                  <code dir="ltr" className="select-all break-all">{`_landingos-verify.${row.domain}`}</code>
                  <span className="text-muted-foreground">{s.recordValue}</span>
                  <code dir="ltr" className="select-all break-all" data-testid="domain-token">
                    {row.verificationToken}
                  </code>
                </div>
                <p className="text-muted-foreground">
                  {s.cnameHint} <code dir="ltr" className="select-all">{platformHost}</code>
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
