"use client";

import { useEffect, useState } from "react";

import { useApiAction } from "@/components/console/api-action";
import { flashEntity } from "@/components/console/row-flash";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * Inline row actions — LP.8, closing N9.
 *
 * The legacy list and board both carry, ON THE ROW: a status select, an agent
 * select, a carrier select and an express toggle. Four changes without leaving
 * the list. The platform had none of them — every one of those four required
 * opening the order, changing it, and coming back, and the two most frequent
 * operations in a COD call centre are exactly "move this to confirmed" and "give
 * this to that agent". §6.1 measured the difference and it is not close.
 *
 * -----------------------------------------------------------------------------
 * D-06.1 — EACH CONTROL CALLS `PATCH /api/erp/orders/[id]`.
 *
 * The same route the detail screen's edit panel calls, and therefore the same
 * permission gate, the same `loadOwnedOrder` ownership guard, the same
 * `buildPatch` allow-list, the same audit row, and — the part that matters most
 * — the same confirm/cancel side effects. A status moved to `confirmed` from
 * this select reserves stock, books a parcel and raises a follow-up task,
 * because it goes through the door that does all of that. The ERP's own comment
 * on its list dropdown says why: two doors into `confirmed` that do different
 * things diverge, and the difference surfaces in whichever one is used less.
 *
 * D-06.2 — WHICH CONTROLS EXIST IS DECIDED BY THE SAME PREDICATES THE ROUTE USES.
 *
 *   - `status` and `expressDelivery` are `AGENT_WRITABLE`, so they are offered
 *     to anyone holding `erp:orders:write` for whom `mayTouchOrder` is true.
 *   - `agentUserId` is a REASSIGNMENT field: `buildPatch` answers 403
 *     `FORBIDDEN_FIELD` for a non-manager, so it is offered only where
 *     `seesWholeBook` holds. The page passes `members` as `undefined` otherwise
 *     and the select is not rendered — never a control whose only outcome is a
 *     refusal.
 *   - `carrierCode` is `MANAGER_WRITABLE` — same rule, same source of truth.
 *
 * D-06.3 — NO OPTIMISTIC UI, WITH ONE HONEST EXCEPTION.
 *
 * `draft` exists only so the select does not visually snap back to the old value
 * for the length of the request. It is display state and nothing is derived from
 * it: the row's badges, its total and its status pill all come from the server
 * re-render, and a refusal resets `draft` to the stored value rather than
 * leaving the browser showing a change that did not happen.
 * ========================================================================== */

export interface RowActionStrings {
  readonly saving: string;
  readonly status: string;
  readonly agent: string;
  readonly carrier: string;
  readonly noAgent: string;
  readonly noCarrier: string;
  readonly express: string;
  readonly quickActions: string;
}

const SELECT =
  "w-full max-w-[10rem] rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50";

export function OrderRowActions({
  orderId,
  errors,
  s,
  status,
  statuses,
  agentUserId,
  members,
  carrierCode,
  carriers,
  express,
  mayWrite,
}: {
  readonly orderId: string;
  readonly errors: ActionErrors;
  readonly s: RowActionStrings;
  readonly status: string;
  readonly statuses: readonly WriteOption[];
  readonly agentUserId: string;
  /** Absent when the caller may not reassign — the route would answer 403. */
  readonly members?: readonly WriteOption[];
  readonly carrierCode: string;
  /** Absent when the caller may not set a carrier. */
  readonly carriers?: readonly WriteOption[];
  readonly express: boolean;
  /** `mayTouchOrder` for THIS row, computed on the server with the same
   *  function `loadOwnedOrder` uses. */
  readonly mayWrite: boolean;
}) {
  const { run, pending, error } = useApiAction(errors);

  // Display state. Follows the server whenever the server's value moves, which
  // is what makes a refusal — or a change made in another tab — correct itself.
  const [draft, setDraft] = useState({ status, agentUserId, carrierCode, express });
  useEffect(() => {
    setDraft({ status, agentUserId, carrierCode, express });
  }, [status, agentUserId, carrierCode, express]);

  if (!mayWrite) return null;

  const patch = async (field: string, value: string | boolean) => {
    setDraft((d) => ({ ...d, [field]: value }));
    const { ok } = await run("PATCH", `/api/erp/orders/${orderId}`, {
      // `agentUserId: ""` means UNASSIGN and must reach the route as a value,
      // not be dropped: `buildPatch` maps it to null, and omitting it would
      // silently turn "take this off Amina" into a no-op.
      [field]: value,
    });
    if (ok) flashEntity(orderId);
    // The reset is not cosmetic. Without it the select keeps showing a status
    // the database refused, and the next person to read the screen believes it.
    else setDraft({ status, agentUserId, carrierCode, express });
  };

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="order-row-actions"
      /* NOT `data-order-id`. That attribute is how the paging tests count rows
       * (`body.match(/data-order-id="/g)`), and emitting a second one per row
       * doubled every count on the order list — 100 rows on a page of 50. The
       * row it belongs to already carries it; a control inside that row does
       * not need its own copy. */
      data-row-order={orderId}
      role="group"
      aria-label={s.quickActions}
    >
      <select
        aria-label={s.status}
        data-testid="row-status"
        value={draft.status}
        disabled={pending}
        onChange={(e) => void patch("status", e.target.value)}
        className={SELECT}
      >
        {statuses.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {members && (
        <select
          aria-label={s.agent}
          data-testid="row-agent"
          value={draft.agentUserId}
          disabled={pending}
          onChange={(e) => void patch("agentUserId", e.target.value)}
          className={SELECT}
        >
          <option value="">{s.noAgent}</option>
          {members.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      )}

      {carriers && (
        <select
          aria-label={s.carrier}
          data-testid="row-carrier"
          value={draft.carrierCode}
          disabled={pending}
          onChange={(e) => void patch("carrierCode", e.target.value)}
          className={SELECT}
        >
          <option value="">{s.noCarrier}</option>
          {carriers.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          data-testid="row-express"
          checked={draft.express}
          disabled={pending}
          onChange={(e) => void patch("expressDelivery", e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input"
        />
        {s.express}
      </label>

      {pending && <span className="text-xs text-muted-foreground">{s.saving}</span>}
      {/* Said on the row, not at the top of the page. A refusal for order 37 in
          a banner above fifty rows names no order at all. */}
      {error && (
        <span role="alert" data-testid="row-action-error" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
