import "server-only";

import { can, type TenantRole } from "@landingos/auth";
import type { TenantDb } from "@landingos/db";

import { readAllAgentConfigs } from "./agents";
import { ACTIVE_STATUSES } from "./orders";
import { readSettings, type ErpSettings } from "./settings";

/* =============================================================================
 * Who work lands on — Phase 6.6.
 *
 * Ported from three places in the ERP that all asked the same question and
 * answered it separately: `autoAssign()` (index.js:655) for a new order,
 * `assignFollowup()` (lib/followup.js:66) for a confirmed one, and the
 * reassignment branch of the overdue sweep (index.js:861). Written once here,
 * because three copies of an eligibility rule is three places for somebody to
 * stay assignable after they have been suspended.
 *
 * -----------------------------------------------------------------------------
 * D-06.5 — AUTOMATIC ASSIGNMENT REQUIRES AN EXPLICIT JOB ROLE.
 *
 * The ERP treated a missing role as "confirmation agent":
 *
 *     a.role === 'confirmation' || a.role === 'both' || !a.role
 *
 * That was safe there, because every row in its `agents` table WAS a
 * call-centre agent — the table existed for no other purpose. `Membership` is
 * not that table. It is everybody in the company: the bookkeeper, the person
 * who only uses the website builder, the owner who signed up. `jobRole` is null
 * for all of them, so carrying the fallback across would hand a customer's
 * order to somebody who has never opened the product.
 *
 * The safe direction is the opposite one from the usual: an agent who is not
 * offered work notices within a shift and asks; a customer whose order sits with
 * the accountant is a customer nobody rings.
 *
 * -----------------------------------------------------------------------------
 * D-06.6 — AND THE PERMISSION THE ROUTE WOULD CHECK.
 *
 * A job role says what somebody does. It does not say whether the API will let
 * them. Assigning an order to a person `POST /orders/[id]/call` answers 403 for
 * produces work nobody can do, and — once the sweep is running — a missed-order
 * counter climbing against somebody who was never able to act on it.
 *
 * So eligibility asks `can(..., "erp:orders:write")`, the same function and the
 * same permission the route checks. This is D-06.2 ("render a control only where
 * the API would accept it") applied to the other end: never hand out work the
 * API would refuse.
 *
 * Note that entitlement is checked as part of `can`, so a tenant whose ERP
 * subscription has lapsed has no eligible agents and assigns nothing — the same
 * rule that closes the routes, rather than a second one.
 *
 * -----------------------------------------------------------------------------
 * WHICH CLOCK DECIDES A DAY OFF.
 *
 * The server's, matching `withinWorkingHours` in jobs.ts. The ERP pinned
 * Africa/Algiers because it served one company in one country; a multi-tenant
 * platform cannot hardcode that, and there is no per-tenant timezone setting to
 * read instead. Both the working-hours gate and the day-off rule therefore read
 * the same clock, which is the property that matters here: they cannot disagree
 * about what day it is. A per-tenant timezone is a real gap and is recorded in
 * NEXT_STEPS rather than invented here.
 * ========================================================================== */

/** Confirmation calls, or chasing a parcel. The ERP's `agents.role` vocabulary. */
export type JobKind = "confirmation" | "followup";

/**
 * What an assignee must be able to do.
 *
 * One permission for both kinds, because both act on the order: a follow-up
 * agent logs notes and resolves tasks against it exactly as a confirmation
 * agent logs calls.
 */
const WORKS_ORDERS = "erp:orders:write";

/** The tenant's entitlement set, for `can`. Read inside the caller's binding. */
async function entitlementsOf(db: TenantDb): Promise<string[]> {
  const subscription = await db.subscription.findFirst({ select: { entitlements: true } });
  const held = subscription?.entitlements;
  return Array.isArray(held) ? (held as unknown[]).map(String) : [];
}

/**
 * Everybody who could take this kind of work right now, oldest membership first.
 *
 * The order is stable on purpose. `leastLoaded` keeps the first candidate on a
 * tie, so a stable list turns "least loaded" into a genuine round-robin instead
 * of a coin flip that a test cannot pin down.
 */
