import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Suspend a team member.
 *
 * Takes effect on their very next request, and that immediacy is the entire
 * reason M-09 chose opaque server-side sessions over a stateless JWT: with a
 * 7-day token a dismissed employee keeps working access for a week. In a
 * product whose headline feature is team management, this is a daily operation
 * rather than an edge case.
 *
 * `can()` returns false for a suspended context, so no session needs destroying
 * — the token stays valid and buys nothing. Revoking it as well would be
 * belt-and-braces; leaving it means reactivation does not require signing in
 * again, which is what a manager expects after suspending someone by mistake.
 */
export const POST = tenantRoute<Params>("erp:agents:manage", async ({ db, session, params }) => {
  if (params.id === session.user.id) {
    // The ERP refused to let the last manager lock themselves out. The same
    // hazard in platform terms: suspending yourself ends the session you are
    // holding, and nobody is left who can undo it.
    return apiError(422, "CANNOT_SUSPEND_SELF", "You cannot suspend your own account.");
  }

  const membership = await db.membership.findFirst({
    where: { userId: params.id }, select: { id: true, role: true },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "No such team member.");

  if (membership.role === "OWNER") {
    return apiError(422, "CANNOT_SUSPEND_OWNER", "The owner cannot be suspended.");
  }

  await db.membership.update({ where: { id: membership.id }, data: { suspended: true } });
  return apiOk({ userId: params.id, suspended: true });
});
