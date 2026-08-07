"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

/* =============================================================================
 * When a console screen throws — UI.18.
 *
 * THERE WAS NO ERROR BOUNDARY ANYWHERE IN THIS APPLICATION. A thrown error on
 * any console page produced the Next.js default error page: no shell, no
 * navigation, no way back, and in production a bare "Application error" with no
 * sentence at all.
 *
 * That is not a hypothetical. PROJECT_STATE's own *Known bugs and limitations*
 * records that the free-tier Neon connection limit "surfaces as a 500 from a
 * screen, not only as a test-harness error — check the server log for `P1001`
 * before believing a page has regressed". This is the page it surfaces as, and
 * an operator's honest reading of it was that the product had broken.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY. Not the message, not the stack, not the
 * digest as prose. A console error can carry a query fragment, a tenant id or a
 * customer's phone number, and this screen is reachable by anybody signed in.
 * The digest is rendered small and marked as a reference precisely because it
 * is the one token that is safe to read out to whoever runs the platform.
 *
 * `reset()` re-renders the segment rather than reloading the document, which is
 * what makes "try again" worth offering: the overwhelmingly common cause here
 * is a transient connection, and the second attempt usually succeeds.
 * ========================================================================== */

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    // The server log is where the cause lives; this puts the client's view of
    // it somewhere a developer with the tab open can find it.
    console.error("[console] screen error", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-6 text-center shadow-e2">
        <div
          aria-hidden="true"
          className="mx-auto flex size-11 items-center justify-center rounded-full border"
          style={{
            color: "var(--danger-fg)",
            backgroundColor: "var(--danger-bg)",
            borderColor: "var(--danger-border)",
          }}
        >
          <AlertTriangle className="size-5" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-tight">
          {t("common.somethingWentWrong")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.errorHint")}</p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={reset} className="ui-btn ui-btn-primary tap">
            {t("common.retry")}
          </button>
          <a href="/console" className="ui-btn ui-btn-default tap">
            {t("common.backToConsole")}
          </a>
        </div>

        {error.digest && (
          <p className="mt-5 font-mono text-2xs text-muted-foreground" dir="ltr">
            {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
