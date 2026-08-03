import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { PLATFORM_PRODUCT, loadMember } from "@/lib/platform/team";

export const dynamic = "force-dynamic";

type Params = { userId: string };

/**
 * Lift a suspension.
 *
 * No `targetMemberError` here, and the two rules it holds are both vacuous on
 * this route rather than waived: the owner can never be suspended, so there is
 * no suspended owner to reactivate; and a suspended caller is refused by `can()`
 * before the handler runs, so nobody can reach this for themselves. Applying the
 * guard anyway would refuse an owner "because they are the owner" in a case that
 * cannot occur, which reads as a rule about reactivation and is not one.
 *
 * Access returns on their next request, by the same mechanism suspension took it
 * away — see the header of `../suspend/route.ts`.
 */
export const POST = tenantRoute<Params>("platform:team:write", async ({ db, params, session }) => {
  const member = await loadMember(db, params.userId);
  if (!member) return apiError(404, "NOT_FOUND", "That person is not on this team.");

  if (member.suspended) {
    await db.membership.update({ where: { id: member.id }, data: { suspended: false } });
    await db.auditEvent.create({
      data: {
        tenantId: session.auth!.tenantId,
        userId: session.user.id,
        product: PLATFORM_PRODUCT,
        entity: "membership",
        entityId: member.userId,
        action: "reactivate",
      },
    });
  }

  return apiOk({ userId: member.userId, suspended: false });
});
