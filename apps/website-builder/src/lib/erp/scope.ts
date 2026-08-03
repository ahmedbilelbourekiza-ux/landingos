import "server-only";

import { can } from "@landingos/auth";
import type { Prisma } from "@landingos/db";
import type { ConsoleSession } from "@/lib/console/session";

/* =============================================================================
 * Record-level scope — the ERP's own rule, inside the tenant.
 *
 * This is NOT tenant isolation and is not a substitute for it. Tenant isolation
 * is the database's job and holds whether or not this file is correct. This is
 * the second, narrower rule the ERP enforced INSIDE one company: a confirmation
 * agent works their own queue.
 *
 * WHICH PERMISSION DECIDES.
 *
 * The ERP asked `isManager`, a boolean on the account. There is no such boolean
 * here, and inventing one would be standing up a second authorization model
 * beside the platform's. So the question becomes: which declared permission
 * means "you may see other people's customer records in bulk"?
 *
 * `erp:clients:read`. The order book is bulk customer data — names, phone
 * numbers, addresses, order values — which is the same thing the customer
 * registry holds, arranged differently. Keying both on one permission means
 * they cannot drift apart, and D-05.1 has just made that permission sensitive
 * for exactly this reason. Using `erp:orders:read` instead would not work: every
 * member holds it by role glob, including the agent this rule exists to scope.
 *
 * WHERE IT IS APPLIED.
 *
 * Inside the query, always. The original file this came from
 * (apps/erp/test/pagination.test.js) exists because filtering a page after the
 * fact silently returns short pages — a page of 25 becomes 9 rows and the UI
 * shows a "next" button that leads nowhere. Worse, `total` stays unscoped, so
 * the count tells an agent how many orders their colleagues have.
 * ========================================================================== */

/** May this caller see every order in the tenant? */
export function seesWholeBook(session: ConsoleSession): boolean {
  return Boolean(session.auth && can(session.auth, "erp:clients:read"));
}

/**
 * The `where` fragment that limits an order query to what this caller may see.
 *
 * `{}` for a manager. For an agent: their own orders, orders assigned to them
 * for follow-up, and the unassigned queue — which stays visible on purpose so
 * work can be picked up rather than only handed out.
 *
 * Note `agentUserId: null` AND `agentUserId: ""`. The column is nullable and
 * the ERP wrote an empty string when reassignment orphaned an order, so both
 * states exist in the data and both mean unassigned. Checking one of them is a
 * bug that hides until an order is reassigned.
 */
export function orderScope(session: ConsoleSession): Prisma.FulfillmentOrderWhereInput {
  if (seesWholeBook(session)) return {};
  const userId = session.user.id;
  return {
    OR: [
      { agentUserId: userId },
      { followupUserId: userId },
      { agentUserId: null },
      { agentUserId: "" },
    ],
  };
}

/**
 * Combine the caller's scope with the filters they asked for.
 *
 * AND, never spread. Spreading lets a caller-supplied `agentUserId` overwrite
 * the scope key and read somebody else's queue — the same
 * client-supplied-filter mistake the ERP made in three separate places, and the
 * reason `hardening.test.js §7` exists.
 */
export function scopedWhere(
  session: ConsoleSession,
  filters: Prisma.FulfillmentOrderWhereInput,
): Prisma.FulfillmentOrderWhereInput {
  const scope = orderScope(session);
  if (!Object.keys(scope).length) return filters;
  return { AND: [scope, filters] };
}

/**
 * The `where` fragment that limits the FOLLOW-UP queue to what this caller may
 * see — Phase 6.4b.
 *
 * Extracted from `api/erp/followup/tasks/route.ts` when the queue screen needed
 * the same rule. `hardening.test.js §7` exists because the ERP accepted
 * `?agent=` here and honoured it, so an agent could list a colleague's tasks by
 * asking; a screen that reimplemented the scope would be a second chance to make
 * that mistake, in the place nobody thinks to test.
 *
 * A manager may narrow to one person deliberately. Everybody else is pinned to
 * themselves, and the parameter is ignored rather than refused — which is what
 * the contract test asserts.
 */
export function followupScope(
  session: ConsoleSession,
  requestedAgentUserId?: string | null,
): { agentUserId?: string } {
  if (!seesWholeBook(session)) return { agentUserId: session.user.id };
  const requested = requestedAgentUserId?.trim();
  return requested ? { agentUserId: requested } : {};
}

/**
 * May this caller act on this specific order?
 *
 * Used by the per-order routes, which is where the ERP's real defect was:
 * scoping the LIST was cosmetic while `/api/orders/:id/call` took the id from
 * the URL and never checked ownership. Logging a confirmed call on somebody
 * else's order is payroll fraud, not a privacy nuisance.
 */
export function mayTouchOrder(
  session: ConsoleSession,
  order: { agentUserId: string | null; followupUserId: string | null },
): boolean {
  if (seesWholeBook(session)) return true;
  const userId = session.user.id;
  return (
    order.agentUserId === userId ||
    order.followupUserId === userId ||
    !order.agentUserId
  );
}
