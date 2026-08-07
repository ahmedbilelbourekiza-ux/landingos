"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";

import { toneVars } from "@landingos/ui";
import { button, type ButtonSize, type ButtonVariant } from "./ui/styles";
import { ACTION_OK_EVENT } from "./action-feedback";

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

  /**
   * `data` comes back because some routes answer with something a person needs
   * to read — `orders/bulk` reports per id, so forty-nine of fifty succeeding
   * is a result, not a failure, and the caller has to be told which one did not.
   */
  const run = useCallback(
    async (
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ ok: boolean; data: unknown }> => {
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
          return { ok: false, data: null };
        }

        /* UI.24 — say that it worked, once, from one place.
         *
         * Dispatched rather than returned, because every write panel in this
         * console calls this hook and there are more than twenty of them:
         * threading a flag through each would be twenty edits a twenty-first
         * panel would forget. `ActionFeedback` in the shell listens.
         *
         * This is not optimistic UI (D-06.3). It fires after the API answered
         * SUCCESS, so it reports what the server said — the refresh below is
         * still what puts the truth on screen. */
        window.dispatchEvent(new CustomEvent(ACTION_OK_EVENT));

        startTransition(() => router.refresh());
        return { ok: true, data: envelope.data };
      } catch {
        setError(errors.NETWORK ?? errors[FALLBACK]);
        return { ok: false, data: null };
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
      className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
      style={toneVars("danger")}
    >
      {/* The tone is already carried by colour AND by the sentence; the icon is
          the third channel, for a reader who has neither. */}
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
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
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pending: boolean;
  pendingLabel: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type="button"
      disabled={pending || rest.disabled}
      // `aria-busy` is what tells a screen reader the control is working. The
      // label swap says it to everybody else and says nothing to them.
      aria-busy={pending || undefined}
      className={button(variant, size, className)}
      {...rest}
    >
      {/* UI.14 — the spinner, and why the label still changes.
       *
       * Swapping the label for "Saving…" was the only busy signal, and it
       * changes the button's WIDTH mid-action, so a row of controls reflows
       * under the pointer that just pressed one. The mark is fixed-width and
       * sits before the text; the text still changes, because "Saving…" is
       * information and a spinner alone is only "wait". */}
      {pending && (
        <Loader2 aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin" />
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}
