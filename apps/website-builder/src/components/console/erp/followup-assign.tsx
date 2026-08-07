"use client";

import { useEffect, useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import { flashEntity } from "@/components/console/row-flash";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * Moving a customer to another follow-up agent — LP.21, closing R13.
 *
 * The business case in one sentence: a supervisor cannot move a difficult
 * customer to a senior agent. LP.9 built the rule and reached it only in bulk;
 * this is the per-row control on the screen a supervisor is already looking at.
 *
 * `auto` IS ITS OWN BUTTON, not an empty option in the select. The route refuses
 * a body with neither a person nor `auto: true`, and the control matches: a
 * supervisor who meant to name somebody and left the select empty must not
 * discover the system picked for them.
 * ========================================================================== */

export interface FollowupAssignStrings {
  readonly saving: string;
  readonly assignTo: string;
  readonly assign: string;
  readonly auto: string;
  readonly unassigned: string;
}

export function FollowupAssign({
  orderId,
  current,
  members,
  errors,
  s,
}: {
  readonly orderId: string;
  readonly current: string;
  readonly members: readonly WriteOption[];
  readonly errors: ActionErrors;
  readonly s: FollowupAssignStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [choice, setChoice] = useState(current);

  const send = async (body: { userId?: string; auto?: boolean }) => {
    const { ok } = await run("POST", "/api/erp/followup/assign", { orderId, ...body });
    if (ok) flashEntity(orderId);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="followup-assign">
      <select
        aria-label={s.assignTo}
        data-testid={`followup-agent-${orderId}`}
        value={choice}
        disabled={pending}
        onChange={(e) => setChoice(e.target.value)}
        className="ui-control tap px-2 py-1 text-xs"
      >
        <option value="">{s.unassigned}</option>
        {members.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <ActionButton
        data-testid={`followup-assign-${orderId}`}
        pending={pending}
        pendingLabel={s.saving}
        disabled={!choice}
        onClick={() => void send({ userId: choice })}
      >
        {s.assign}
      </ActionButton>
      <ActionButton
        data-testid={`followup-auto-${orderId}`}
        pending={pending}
        pendingLabel={s.saving}
        onClick={() => void send({ auto: true })}
      >
        {s.auto}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}

/* =============================================================================
 * The live countdown — LP.21, closing N14.
 *
 * The legacy ticks this every 15 seconds in place. The platform rendered a
 * formatted due date and nothing moved, which on a screen whose entire subject
 * is a DEADLINE is most of the information missing: "14:20" answers nothing
 * without knowing what time it is now, and "in 3 minutes" answers it exactly.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS A CLIENT COMPONENT AND WHY THAT IS NOT A D-06.3 VIOLATION.
 *
 * It derives nothing from the server and writes nothing. `dueAt` is the server's
 * fact, passed in as an ISO string; this renders the DIFFERENCE between it and
 * the browser's clock. Server-rendering that difference would bake in the render
 * time and be wrong by however long the page has been open — which is the actual
 * defect, on a screen people leave open all day.
 *
 * THE FIRST RENDER MATCHES THE SERVER'S. `now` starts as null and the component
 * renders the absolute time until the first tick, because a hydration mismatch
 * on a timestamp is a React error in the console on every load — and because a
 * reader with JavaScript off keeps a real answer rather than an empty cell.
 *
 * FIFTEEN SECONDS, as the legacy. A per-second tick re-renders a hundred rows
 * sixty times a minute for a number whose useful resolution is a minute.
 * ========================================================================== */

const TICK_MS = 15_000;

export interface CountdownStrings {
  /** "{n}" is substituted. */
  readonly inMinutes: string;
  readonly inHours: string;
  readonly overdueBy: string;
  readonly dueNow: string;
}

export function Countdown({
  dueAt,
  absolute,
  s,
}: {
  /** ISO. The server's fact. */
  readonly dueAt: string;
  /** What the server rendered, shown until the first tick. */
  readonly absolute: string;
  readonly s: CountdownStrings;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const due = Date.parse(dueAt);
  if (now === null || Number.isNaN(due)) {
    return <span data-testid="countdown-absolute">{absolute}</span>;
  }

  const seconds = Math.round((due - now) / 1000);
  const overdue = seconds < 0;
  const minutes = Math.abs(Math.round(seconds / 60));

  const text = overdue
    ? s.overdueBy.replace("{n}", String(minutes))
    : minutes === 0
      ? s.dueNow
      : minutes < 90
        ? s.inMinutes.replace("{n}", String(minutes))
        : s.inHours.replace("{n}", String(Math.round(minutes / 60)));

  return (
    <span
      data-testid="countdown"
      data-overdue={overdue ? "true" : "false"}
      // The row's own colour is the server's (the task status); this only says
      // how long is left, so overdue is emphasis rather than a second opinion.
      className={overdue ? "font-medium text-destructive" : undefined}
      // The absolute time stays reachable: "in 3 minutes" is what to act on,
      // "14:20" is what to write on a note.
      title={absolute}
    >
      {text}
    </span>
  );
}
