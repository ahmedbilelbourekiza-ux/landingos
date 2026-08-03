import "server-only";

import type { Prisma, TenantDb } from "@landingos/db";

import { readSettings, type ErpSettings } from "./settings";
import { ACTIVE_STATUSES } from "./orders";
import { readAgentConfig, writeAgentConfig } from "./agents";
import { FOLLOWUP_TASK_TYPE } from "./followup";
import { pickAgent } from "./assign";
import { TERMINAL } from "./carriers";
import { refreshShipment } from "./shipments";
import {
  notifyAgentOverdue, notifyAgentSuspended, notifyFollowupOverdue, notifyStaleOrders,
} from "./notify";

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

export const JOBS = [
  "followup-escalation",
  "overdue-sweep",
  "tracking-poll",
  "stale-orders",
] as const;
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
export async function escalateFollowups(db: TenantDb, tenantId: string): Promise<JobResult> {
  const { count } = await db.followupTask.updateMany({
    where: {
      status: "open",
      type: FOLLOWUP_TASK_TYPE,
      dueAt: { lt: new Date() },
    },
    data: { status: "overdue" },
  });

  // One summary, only when something actually escalated — the count came from
  // the guarded `updateMany`, so a second pass reports zero and says nothing.
  // An escalation means an agent let a reminder expire, which is a supervision
  // signal rather than something to push at the agents.
  if (count > 0) await notifyFollowupOverdue(db, tenantId, count);

  return { job: "followup-escalation", escalated: count };
}

/* -----------------------------------------------------------------------------
 * The stale-order alert
 * -------------------------------------------------------------------------- */

/**
 * Orders nobody has called for longer than `alertMinutes`.
 *
 * THE SECOND OF THE ERP'S THREE LOOPS (`apps/erp/lib/jobs.js:61`), and the home
 * `alertMinutes` always had. 6.5b read that setting in the overdue sweep, which
 * is a different job with a different threshold (`reassignMinutes`); 6.6a
 * separated them and this is the half that was missing.
 *
 * The two are not redundant. The SWEEP is about accountability — it counts a
 * miss against a named agent and can move the order. This is a NUMBER on a
 * supervisor's screen: how much work is sitting untouched right now, whoever it
 * belongs to and whether or not anybody is at fault. That is why it is a summary
 * rather than one alert per order, and why it counts unassigned orders too.
 *
 * It is NOT idempotent in the column-guard sense, because there is nothing to
 * guard: it reports a live count and writes no state to the orders. Repeated
 * passes therefore repeat the alert, which is what an "N orders are waiting"
 * signal means — the ERP ran it hourly for that reason. `WORKER_INTERVAL_MS`
 * governs how often, and a deployment that finds it noisy raises the interval or
 * `alertMinutes` rather than adding state nobody can see.
 */
