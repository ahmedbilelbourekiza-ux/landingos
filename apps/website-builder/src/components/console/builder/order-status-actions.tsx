"use client";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * The order lifecycle controls (LB.10).
 *
 * Replaces the page's server action — which was a second write path (the exact
 * shape D-06.1 exists to refuse): it re-declared VALID_TRANSITIONS, checked no
 * permission at all, and fired no webhook, so a status changed through the
 * console was invisible to every subscribed CRM while the same change through
 * the API told them. Now there is ONE door: PATCH
 * /api/builder/orders/[id]/status, gated on `website-builder:orders:write`,
 * firing order.updated / order.cancelled after commit.
 *
 * The offered transitions arrive as props, decided by the server page from the
 * same VALID_TRANSITIONS the route enforces, with labels already translated —
 * this component holds no strings and no vocabulary (D-06 rules).
 * ========================================================================== */

export function OrderStatusActions({
  orderId,
  transitions,
  errors,
}: {
  readonly orderId: string;
  readonly transitions: readonly { toStatus: string; label: string }[];
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="order-status-actions">
      <div className="flex flex-wrap gap-2">
        {transitions.map(({ toStatus, label }) => (
          <ActionButton
            key={toStatus}
            pending={pending}
            pendingLabel="…"
            data-transition={toStatus}
            onClick={() =>
              run("PATCH", `/api/builder/orders/${orderId}/status`, { toStatus })
            }
          >
            {label}
          </ActionButton>
        ))}
      </div>
      <ActionError message={error} />
    </div>
  );
}
