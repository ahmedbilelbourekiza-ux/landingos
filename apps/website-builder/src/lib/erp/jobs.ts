import "server-only";

import type { TenantDb } from "@landingos/db";

import { readSettings, type ErpSettings } from "./settings";
import { ACTIVE_STATUSES } from "./orders";
import { readAgentConfig, writeAgentConfig } from "./agents";
import { FOLLOWUP_TASK_TYPE } from "./followup";

/* =============================================================================
 * The scheduled work — M-15.
 *
 * The ERP ran these on two `setInterval`s inside its web process. That is what
 * M-15 exists to undo: on a scaled deployment an in-process timer runs once per
 * instance, so every miss is counted as many times as there are instances.
 *
 * SO THE RULE HERE IS IDEMPOTENCE, NOT SCHEDULING. Every job below is written so
 * that running it twice — or on three instances at the same moment — produces
 * the same result as running it once, and each is driven twice by a test that
 * asserts the second pass changes nothing. That is a stronger property than a
 * lock: it needs no coordination, survives a crash mid-run, and cannot be
 * defeated by a deployment topology nobody told it about.
 *
 * The mechanism is always a COLUMN GUARD — `status: "open"`, `overdueFlaggedAt:
 * null` — matched in the same statement that writes. A second pass matches
 * nothing because the first pass changed what it was matching on.
 *
 * BUG-01 IS WHY THIS FILE IS TESTED THE WAY IT IS. The ERP's sweep threw
 * `ReferenceError` on its first candidate of every run; `setInterval` caught and
 * logged it, so there was no symptom, and everything downstream of that line —
 * the missed-order counter, the unassigned queue, auto-reassign, auto-suspend —
 * had never executed in production. A job that fails silently is worse than one
 * that does not exist.
 *
 * Each function takes a db already bound to ONE tenant and that tenant's own
 * settings. There is no cross-tenant query anywhere here: the caller iterates.
 * ========================================================================== */

export const JOBS = ["followup-escalation", "overdue-sweep"] as const;
export type JobName = (typeof JOBS)[number];

export interface JobResult {
  readonly job: JobName;
  readonly [key: string]: unknown;
}

/* -----------------------------------------------------------------------------
 * Follow-up escalation
 * -------------------------------------------------------------------------- */

/**
 * Open tasks whose countdown has expired become `overdue`.
 *
 * One `updateMany`, which is what makes it safe to schedule: the `status:
 * "open"` in the WHERE is the guard, so a second pass — or a second instance
 * running concurrently — matches nothing, because the first already moved them.
 *
 * A RESOLVED TASK IS NEVER ESCALATED, however long ago it was due. Escalation
 * means "nobody did this"; somebody did.
 */
export async function escalateFollowups(db: TenantDb): Promise<JobResult> {
  const { count } = await db.followupTask.updateMany({
    where: {
      status: "open",
      type: FOLLOWUP_TASK_TYPE,
      dueAt: { lt: new Date() },
    },
    data: { status: "overdue" },
  });

  return { job: "followup-escalation", escalated: count };
}

/* -----------------------------------------------------------------------------
 * The overdue order sweep
 * -------------------------------------------------------------------------- */

/**
 * Is the clock inside the tenant's working hours?
 *
 * The ERP gated the whole sweep on this: an order arriving at 23:00 must not be
 * counted against an agent who is not working, and `nightGraceMinutes` exists so
 * the overnight backlog is not all flagged the instant the day starts.
 *
 * An impossible window used to fail open and log — the sweep then matched no
 * hour at all and the accountability system quietly stopped. It cannot arrive
 * impossible any more: `crossFieldError` refuses `workHoursEnd <= workHoursStart`
 * at the settings edge, against the MERGED result.
 */
