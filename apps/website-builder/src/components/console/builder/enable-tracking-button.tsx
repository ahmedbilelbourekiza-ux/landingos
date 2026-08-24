"use client";

import { Activity } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * TS.3 / D2 — "Turn on behavior tracking", per page, from the Traffic screen.
 *
 * The opt-in itself is unchanged: per page, default off, server-enforced at
 * the beacon (the §BH decision). What changes is WHERE the merchant can flip
 * it on — the toggle lived only in the editor's Display section, which is how
 * a deployed feature sat invisible for a month (the TS.1 finding). This
 * button PATCHes the same order-form route the editor's toggle saves through,
 * so there is one write path and one permission (`pages:write`).
 *
 * ONE-WAY by design: it turns tracking ON. Turning it off is a considered
 * act that belongs with the rest of the page's display settings in the
 * editor — the gap this closes is the enable gap, not the manage surface.
 * ========================================================================== */

export function EnableTrackingButton({
  landingPageId,
  labels,
  errors,
}: {
  readonly landingPageId: string;
  readonly labels: { enable: string; enabling: string };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);

  const onEnable = () =>
    run("PATCH", `/api/builder/landings/${landingPageId}/order-form`, {
      behaviorTracking: true,
    });

  return (
    <div className="space-y-2">
      <ActionButton
        type="button"
        onClick={onEnable}
        pending={pending}
        pendingLabel={labels.enabling}
        data-testid={`enable-tracking-${landingPageId}`}
      >
        <Activity className="h-4 w-4" aria-hidden />
        {labels.enable}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}
