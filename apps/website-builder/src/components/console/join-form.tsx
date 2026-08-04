"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/* =============================================================================
 * The join page's accept control — Phase 7.1b.
 *
 * D-06.1: a control calls the API route. This is the client half of that — it
 * POSTs to `/api/platform/invitations/[token]/accept` and, on success, sends the
 * caller to `/console`. On refusal it redirects back with the code in the query
 * string, so the server component re-renders with the right message and the
 * state survives a refresh the way `?error=1` does on the login page.
 *
 * No optimistic UI (D-06.3): the button is busy until the redirect lands, and
 * nothing on the screen guesses at a membership until the database holds one.
 * ========================================================================== */

export function JoinForm({ token, acceptLabel }: { token: string; acceptLabel: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/platform/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // Land at the console root. If the caller was signed in, the new
        // membership is in their switcher; if not, they are sent to sign in.
        // Acceptance does NOT switch the active tenant — that is the person's
        // choice (D-07.4).
        startTransition(() => router.push("/console"));
        return;
      }
      // Carry the refusal code back so the page shows the precise message.
      const code = body?.error?.code ?? "INVITATION_NOT_FOUND";
      window.location.href = `/console/join/${encodeURIComponent(token)}?error=${encodeURIComponent(code)}`;
    } catch {
      // Network failure: re-render at the page so the generic error shows.
      window.location.href = `/console/join/${encodeURIComponent(token)}?error=INVITATION_NOT_FOUND`;
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {sending ? "…" : acceptLabel}
      </button>
    </form>
  );
}