export async function alertStaleOrders(
  db: TenantDb,
  tenantId: string,
  settings: ErpSettings,
): Promise<JobResult> {
  if (!withinWorkingHours(settings)) {
    return { job: "stale-orders", stale: 0, skipped: "outside working hours" };
  }

  const minutes = Number(settings.alertMinutes) || 60;
  const stale = await db.fulfillmentOrder.count({
    where: {
      status: { in: [...ACTIVE_STATUSES] },
      createdAt: { lt: new Date(Date.now() - minutes * 60_000) },
      calls: { none: {} },
    },
  });

  if (stale > 0) await notifyStaleOrders(db, tenantId, stale, minutes);
  return { job: "stale-orders", stale };
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
 * Flag orders nobody has called, count the miss against the agent, move the
 * order on if the tenant has asked for that, and suspend on repeat.
 *
 * WHICH SETTING IS THE THRESHOLD. `reassignMinutes` — how long an order may sit
 * with an agent uncalled — which is what the ERP's sweep used and what the
 * automation screen labels it as. 6.5b read `alertMinutes` instead, which is a
 * different ERP job entirely (the hourly "N orders nobody has called" manager
 * alert, `apps/erp/lib/jobs.js:61`, and the queue screen's overdue badge). The
 * two were conflated, so the number a manager changes to control reassignment
 * did nothing — which is BUG-03's exact shape, and it would have shipped
 * invisibly the moment auto-reassign went live.
 *
 * `Number(...) || 5` keeps the ERP's quirk that a stored 0 means five minutes,
 * not zero. It reads like a bug and is the safer of the two readings: "flag
 * everything instantly" is not a thing a manager means by typing 0.
 *
 * THE CLOCK, AND WHY `overdueFlaggedAt` IS BOTH GUARD AND TIMESTAMP.
 *
 * `overdueFlaggedAt: null` is the guard for an order that has never been
 * flagged, and it is why the counter moves once per order rather than once per
 * pass — the ERP's own test called this "single-counting per timeout", and it is
 * the property BUG-01 destroyed.
 *
 * Once auto-reassign moves an order, the column becomes the moment it changed
 * hands, and the next deadline is measured from THERE. The ERP cleared it on
 * reassignment while still measuring from `createdAt`, which never moves — so
 * the very next tick found the same order overdue, counted a miss against an
 * agent who had held it for sixty seconds, and moved it on again. One ignored
 * order would walk the whole roster in minutes and, with auto-suspend on, lock
 * everybody out. BUG-01 meant that code never ran in production, so nobody saw
 * it. Re-arming from the handover is what a "threshold" means.
 *
 * The re-arm applies ONLY when auto-reassign is on. With it off the ERP flagged
 * an order exactly once, ever, and that is preserved: nothing changes hands, so
 * counting a second miss against the same person for the same order would be
 * punishing them twice for one failure.
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

  const thresholdMinutes = Number(settings.reassignMinutes) || 5;
  const grace = Number(settings.nightGraceMinutes) || 0;
  const mayReassign = settings.autoReassign === true;

  // The query uses the SHORTEST possible deadline; the grace is applied per
  // order below. `nightGraceMinutes` is extra time for orders that arrived
  // OUTSIDE working hours — so the overnight backlog is not all flagged the
  // instant the day starts — and adding it to everything would silently delay
  // every flag by two hours, which is its default.
  const earliest = new Date(Date.now() - thresholdMinutes * 60_000);

  const due: Prisma.FulfillmentOrderWhereInput = mayReassign
    ? {
        OR: [
          { overdueFlaggedAt: null, createdAt: { lt: earliest } },
          { overdueFlaggedAt: { lt: earliest } },
        ],
      }
    : { overdueFlaggedAt: null, createdAt: { lt: earliest } };

  const candidates = await db.fulfillmentOrder.findMany({
    where: {
      ...due,
      status: { in: [...ACTIVE_STATUSES] },
      // Somebody's responsibility. The sweep asks "has this person done their
      // job", and an order assigned to nobody has no such person — which is why
      // the ERP's own query required a non-empty agent, and why an order that
      // ends up in the unassigned queue leaves the sweep rather than being
      // re-flagged for the rest of its life. Both empty states, because the
      // column is nullable and reassignment used to write "".
      AND: [{ agentUserId: { not: null } }, { agentUserId: { not: "" } }],
      // Never called. An order somebody has already tried is not a miss —
      // `no_answer` three times is the job working, not somebody ignoring it.
      calls: { none: {} },
    },
    select: { id: true, agentUserId: true, createdAt: true, overdueFlaggedAt: true },
    // Bounded: a backlog is worked through over several passes rather than in
    // one transaction that times out (TX_OPTIONS is 15s).
    take: 200,
    orderBy: { createdAt: "asc" },
  })
    .then((rows) =>
      rows.filter((order) => {
        // From the handover if there has been one, otherwise from arrival.
        const since = order.overdueFlaggedAt ?? order.createdAt;
        if (withinWorkingHours(settings, since)) return true;
        // Arrived overnight: it gets the grace on top before it counts.
        return since.getTime() + (thresholdMinutes + grace) * 60_000 < Date.now();
      }),
    );

  if (candidates.length === 0) {
    return { job: "overdue-sweep", flagged: 0, missed: 0, suspended: 0, reassigned: 0, unassigned: 0 };
  }

  const flaggedAt = new Date();
  // Guarded again in the WHERE, not just in the read above: two instances can
  // both have selected this row, and only the one whose UPDATE still matches is
  // allowed to count the miss. The guard is the same predicate the read used,
  // so it holds for a re-armed order too — the first writer moves the column
  // past `earliest` and the second matches nothing.
  let flagged = 0;
  let reassigned = 0;
  let unassigned = 0;
  const missesByAgent = new Map<string, number>();

  for (const order of candidates) {
    const guard =
      order.overdueFlaggedAt === null
        ? { overdueFlaggedAt: null }
        : { overdueFlaggedAt: { lt: earliest } };

    const { count } = await db.fulfillmentOrder.updateMany({
      where: { id: order.id, ...guard },
      data: { overdueFlaggedAt: flaggedAt },
    });
    if (count === 0) continue;
    flagged += 1;
    if (order.agentUserId) {
      missesByAgent.set(order.agentUserId, (missesByAgent.get(order.agentUserId) ?? 0) + 1);
    }

    if (!mayReassign) continue;

    // Somebody else, never the person who has already ignored it. When there is
    // nobody, the order is released rather than left with them: an unassigned
    // order is visible to every agent (`orderScope`), so it becomes work anybody
    // may pick up instead of work one person has demonstrably not done.
    const next = await pickAgent(db, tenantId, "confirmation", { exclude: order.agentUserId });
    await db.fulfillmentOrder.update({
      where: { id: order.id },
      data: { agentUserId: next },
    });
    if (next) reassigned += 1;
    else unassigned += 1;
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

  // Told once per pass, to the people who supervise. `agent_overdue` was one of
  // the five alerts the audit found stored with `target: null` — so an alert
  // about an agent's own missed order was stored for that agent to read.
  if (flagged > 0) await notifyAgentOverdue(db, tenantId, flagged, reassigned);
  if (suspended > 0) await notifyAgentSuspended(db, tenantId, suspended);

  return {
    job: "overdue-sweep",
    flagged,
    missed: missesByAgent.size,
    suspended,
    reassigned,
    unassigned,
  };
}

/* -----------------------------------------------------------------------------
 * The carrier tracking poll
 * -------------------------------------------------------------------------- */

/**
 * How many parcels one pass will ask about.
 *
 * Deliberately much smaller than the sweep's 200. Each of these is a network
 * round trip to somebody else's server, and it happens INSIDE the interactive
 * transaction `withTenant` opened — whose timeout is 15s (TX_OPTIONS). A backlog
 * is drained over several passes, oldest-poll-first, rather than in one
 * transaction that times out and rolls back everything it had already ingested.
 *
 * That the carrier call happens inside a database transaction at all is a real
 * limitation of the current shape and is recorded in NEXT_STEPS; it is why this
 * number is 25 and not 200.
 */
const POLL_BATCH = 25;

/**
 * Ask each carrier where its parcels are.
 *
 * THE THIRD OF THE ERP'S THREE SCHEDULED LOOPS (`apps/erp/lib/jobs.js:28`) and
 * the last one with no platform equivalent. Its own comment says why it exists:
 * it "guarantees updates flow even when a carrier's webhook is silent" — and in
 * this market most carriers have no webhook at all, so without it a parcel sat
 * at "created" until a person opened the order and pressed *ask the carrier*.
 *
 * IT GOES THROUGH `refreshShipment`, WHICH IS THE POINT. That function feeds
 * `ingestEvents`, the one choke point where events are stored idempotently, the
 * delivery outcome is settled (BUG-02) and follow-up tasks are raised (6.5a). A
 * poll that fetched and wrote events itself would be a second ingest path, and
 * the half of it nobody tested would be the half that decides whether anybody
 * rings a customer whose parcel came back.
 *
 * IDEMPOTENCE, and here it is also rate limiting. `lastPolledAt` is the guard,
 * matched in the same `updateMany` that writes it — so two workers ticking at
 * once, or a manager pressing "run it now" during a tick, cannot both call the
 * carrier about the same parcel. It is written whether or not the carrier had
 * news, which is why it cannot be `updatedAt`: a poll that found nothing must
 * still count as a poll, or every quiet parcel is re-asked on every tick.
 *
 * ONE PARCEL'S FAILURE DOES NOT STOP THE PASS. A carrier being down, or one
 * tracking number the carrier has never heard of, must not freeze every other
 * parcel in the company — the shape of BUG-01, where one throw meant the loop
 * never reached anything.
 */
export async function pollCarriers(
  db: TenantDb,
  tenantId: string,
  settings: ErpSettings,
): Promise<JobResult> {
  const minutes = Math.max(1, Number(settings.trackingPollMinutes) || 15);
  const earliest = new Date(Date.now() - minutes * 60_000);

  const due = await db.shipment.findMany({
    where: {
      AND: [
        // A parcel that has arrived, come back, or been called off is not going
        // to move again. `crmStatus: null` is listed explicitly because SQL's
        // `NOT IN` is unknown — not true — for a NULL, so a freshly booked
        // parcel would otherwise never be due.
        { OR: [{ crmStatus: null }, { crmStatus: { notIn: [...TERMINAL] } }] },
        { OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: earliest } }] },
      ],
    },
    select: { id: true, orderId: true, lastPolledAt: true },
    // Least recently asked about first, never-asked first of all, so a backlog
    // drains fairly instead of the same 25 parcels being polled forever.
    orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: POLL_BATCH,
  });

  const now = new Date();
  let polled = 0;
  let failed = 0;

  for (const shipment of due) {
    const guard =
      shipment.lastPolledAt === null
        ? { lastPolledAt: null }
        : { lastPolledAt: { lt: earliest } };

    const { count } = await db.shipment.updateMany({
      where: { id: shipment.id, ...guard },
      data: { lastPolledAt: now },
    });
    // Somebody else claimed it between the read and here.
    if (count === 0) continue;

    try {
      await refreshShipment(db, tenantId, shipment.orderId);
      polled += 1;
    } catch (error) {
      failed += 1;
      console.error(`[erp] tracking poll failed for shipment ${shipment.id}`, error);
    }
  }

  return { job: "tracking-poll", polled, failed, due: due.length };
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
      return escalateFollowups(db, tenantId);
    case "overdue-sweep":
      return sweepOverdueOrders(db, tenantId, settings);
    case "tracking-poll":
      return pollCarriers(db, tenantId, settings);
    case "stale-orders":
      return alertStaleOrders(db, tenantId, settings);
  }
}