export async function eligibleAgents(
  db: TenantDb,
  tenantId: string,
  kind: JobKind,
): Promise<string[]> {
  const memberships = await db.membership.findMany({
    // A suspended member must never receive new work — that is most of the
    // point of suspending them. `jobRole` is matched by NAME rather than
    // defaulted: see D-06.5.
    where: { suspended: false, jobRole: { in: [kind, "both"] } },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    select: { userId: true, role: true, permissions: true },
  });
  if (memberships.length === 0) return [];

  const entitlements = await entitlementsOf(db);
  const configs = await readAllAgentConfigs(db);
  const today = new Date().getDay();

  return memberships
    .filter((m) =>
      can(
        {
          userId: m.userId,
          tenantId,
          role: m.role as TenantRole,
          permissions: Array.isArray(m.permissions)
            ? (m.permissions as unknown[]).map(String)
            : [],
          entitlements,
        },
        WORKS_ORDERS,
      ),
    )
    // The recurring weekly schedule, so no order lands on somebody who is not
    // there — every week, with no manager action needed.
    .filter((m) => !(configs.get(m.userId)?.weeklyDaysOff ?? []).includes(today))
    .map((m) => m.userId);
}

/**
 * How much of this kind of work each candidate is already carrying.
 *
 * One `groupBy` rather than a count per person: a roster is tens of people, and
 * a query per person on the single pinned connection `withTenant` opened is how
 * P2028 timeouts start.
 *
 * CONFIRMATION counts orders still to be called — the ERP's own active-status
 * list, derived here rather than hand-written (see ACTIVE_STATUSES).
 *
 * FOLLOW-UP counts orders whose parcel has not settled. The ERP's function was
 * named `workloadByAgent` and its comment said "current OPEN follow-up
 * workload", but it counted every order the agent had ever been given — so the
 * balance was by lifetime total and somebody who joined last year kept receiving
 * nothing until the newcomer caught up. This counts what the comment says.
 */
async function workload(
  db: TenantDb,
  kind: JobKind,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(userIds.map((id) => [id, 0]));
  if (userIds.length === 0) return counts;

  if (kind === "confirmation") {
    const rows = await db.fulfillmentOrder.groupBy({
      by: ["agentUserId"],
      where: { agentUserId: { in: [...userIds] }, status: { in: [...ACTIVE_STATUSES] } },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (row.agentUserId) counts.set(row.agentUserId, row._count._all);
    }
    return counts;
  }

  const rows = await db.fulfillmentOrder.groupBy({
    by: ["followupUserId"],
    where: {
      followupUserId: { in: [...userIds] },
      // Not settled: the parcel is still somebody's problem. The column
      // defaults to "" and is set to "delivered"/"returned" once, so both empty
      // states mean the same thing and checking one of them misses half the data.
      OR: [{ deliveryOutcome: null }, { deliveryOutcome: "" }],
    },
    _count: { _all: true },
  });
  for (const row of rows) {
    if (row.followupUserId) counts.set(row.followupUserId, row._count._all);
  }
  return counts;
}

/** The lightest load wins; ties go to whoever appears first. */
function leastLoaded(candidates: readonly string[], counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const userId of candidates) {
    const load = counts.get(userId) ?? 0;
    if (load < bestCount) {
      best = userId;
      bestCount = load;
    }
  }
  return best;
}

/**
 * Choose somebody, or nobody.
 *
 * `exclude` is the reassignment case: an order is moved BECAUSE the person
 * holding it has not acted, so handing it back to them is the one outcome that
 * cannot help.
 */
export async function pickAgent(
  db: TenantDb,
  tenantId: string,
  kind: JobKind,
  opts: { readonly exclude?: string | null } = {},
): Promise<string | null> {
  const eligible = (await eligibleAgents(db, tenantId, kind)).filter(
    (userId) => userId !== opts.exclude,
  );
  if (eligible.length === 0) return null;
  return leastLoaded(eligible, await workload(db, kind, eligible));
}

/* -----------------------------------------------------------------------------
 * The two automatic behaviours, each gated on its own setting
 * -------------------------------------------------------------------------- */

/**
 * Who a newly created order should go to, or null.
 *
 * Called from every path that creates an order — the manual route, the
 * storefront bridge, the inbound channel webhooks — because the ERP assigned on
 * all of them (`resolveAgent('')` appears on nine). An order that arrives
 * unassigned through one door and assigned through another is an order the queue
 * surfaces to nobody in particular, depending on where the customer bought it.
 *
 * THE SETTING DECIDES. `autoAssign` is off by default and this returns null
 * without looking at the roster when it is — which is the whole of BUG-03's
 * lesson: the ERP's follow-up toggle did nothing for the life of the product
 * because both callers forced the behaviour on before the setting was read.
 */
