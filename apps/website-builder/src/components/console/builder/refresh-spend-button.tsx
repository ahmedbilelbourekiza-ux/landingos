"use client";

import { RefreshCw } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * "Refresh spend" — LB.23's one control.
 *
 * On demand only, exactly like AnalyzePageButton: nothing anywhere schedules a
 * spend pull, and pretending otherwise on the screen would be worse than the
 * merchant knowing they are the trigger.
 *
 * It renders nothing of the answer. The POST upserts the same rows the
 * screen's server pass reads, and `useApiAction` refreshes on success, so the
 * new totals arrive through the ordinary render — there is no second copy of
 * the arithmetic living in the client.
 *
 * The window it asks for is the window being LOOKED AT, so "refresh" means
 * what it says on the screen it sits on rather than some other period.
 * ========================================================================== */

export function RefreshSpendButton({
  adAccountId,
  days,
  labels,
  errors,
}: {
  readonly adAccountId: string;
  readonly days: number;
  readonly labels: { refresh: string; refreshing: string };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);

  const onRefresh = () =>
    run("POST", `/api/platform/integrations/ad-accounts/${adAccountId}/refresh`, { days });

  return (
    <div className="space-y-2">
      <ActionButton
        type="button"
        onClick={onRefresh}
        pending={pending}
        pendingLabel={labels.refreshing}
        data-testid="refresh-spend"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {labels.refresh}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}
