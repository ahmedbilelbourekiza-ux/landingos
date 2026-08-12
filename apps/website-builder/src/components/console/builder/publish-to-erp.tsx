"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * Send landing pages to the Manager's catalogue — LB.21's control.
 *
 * D-06.1 — it calls the API route. The route owns the entitlement check, the
 * adoption rule and the permission; this holds none of that, which is why the
 * same rules apply to a curl.
 *
 * IT REPORTS WHAT HAPPENED, by outcome. "Published 15" would hide the thing the
 * merchant most needs to know on a second run — that nothing was duplicated —
 * and "matched to existing products" is the sentence that explains why a
 * catalogue they had already filled in by hand did not double.
 *
 * IT TRANSLATES ITSELF, unlike most console write panels, which take finished
 * `labels` from the server. Those pass STRINGS; this one needs a sentence built
 * from counts that only exist after the request, and a server component cannot
 * hand a client component a formatting FUNCTION — React refuses to serialise
 * one, which is a 500 on the whole screen rather than a warning. The catalogue
 * is already on the client (`NextIntlClientProvider` in the root layout), which
 * is the same door the editor's components have used since LB.13.
 * ========================================================================== */

export function PublishToErpPanel({ errors }: { readonly errors: ActionErrors }) {
  const t = useTranslations();
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(null);

  return (
    <section
      className="rounded-lg border border-border bg-surface-raised p-4"
      data-testid="publish-to-erp"
    >
      <p className="text-xs text-muted-foreground">{t("builder.pages.publishToErpHint")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionButton
          data-testid="publish-all-to-erp"
          pending={pending}
          pendingLabel={t("common.saving")}
          variant="default"
          onClick={async () => {
            setSummary(null);
            const { ok, data } = await run("POST", "/api/builder/publish-to-erp", {
              scope: "all",
            });
            if (!ok) return;
            const counts = data as { created: number; adopted: number; updated: number };
            setSummary(t("builder.pages.publishToErpDone", counts));
            // Nothing on THIS screen changes — the catalogue is elsewhere — but
            // the refresh keeps the list honest if a page's state moved.
            router.refresh();
          }}
        >
          {t("builder.pages.publishAllToErp")}
        </ActionButton>

        {summary && (
          <span className="text-xs text-muted-foreground" data-testid="publish-to-erp-summary">
            {summary}
          </span>
        )}
      </div>

      <ActionError message={error} />
    </section>
  );
}
