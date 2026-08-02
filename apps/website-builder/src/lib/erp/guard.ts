import "server-only";

import type { TenantDb } from "@landingos/db";

import { apiError } from "@/lib/api/route";
import type { ConsoleSession } from "@/lib/console/session";
import { mayTouchOrder } from "./scope";

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
