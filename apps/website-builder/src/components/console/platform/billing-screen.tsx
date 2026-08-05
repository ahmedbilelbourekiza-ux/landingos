"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * The billing screen — Phase 7.2.
 *
 * D-06.1: the toggles call `PUT /api/platform/billing/entitlements`. No server
 * action, no second write path. D-06.2: the write surface is rendered only when
 * the caller holds `platform:billing:write` (the page passes `canWrite`). D-06.3:
 * no optimistic UI — on success the router refreshes and the server component
 * re-renders from the subscription row.
 *
 * The whole point of the slice is visible here: flipping a product off and
 * saving is the act that drops the entitlement, and the next request anywhere
 * in that product 403s. The screen does not need to know that — it just writes
 * the row every gate already reads.
 * ========================================================================== */

export interface BillingProductRow {
  readonly id: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly entitlement: string;
  readonly enabled: boolean;
}

export interface BillingStrings {
  readonly saving: string;
  readonly save: string;
  readonly product: string;
  readonly enabled: string;
  readonly disabled: string;
  readonly enable: string;
  readonly disable: string;
  /** A display name for each product, resolved server-side from nameKey. */
  readonly names: Readonly<Record<string, string>>;
}

export function BillingScreen({
  products,
  status,
  statusLabel,
  plan,
  canWrite,
  errors,
  s,
}: {
  readonly products: readonly BillingProductRow[];
  readonly status: string;
  readonly statusLabel: string;
  readonly plan: string;
  readonly canWrite: boolean;
  readonly errors: ActionErrors;
  readonly s: BillingStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  // The entitlement set as the client holds it — updated locally only to drive
  // the toggle affordance; the authoritative read comes back from the server
  // after the PUT succeeds and the router refreshes.
  const [held, setHeld] = useState<Set<string>>(
    () => new Set(products.filter((p) => p.enabled).map((p) => p.entitlement)),
  );

  function toggle(entitlement: string, on: boolean) {
    setHeld((prev) => {
      const next = new Set(prev);
      if (on) next.add(entitlement);
      else next.delete(entitlement);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{s.product}</dt>
            <dd>{plan}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{s.enabled}</dt>
            <dd>{statusLabel}</dd>
          </div>
        </dl>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border" data-testid="billing-products">
        {products.map((p) => {
          const on = held.has(p.entitlement);
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 p-4"
              data-product-id={p.id}
              data-enabled={on ? "true" : "false"}
            >
              <div>
                <span className="font-medium">{s.names[p.id] ?? p.id}</span>
                <span
                  className="mt-0.5 block text-xs text-muted-foreground"
                  data-testid={`billing-state-${p.id}`}
                >
                  {on ? s.enabled : s.disabled}
                </span>
              </div>
              {canWrite ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(p.entitlement, e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                    data-testid={`billing-toggle-${p.id}`}
                  />
                </label>
              ) : (
                <span className="text-sm text-muted-foreground">{on ? s.enabled : s.disabled}</span>
              )}
            </li>
          );
        })}
      </ul>

      {canWrite ? (
        <ActionButton
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          onClick={() =>
            void run("PUT", "/api/platform/billing/entitlements", {
              entitlements: [...held],
            })
          }
          data-testid="billing-save"
        >
          {s.save}
        </ActionButton>
      ) : null}

      <ActionError message={error} />
    </div>
  );
}
