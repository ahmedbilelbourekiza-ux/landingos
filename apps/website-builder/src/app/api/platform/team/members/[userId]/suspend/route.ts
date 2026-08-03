import type { TenantRole } from "@landingos/auth";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { PLATFORM_PRODUCT, loadMember, targetMemberError } from "@/lib/platform/team";

export const dynamic = "force-dynamic";

type Params = { userId: string };

/* =============================================================================
 * Suspend a team member — and the reason M-09 chose server-side sessions.
 *
 * THIS ROUTE DOES NOT DESTROY THEIR SESSIONS, and that is the design rather than
 * an omission.
 *
 * `resolveSession` re-reads the membership on EVERY request and copies
 * `suspended` into the `AuthContext`; `can()` returns false for a suspended
 * context before it looks at anything else. So the flag alone takes effect on
 * the caller's very next call, with no session table write and nothing to keep
 * in step. That is precisely the property a stateless seven-day JWT could not
 * offer, and it is why the platform pays a database read per request.
 *
 * `destroySessionsForUser` exists and would be the WRONG tool here: it is keyed
 * on the user, not the membership, and one person belongs to many companies. A
 * consultant suspended by one client would be signed out of the other, on a
 * screen that never mentioned them. Sessions are per-person; suspension is
 * per-company; collapsing the two loses the distinction the global `User` model
 * was created to express.
 *
 * A suspended member keeps their session and loses their access — the same
 * distinction `Tenant.status` draws for a whole company, and the one the ERP
 * already drew for a suspended agent.
 * ========================================================================== */

export const POST = tenantRoute<Params>("platform:team:write", async ({ db, params, session }) => {
  const actor = session.auth!;
  const member = await loadMember(db, params.userId);
  if (!member) return apiError(404, "NOT_FOUND", "That person is not on this team.");

  const blocked = targetMemberError(actor.userId, {
    userId: member.userId,
    role: member.role as TenantRole,
  });
  if (blocked) return apiError(blocked.status, blocked.code, blocked.message);

  // Idempotent: suspending somebody already suspended is the state the caller
  // asked for. The audit row is written only on the transition, so a
  // double-clicked button does not invent a second event.
  if (!member.suspended) {
    await db.membership.update({ where: { id: member.id }, data: { suspended: true } });
    await db.auditEvent.create({
      data: {
        tenantId: actor.tenantId,
        userId: session.user.id,
        product: PLATFORM_PRODUCT,
        entity: "membership",
        entityId: member.userId,
        action: "suspend",
      },
    });
  }

  return apiOk({ userId: member.userId, suspended: true });
});
