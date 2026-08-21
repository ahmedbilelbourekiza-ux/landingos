"use client";

import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * LB.23c — the field the token is actually pasted into.
 *
 * THE GAP THIS CLOSES: LB.23b built the intake route and verified it with
 * direct API calls, and called that "end to end". It was not. No form anywhere
 * in the console called it, so the panel could say "no advertising account is
 * connected" and offer nothing whatsoever to fix that — a dead end reachable
 * only by someone with database access. Reported by the operator, who went
 * looking for the field and correctly found nothing.
 *
 * It follows `platform/tracking-write.tsx` exactly, because that component is
 * this console's answer to "type a secret into a form":
 *   - labels arrive as PROPS (LB.42): the server translates once and hands the
 *     result down, so a write control never depends on messages being
 *     available client-side;
 *   - the body is rendered always and toggled with `hidden` (D-06.4);
 *   - the secret is write-only — typed here, encrypted at rest by the route,
 *     and never shown again;
 *   - the control calls the platform API route and renders none of the answer.
 *
 * The token field is OPTIONAL on submit. The route keeps the stored token when
 * one is not supplied, so this same form is both "connect" and "rename", and a
 * blank token cannot silently disconnect a working account.
 * ========================================================================== */

const BASE = "/api/platform/integrations/ad-accounts";

export interface ConnectAdAccountLabels {
  readonly connect: string;
  readonly accountId: string;
  readonly accountIdHint: string;
  readonly name: string;
  readonly currency: string;
  readonly token: string;
  readonly tokenHint: string;
  readonly save: string;
  readonly saving: string;
}

export function ConnectAdAccountPanel({
  errors,
  labels,
  defaultOpen = false,
  existing,
}: {
  readonly errors: ActionErrors;
  readonly labels: ConnectAdAccountLabels;
  /** Open by default when there is nothing connected — the merchant is here
   *  to fix exactly that, and a collapsed panel would hide the only remedy. */
  readonly defaultOpen?: boolean;
  readonly existing?: { readonly accountId: string; readonly name: string; readonly currency: string };
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = React.useState(defaultOpen);
  const [accountId, setAccountId] = React.useState(existing?.accountId ?? "");
  const [name, setName] = React.useState(existing?.name ?? "");
  const [currency, setCurrency] = React.useState(existing?.currency ?? "USD");
  const [token, setToken] = React.useState("");

  const submit = async () => {
    const { ok } = await run("POST", BASE, {
      provider: "meta",
      accountId: accountId.trim(),
      name: name.trim(),
      currency: currency.trim().toUpperCase(),
      // Omitted rather than sent empty: the route treats absence as "keep the
      // stored one", and an empty string would be a validation failure.
      accessToken: token.trim() || undefined,
      isActive: true,
    });
    if (ok) {
      // The token is cleared on success and never re-rendered — it is
      // write-only, and leaving it in a field invites a second submit.
      setToken("");
      setOpen(false);
    }
  };

  const input = "w-full rounded-md border border-border bg-background px-3 py-2";

  return (
    <section className="mt-2 rounded-lg border border-border" data-testid="connect-ad-account">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <Plus aria-hidden className="size-4" /> {labels.connect}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Rendered always, toggled with hidden (D-06.4). */}
      <div hidden={!open} className="border-t border-border px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {labels.accountId} <span aria-hidden>*</span> — {labels.accountIdHint}
            </span>
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              dir="ltr"
              inputMode="numeric"
              className={`${input} font-mono text-xs`}
              data-testid="ad-account-id"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {labels.name} <span aria-hidden>*</span>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
              data-testid="ad-account-name"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{labels.currency}</span>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              dir="ltr"
              maxLength={3}
              className={`${input} font-mono text-xs uppercase`}
              data-testid="ad-account-currency"
            />
          </label>

          {/* The whole point of this component. `type="password"` so a pasted
              credential is not shoulder-surfed or captured in a screenshot;
              autoComplete off so no browser offers to remember it. */}
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{labels.token}</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className={`${input} font-mono text-xs`}
              data-testid="ad-account-token"
            />
            <span className="mt-1 block text-xs text-muted-foreground">{labels.tokenHint}</span>
          </label>
        </div>

        <div className="mt-4 space-y-2">
          <ActionButton
            type="button"
            onClick={submit}
            pending={pending}
            pendingLabel={labels.saving}
            data-testid="ad-account-save"
          >
            {labels.save}
          </ActionButton>
          <ActionError message={error} />
        </div>
      </div>
    </section>
  );
}
