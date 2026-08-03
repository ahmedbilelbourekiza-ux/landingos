"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { toneVars } from "@landingos/ui";

/* =============================================================================
 * The console's write primitive — Phase 6.3.
 *
 * D-06.1. A CONTROL CALLS THE API ROUTE. IT DOES NOT GET ITS OWN WRITE PATH.
 *
 * Every mutation Phase 6.3 puts on screen already has a route behind it and a
 * contract test in front of it — 266 of them. A server action would be a SECOND
 * write path, and a second write path needs its own copy of the permission gate,
 * the ownership guard and the validation. The read screens deliberately avoided
 * that by calling `mayTouchOrder` and `orderScope` rather than reimplementing
 * them; this is the same rule for writes, and it is stronger, because here the
 * copy would not merely drift, it would be the part nobody tested.
 *
 * The cost is stated: these controls need JavaScript, where the rest of the
 * console does not. That is the trade NEXT_STEPS predicted, and it buys a write
 * surface that adds no authorization code at all.
 *
 * D-06.3. NO OPTIMISTIC UI.
 *
 * A confirmed call is money — it moves an order's status, it is what an agent is
 * paid per, and it is what the suspicious-call flag exists to watch. So nothing
 * here guesses. On success the router refreshes and the server component
 * re-renders with what the database actually holds; `pending` stays true until
 * that arrives, which is why `useTransition` wraps the refresh rather than
 * fire-and-forget. The control is busy until the screen tells the truth again.
 * ========================================================================== */

import type { ActionErrors } from "@/lib/console/action-errors";
import { FALLBACK } from "@/lib/console/action-errors";

export function useApiAction(errors: ActionErrors) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  const run = useCallback(
    async (method: string, path: string, body?: unknown): Promise<boolean> => {
      setSending(true);
      setError(null);
      try {
        const res = await fetch(path, {
          method,
          // Same-origin by construction — `path` is relative, so the platform
          // session cookie travels and nothing else does.
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        const envelope = await res.json().catch(() => null);
        if (!res.ok || !envelope?.success) {
          // A refusal with no parseable envelope is still a refusal. Reading
          // `res.ok` as success would turn a 500 into a silent no-op, which is
          // the failure mode this whole file exists to avoid.
          const code = String(envelope?.error?.code ?? "");
          setError(errors[code] ?? errors[FALLBACK]);
          return false;
        }

        startTransition(() => router.refresh());
        return true;
      } catch {
        setError(errors.NETWORK ?? errors[FALLBACK]);
        return false;
      } finally {
        setSending(false);
      }
    },
    [errors, router],
  );

  return { run, pending: sending || refreshing, error, clearError: () => setError(null) };
}

/** The refusal, said once, where the person clicked. */
export function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      data-testid="action-error"
      className="mt-3 rounded-md border px-3 py-2 text-sm"
      style={toneVars("danger")}
    >
      {message}
    </p>
  );
}

/**
 * A button that cannot be pressed twice.
 *
 * Disabled while anything on the panel is in flight, because two of these
 * routes are not idempotent: a second `POST /call` is a second attempt in the
 * history and a second row in the agent's payroll.
 */
export function ActionButton({
  children,
  pending,
  pendingLabel,
  variant = "default",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pending: boolean;
  pendingLabel: string;
  variant?: "default" | "primary" | "danger";
}) {
  const styles =
    variant === "primary"
      ? "bg-primary text-primary-foreground"
      : variant === "danger"
        ? "border"
        : "border border-input";

  return (
    <button
      type="button"
      disabled={pending || rest.disabled}
      style={variant === "danger" ? toneVars("danger") : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles}`}
      {...rest}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
