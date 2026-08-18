"use client";

import { Sparkles } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * "Analyze this page" — BH.3's one control (on-demand only; there is no
 * scheduled analysis anywhere, by design).
 *
 * A refresh, not a client render of the result: the recommendations the POST
 * returns are the same rows the screen's server pass reads, and useApiAction
 * already refreshes on success — so this component renders nothing of the
 * answer itself. A cached answer (inside the cooldown) refreshes to the same
 * content — harmless, free, no special case.
 * ========================================================================== */

export function AnalyzePageButton({
  landingPageId,
  labels,
  errors,
}: {
  readonly landingPageId: string;
  readonly labels: { analyze: string; analyzing: string };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);

  const onAnalyze = () => run("POST", `/api/builder/landings/${landingPageId}/analyze`, {});

  return (
    <div className="space-y-2">
      <ActionButton
        type="button"
        onClick={onAnalyze}
        pending={pending}
        pendingLabel={labels.analyzing}
        data-testid={`analyze-page-${landingPageId}`}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        {labels.analyze}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}
