"use client";

import { Unplug } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * Disconnect — the exit door SEC.9 built and forgot to hang on the wall.
 *
 * `DELETE /ad-accounts/[id]` shipped 22 Aug, manage-gated and route-tested,
 * and the deploy's own verification pass found that NOTHING called it: a grep
 * for `ad-accounts` returned the connect POST and the refresh POST. Revoking a
 * stored credential was still an API act — the LB.23b reachability defect
 * shape, at the exit instead of the entrance. This is the button.
 *
 * `window.confirm`, the LB.38 destructive-act pattern, and the confirm text
 * says the COST out loud: the route's cascade takes the pulled spend history
 * with the account (stated in the route header, restated to the person about
 * to press). Re-connecting re-pulls the window on demand, so the loss is
 * recoverable — but only Meta's copy makes it so, and the sentence lets the
 * operator decide with that in hand.
 *
 * Renders none of the answer: on success `useApiAction` refreshes and the
 * screen's server pass re-renders into the `unconfigured` state, which is the
 * truth — the panel with the connect form open is the next thing they see.
 * ========================================================================== */

export function DisconnectAdAccountButton({
  adAccountId,
  labels,
  errors,
}: {
  readonly adAccountId: string;
  readonly labels: { disconnect: string; disconnecting: string; confirm: string };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);

  const onDisconnect = () => {
    if (!window.confirm(labels.confirm)) return;
    void run("DELETE", `/api/platform/integrations/ad-accounts/${adAccountId}`);
  };

  return (
    <div className="space-y-2">
      <ActionButton
        type="button"
        variant="ghost"
        onClick={onDisconnect}
        pending={pending}
        pendingLabel={labels.disconnecting}
        data-testid="disconnect-ad-account"
      >
        <Unplug className="h-4 w-4" aria-hidden />
        {labels.disconnect}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}
