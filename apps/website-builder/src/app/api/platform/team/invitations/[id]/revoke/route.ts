import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { PLATFORM_PRODUCT, invitationState } from "@/lib/platform/team";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Withdraw an invitation.
 *
 * Idempotent: revoking one that is already revoked or expired succeeds and
 * changes nothing, because the caller's intent — "this link must not work" — is
 * already true, and answering 409 to that would make a retry look like a
 * failure. An ACCEPTED invitation is the one case that refuses, and refusing it
 * is the honest answer: the membership exists, and taking it away is
 * `DELETE /api/platform/team/members/[userId]` rather than a change to the
 * record of how it was granted.
 *
 * Another tenant's invitation is a 404, not a 403 — the binding cannot see it,
 * and confirming that a row exists somewhere else is itself information.
 */
export const POST = tenantRoute<Params>("platform:team:write", async ({ db, params, session }) => {
  const invitation = await db.invitation.findFirst({ where: { id: params.id } });
  if (!invitation) {
    return apiError(404, "NOT_FOUND", "That invitation does not exist.");
  }
  if (invitation.acceptedAt) {
    return apiError(409, "ALREADY_ACCEPTED", "That invitation has already been accepted.");
  }

  const updated = invitation.revokedAt
    ? invitation
    : await db.invitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      });

  if (!invitation.revokedAt) {
    await db.auditEvent.create({
      data: {
        tenantId: session.auth!.tenantId,
        userId: session.user.id,
        product: PLATFORM_PRODUCT,
        entity: "invitation",
        entityId: invitation.id,
        action: "revoke",
        payload: { email: invitation.email },
      },
    });
  }

  return apiOk({ id: updated.id, state: invitationState(updated) });
});
