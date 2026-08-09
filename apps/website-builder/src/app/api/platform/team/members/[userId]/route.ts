import { z } from "zod";

import type { TenantRole } from "@landingos/auth";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  ASSIGNABLE_ROLES,
  PLATFORM_PRODUCT,
  assignableRoleError,
  loadMember,
  targetMemberError,
} from "@/lib/platform/team";

export const dynamic = "force-dynamic";

type Params = { userId: string };

const Body = z.object({
  role: z.enum(ASSIGNABLE_ROLES as unknown as [TenantRole, ...TenantRole[]]),
});

/**
 * Change somebody's role.
 *
 * Four separate refusals, in this order, and each is a rule with its own test:
 * the member must exist here (404), must not be the owner (OWNER_IMMUTABLE),
 * must not be the caller (SELF_TARGET), and the new role must be one the caller
 * is senior enough to hand out (UNASSIGNABLE_ROLE / ROLE_ABOVE_SELF).
 *
 * The JOB role — `confirmation | followup | both` — is NOT here. That is the
 * ERP's, it lives on the same row, and it is a different question: what work
 * lands on somebody is not what they are allowed to do. `PATCH
 * /api/erp/agents/[id]` owns it and asks for `erp:agents:manage`.
 */
export const PATCH = tenantRoute<Params>("platform:team:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const actor = session.auth!;
  const member = await loadMember(db, params.userId);
  if (!member) return apiError(404, "NOT_FOUND", "That person is not on this team.");

  const blocked = targetMemberError(actor.userId, {
    userId: member.userId,
    role: member.role as TenantRole,
  });
  if (blocked) return apiError(blocked.status, blocked.code, blocked.message);

  const ceiling = assignableRoleError(actor.role, parsed.data.role);
  if (ceiling) return apiError(ceiling.status, ceiling.code, ceiling.message);

  const updated = await db.membership.update({
    where: { id: member.id },
    data: { role: parsed.data.role },
  });

  await db.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      userId: session.user.id,
      product: PLATFORM_PRODUCT,
      entity: "membership",
      entityId: member.userId,
      action: "role",
      payload: { from: member.role, to: parsed.data.role },
    },
  });

  return apiOk({ userId: updated.userId, role: updated.role });
});

/**
 * Remove somebody from this company.
 *
 * Deletes the MEMBERSHIP, never the user. One person belongs to many companies —
 * the seeded consultant is exactly that case — so deleting the account because
 * one employer let them go would take their other employers' access with it.
 *
 * Their sessions are deliberately left alone, and that is not an oversight.
 * `resolveSession` re-reads memberships on every request, so the very next call
 * finds no membership here, resolves no `auth`, and lands them on the tenant
 * picker with whatever other companies they still belong to. Destroying the
 * session rows instead would sign them out of those too.
 *
 * There is no "last administrator" check because there does not need to be one:
 * the owner cannot be removed by anybody, so a tenant always has at least one
 * person holding `*`. That invariant is what the ERP's last-manager rule was
 * approximating without an owner to lean on.
 */
export const DELETE = tenantRoute<Params>("platform:team:write", async ({ db, params, session }) => {
  const actor = session.auth!;
  const member = await loadMember(db, params.userId);
  if (!member) return apiError(404, "NOT_FOUND", "That person is not on this team.");

  const blocked = targetMemberError(actor.userId, {
    userId: member.userId,
    role: member.role as TenantRole,
  });
  if (blocked) return apiError(blocked.status, blocked.code, blocked.message);

  await db.membership.delete({ where: { id: member.id } });

  /* The doc-comment above promises "the very next call lands them on the
   * tenant picker" — the stored state now says so immediately: any of their
   * sessions still bound HERE lose the binding at the moment of removal
   * (resolveSession also self-heals a stale binding on read, but a row that
   * lies until somebody reads it is a row that lies). Their sessions
   * survive, so their OTHER companies stay signed in — the exact property
   * the comment was written to protect. */
  await db.session.updateMany({
    where: { userId: member.userId, activeTenantId: actor.tenantId },
    data: { activeTenantId: null },
  });

  await db.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      userId: session.user.id,
      product: PLATFORM_PRODUCT,
      entity: "membership",
      entityId: member.userId,
      action: "remove",
      payload: { role: member.role },
    },
  });

  return apiOk({ userId: member.userId, removed: true });
});
