import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";

/* =============================================================================
 * A console address that leads nowhere — UI.18.
 *
 * `notFound()` is called deliberately and often in this codebase, and it is
 * load-bearing: assumption 10 is "**404, not 403, for another tenant's
 * resource** — confirming a row exists elsewhere is itself information", and
 * the sensitive screens (clients, finance, agents) answer 404 rather than 403
 * to somebody without the permission. Every one of those calls landed on the
 * framework's default page.
 *
 * So this screen has to be readable by somebody who did nothing wrong, and it
 * must not distinguish the three cases it covers — a mistyped URL, another
 * tenant's id, and a screen this person may not open. One sentence for all
 * three is the whole point; a helpful "you do not have permission to view this
 * order" would undo the property the 404 exists to hold.
 * ========================================================================== */

export default async function ConsoleNotFound() {
  const t = await getTranslations();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-6 text-center shadow-e2">
        <div
          aria-hidden="true"
          className="mx-auto flex size-11 items-center justify-center rounded-full border border-border bg-surface-subtle text-muted-foreground"
        >
          <Compass className="size-5" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-tight">{t("common.pageNotFound")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.pageNotFoundHint")}</p>

        <div className="mt-5">
          <Link href="/console" className="ui-btn ui-btn-primary tap">
            {t("common.backToConsole")}
          </Link>
        </div>
      </div>
    </main>
  );
}
