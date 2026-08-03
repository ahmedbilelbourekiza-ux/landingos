"use client";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/**
 * Mark a follow-up task done — Phase 6.4c.
 *
 * The agent has rung the customer and sorted out whatever the carrier reported.
 * Pressing this asserts that, which is why the route guards whose task it is and
 * why this control is only rendered for tasks the caller can actually resolve —
 * the page applies the same scope the route does.
 */
export function FollowupResolve({
  taskId,
  errors,
  label,
  saving,
}: {
  readonly taskId: string;
  readonly errors: ActionErrors;
  readonly label: string;
  readonly saving: string;
}) {
  const { run, pending, error } = useApiAction(errors);

  return (
    <>
      <ActionButton
        data-testid="followup-resolve"
        data-followup-id={taskId}
        pending={pending}
        pendingLabel={saving}
        onClick={() => void run("POST", `/api/erp/followup/tasks/${taskId}/resolve`)}
      >
        {label}
      </ActionButton>
      <ActionError message={error} />
    </>
  );
}
