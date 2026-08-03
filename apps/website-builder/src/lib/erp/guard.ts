import "server-only";

import type { TenantDb } from "@landingos/db";

import { apiError } from "@/lib/api/route";
import type { ConsoleSession } from "@/lib/console/session";
import { mayTouchOrder, seesWholeBook } from "./scope";

/* =============================================================================
 * Loading one order, for the routes that act on one order.
 *
 * This exists because of the defect hardening.test.js §3 was written for.
 * Scoping the order LIST was cosmetic: every per-order route took the id
 * straight from the URL and never checked ownership, so any agent could read,
 * edit, reassign or log a call against any order in the company. Logging a
 * confirmed call on somebody else's order is payroll fraud.
 *
 * Ten routes need this check. Written out ten times it is ten chances to forget
 * one, and the one that is forgotten is not visibly different from the nine
 * that are not — same as `tenantRoute` and the tenant binding.
 *
 * 404 FOR EVERYTHING, INCLUDING "EXISTS BUT NOT YOURS".
 *
 * The ERP answered 403 with `NOT_YOUR_ORDER`, which confirms the order exists
 * and is somebody else's. That is the same information leak the platform
 * already refuses across a tenant boundary, so this uses the platform's answer
 * instead — one rule rather than two, which is one rule that can drift instead
 * of two. Reassignment is the deliberate exception: it stays a loud 403,
 * because silently ignoring it would let an agent believe they had picked up
 * work.
 * ========================================================================== */

const OWNERSHIP_SELECT = {
  id: true,
  agentUserId: true,
  followupUserId: true,
  status: true,
  pendingCallStart: true,
  classification: true,
} as const;

export type OwnedOrder = {
  id: string;
  agentUserId: string | null;
  followupUserId: string | null;
  status: string | null;
  pendingCallStart: Date | null;
  classification: string | null;
};

/**
 * Resolve the order this request names, or the Response to return instead.
 *
 * Callers destructure and return `denied` when present:
 *
 *   const { order, denied } = await loadOwnedOrder(db, session, params.id);
 *   if (denied) return denied;
 */
export async function loadOwnedOrder(
  db: TenantDb,
  session: ConsoleSession,
  id: string,
): Promise<{ order: OwnedOrder; denied: null } | { order: null; denied: Response }> {
  // No tenant filter. The binding applies it and row-level security enforces
  // it — an id from another tenant simply does not resolve, which is why this
  // reads as if the other tenant's rows did not exist. They do not, here.
  const order = await db.fulfillmentOrder.findUnique({
    where: { id },
    select: OWNERSHIP_SELECT,
  });

  if (!order || !mayTouchOrder(session, order)) {
    return { order: null, denied: apiError(404, "NOT_FOUND", "No such order.") };
  }
  return { order, denied: null };
}

/* -----------------------------------------------------------------------------
 * The same guard, for a follow-up task — Phase 6.4c
 * -------------------------------------------------------------------------- */

export type OwnedFollowupTask = {
  id: string;
  orderId: string;
  agentUserId: string | null;
  status: string | null;
  resolvedAt: Date | null;
};

/**
 * Resolve the follow-up task this request names, or the Response to return.
 *
 * WHY THIS IS GUARDED AT ALL. Resolving asserts *I contacted this customer* —
 * it is a claim about work done, the same class of thing as logging a confirmed
 * call. The ERP's comment is the clearest statement of it: an agent must not
 * close out somebody else's task, "whether by accident or to hide an overdue
 * one" (apps/erp/index.js:3508).
 *
 * WHO MAY. Whoever sees the whole book; the person it is assigned to; or anyone,
 * when it is assigned to nobody. That last case is deliberate and is the ERP's
 * own rule (`task.agent && task.agent !== user`) — a task nobody owns is work
 * anybody may pick up, which is exactly why `mayTouchOrder` lets an agent act on
 * an unassigned order.
 *
 * 404, NOT 403. The ERP answered `NOT_YOUR_TASK`. The platform answers 404 for
 * another person's record — confirming it exists and belongs to a colleague is
 * itself information, and it is the answer `loadOwnedOrder` already gives for
 * the same question. One rule that can drift beats two.
 */
export async function loadOwnedFollowupTask(
  db: TenantDb,
  session: ConsoleSession,
  id: string,
): Promise<
  { task: OwnedFollowupTask; denied: null } | { task: null; denied: Response }
> {
  // No tenant filter: the binding applies it and row-level security enforces
  // it, so another tenant's id simply does not resolve.
  const task = await db.followupTask.findUnique({
    where: { id },
    select: {
      id: true, orderId: true, agentUserId: true, status: true, resolvedAt: true,
    },
  });

  const mine =
    task &&
    (seesWholeBook(session) ||
      !task.agentUserId ||
      task.agentUserId === session.user.id);

  if (!task || !mine) {
    return { task: null, denied: apiError(404, "NOT_FOUND", "No such follow-up task.") };
  }
  return { task, denied: null };
}