export async function autoAssignOnCreate(
  db: TenantDb,
  tenantId: string,
  settings?: ErpSettings,
): Promise<string | null> {
  const s = settings ?? (await readSettings(db));
  if (s.autoAssign !== true) return null;
  return pickAgent(db, tenantId, "confirmation");
}

/**
 * Give a just-confirmed order a follow-up agent.
 *
 * A MANAGER'S OWN CHOICE IS NOT OVERWRITTEN. The ERP's `assignFollowup` took an
 * explicit agent OR auto-assigned, and on this platform the explicit half is
 * `PATCH /orders/[id]` with `followupUserId` — a manager-only field. So an order
 * that already names somebody is left alone: the automation exists to fill a
 * gap, not to overrule a decision.
 *
 * Returns the chosen user, or null when the toggle is off, somebody is already
 * assigned, or nobody is eligible.
 */
export async function autoAssignFollowup(
  db: TenantDb,
  tenantId: string,
  orderId: string,
  settings?: ErpSettings,
): Promise<string | null> {
  const s = settings ?? (await readSettings(db));
  if (s.followupAutoAssign !== true) return null;

  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: { followupUserId: true },
  });
  if (!order || order.followupUserId) return null;

  const chosen = await pickAgent(db, tenantId, "followup");
  if (!chosen) return null;

  await db.fulfillmentOrder.update({
    where: { id: orderId },
    data: { followupUserId: chosen, followupAssignedAt: new Date() },
  });
  return chosen;
}

/* -----------------------------------------------------------------------------
 * The manual half — LP.9 / LP.21, closing R13
 * -------------------------------------------------------------------------- */

/** What `assignFollowupAgent` was asked to do. */
export interface FollowupAssignment {
  /** A named person, or null to let the workload rule choose. */
  readonly userId?: string | null;
  /** Who pressed the button. Recorded on the audit row. */
  readonly actorUserId: string;
}

/**
 * Give an order a follow-up agent BECAUSE SOMEBODY ASKED.
 *
 * The counterpart to `autoAssignFollowup` above, and the two differ in exactly
 * two ways — both of which are the difference between an automation and an
 * instruction:
 *
 *   - IT IGNORES `followupAutoAssign`. That setting answers "should the system
 *     do this by itself"; a supervisor pressing "assign" has already answered
 *     it. The legacy makes the same distinction with `opts.auto ||
 *     settings.followupAutoAssign`.
 *   - IT OVERWRITES AN EXISTING ASSIGNEE. `autoAssignFollowup` refuses to,
 *     because filling a gap must never overrule a decision. Moving a difficult
 *     customer to a senior agent IS the decision, and it is the whole business
 *     case in R13.
 *
 * A NAMED PERSON IS STILL CHECKED FOR ELIGIBILITY. `eligibleAgents` is the same
 * rule the automation uses — the follow-up job role, not suspended, holds
 * `erp:orders:write`, not on a day off. Handing work to somebody the API would
 * refuse produces a queue nobody can work and a missed-order counter climbing
 * against a person who was never able to act (D-06.6). Returns null rather than
 * assigning, so the caller can say so per id.
 *
 * Returns the chosen user, or null when nobody eligible was found or the named
 * person is not eligible.
 */
export async function assignFollowupAgent(
  db: TenantDb,
  tenantId: string,
  orderId: string,
  opts: FollowupAssignment,
): Promise<string | null> {
  const eligible = await eligibleAgents(db, tenantId, "followup");
  if (eligible.length === 0) return null;

  const named = opts.userId?.trim();
  let chosen: string | null;
  if (named) {
    chosen = eligible.includes(named) ? named : null;
  } else {
    chosen = leastLoaded(eligible, await workload(db, "followup", eligible));
  }
  if (!chosen) return null;

  const order = await db.fulfillmentOrder.findUnique({
    where: { id: orderId },
    select: { id: true, followupUserId: true },
  });
  if (!order) return null;

  await db.fulfillmentOrder.update({
    where: { id: orderId },
    data: { followupUserId: chosen, followupAssignedAt: new Date() },
  });

  /* The legacy writes `db.audit('order', id, 'followup_assign', actor, {agent})`
   * and so does this. Moving a customer between agents is exactly the class of
   * change N12 found had no trail at all: "who put this on Karim?" needs an
   * answer, and the assignment itself does not carry one. */
  await db.auditEvent.create({
    data: {
      tenantId,
      product: "erp",
      entity: "order",
      entityId: orderId,
      action: "followup_assign",
      userId: opts.actorUserId,
      payload: { followupUserId: chosen, previous: order.followupUserId, auto: !named },
    },
  });

  return chosen;
}