function withinWorkingHours(settings: ErpSettings, now = new Date()): boolean {
  const start = Number(settings.workHoursStart);
  const end = Number(settings.workHoursEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  const hour = now.getHours();
  return hour >= start && hour < end;
}

/**
 * Flag orders nobody has called, count the miss against the agent, and suspend
 * on repeat if the tenant has asked for it.
 *
 * `overdueFlaggedAt: null` is the guard, and it is why the counter moves exactly
 * once per order rather than once per pass. The ERP's own test called this
 * "single-counting per timeout"; it is the property BUG-01 destroyed.
 *
 * AUTO-SUSPEND IS OFF BY DEFAULT AND STAYS OFF UNTIL ASKED FOR. It locks a
 * person out of the product mid-shift, and it takes effect on their very next
 * request — which is the reason M-09 chose server-side sessions. The owner is
 * never suspended, matching the manual route.
 */
export async function sweepOverdueOrders(
  db: TenantDb,
  tenantId: string,
  settings: ErpSettings,
): Promise<JobResult> {
  if (!withinWorkingHours(settings)) {
    return { job: "overdue-sweep", flagged: 0, skipped: "outside working hours" };
  }

  const alertMinutes = Number(settings.alertMinutes) || 60;
  const grace = Number(settings.nightGraceMinutes) || 0;

  // The query uses the SHORTEST possible deadline; the grace is applied per
  // order below. `nightGraceMinutes` is extra time for orders that arrived
  // OUTSIDE working hours — so the overnight backlog is not all flagged the
  // instant the day starts — and adding it to everything would silently delay
  // every flag by two hours, which is its default.
  const earliest = new Date(Date.now() - alertMinutes * 60_000);

  const candidates = await db.fulfillmentOrder.findMany({
    where: {
      overdueFlaggedAt: null,
      createdAt: { lt: earliest },
      status: { in: [...ACTIVE_STATUSES] },
      // Never called. An order somebody has already tried is not a miss —
      // `no_answer` three times is the job working, not somebody ignoring it.
      calls: { none: {} },
    },
    select: { id: true, agentUserId: true, createdAt: true },
    // Bounded: a backlog is worked through over several passes rather than in
    // one transaction that times out (TX_OPTIONS is 15s).
    take: 200,
    orderBy: { createdAt: "asc" },
  })
    .then((rows) =>
      rows.filter((order) => {
        if (withinWorkingHours(settings, order.createdAt)) return true;
        // Arrived overnight: it gets the grace on top before it counts.
        return order.createdAt.getTime() + (alertMinutes + grace) * 60_000 < Date.now();
      }),
    );

  if (candidates.length === 0) {
    return { job: "overdue-sweep", flagged: 0, missed: 0, suspended: 0 };
  }

  const flaggedAt = new Date();
  // Guarded again in the WHERE, not just in the read above: two instances can
  // both have selected this row, and only the one whose UPDATE matches a still
  // -null column is allowed to count the miss.
  let flagged = 0;
  const missesByAgent = new Map<string, number>();

  for (const order of candidates) {
    const { count } = await db.fulfillmentOrder.updateMany({
      where: { id: order.id, overdueFlaggedAt: null },
      data: { overdueFlaggedAt: flaggedAt },
    });
    if (count === 0) continue;
    flagged += 1;
    if (order.agentUserId) {
      missesByAgent.set(order.agentUserId, (missesByAgent.get(order.agentUserId) ?? 0) + 1);
    }
  }

  let suspended = 0;
  const autoSuspend = settings.autoSuspend === true;
  const threshold_ = Number(settings.suspendThreshold) || 5;

  for (const [userId, misses] of missesByAgent) {
    const config = await readAgentConfig(db, tenantId, userId);
    const total = (Number(config.missedOrders) || 0) + misses;
    await writeAgentConfig(db, tenantId, userId, { missedOrders: total });

    if (!autoSuspend || total < threshold_) continue;

    const membership = await db.membership.findFirst({
      where: { userId },
      select: { id: true, role: true, suspended: true },
    });
    // The owner is never suspended and neither is somebody already suspended —
    // the same two refusals the manual route makes, for the same reasons.
    if (!membership || membership.role === "OWNER" || membership.suspended) continue;

    await db.membership.update({ where: { id: membership.id }, data: { suspended: true } });
    suspended += 1;
  }

  return { job: "overdue-sweep", flagged, missed: missesByAgent.size, suspended };
}

/* -----------------------------------------------------------------------------
 * The one entry point
 * -------------------------------------------------------------------------- */

/**
 * Run one job for one already-bound tenant.
 *
 * Both callers go through here — the manager's "run it now" button and the
 * worker's tick — so a job cannot behave differently depending on who asked.
 */
export async function runJob(
  db: TenantDb,
  tenantId: string,
  job: JobName,
): Promise<JobResult> {
  const settings = await readSettings(db);
  switch (job) {
    case "followup-escalation":
      return escalateFollowups(db);
    case "overdue-sweep":
      return sweepOverdueOrders(db, tenantId, settings);
  }
}
