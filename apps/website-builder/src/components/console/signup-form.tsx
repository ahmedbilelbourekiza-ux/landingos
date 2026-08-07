"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* =============================================================================
 * The signup form — Phase 7.3.
 *
 * Calls `POST /api/platform/signup` and, on success, navigates to `/console` —
 * the route already set the session cookie, so the console opens signed in as
 * the new owner. On a refusal it shows the precise message, mapping the route's
 * error codes to the translated strings the page passed in.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface SignupLabels {
  readonly companyName: string;
  readonly slug: string;
  readonly slugHint: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly submit: string;
  readonly haveAccount: string;
  readonly signIn: string;
  readonly reservedSlug: string;
  readonly slugTaken: string;
  readonly emailTaken: string;
  readonly invalidSlug: string;
}

export function SignupForm({ labels }: { labels: SignupLabels }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeToMessage = (code: string): string =>
    code === "RESERVED_SLUG"
      ? labels.reservedSlug
      : code === "SLUG_TAKEN"
        ? labels.slugTaken
        : code === "EMAIL_TAKEN"
          ? labels.emailTaken
          : code === "INVALID_INPUT" && error === null
            ? labels.invalidSlug
            : labels.invalidSlug;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/platform/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: String(form.get("slug") ?? ""),
          companyName: String(form.get("companyName") ?? ""),
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // The route set the session cookie; navigate to the console.
        router.push("/console");
        return;
      }
      setError(codeToMessage(String(body?.error?.code ?? "")));
    } catch {
      setError(labels.invalidSlug);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--danger-fg)",
            backgroundColor: "var(--danger-bg)",
            borderColor: "var(--danger-border)",
          }}
        >
          {error}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="companyName" className="ui-label">{labels.companyName}</label>
        <input id="companyName" name="companyName" type="text" required className={FIELD} />
      </div>

      <div className="space-y-1">
        <label htmlFor="slug" className="ui-label">{labels.slug}</label>
        <input id="slug" name="slug" type="text" required dir="ltr" placeholder="my-shop" className={FIELD} />
        <p className="text-xs text-muted-foreground">{labels.slugHint}</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="name" className="ui-label">{labels.name}</label>
        <input id="name" name="name" type="text" required className={FIELD} />
      </div>

      <div className="space-y-1">
        <label htmlFor="email" className="ui-label">{labels.email}</label>
        <input id="email" name="email" type="email" required autoComplete="username" dir="ltr" className={FIELD} />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="ui-label">{labels.password}</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={FIELD} />
      </div>

      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {sending ? "…" : labels.submit}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        {labels.haveAccount}{" "}
        <Link href="/console/login" className="font-medium text-primary hover:underline">
          {labels.signIn}
        </Link>
      </p>
    </form>
  );
}
