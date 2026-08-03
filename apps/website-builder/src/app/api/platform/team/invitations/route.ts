import { z } from "zod";

import type { TenantRole } from "@landingos/auth";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  ASSIGNABLE_ROLES,
  PLATFORM_PRODUCT,
  assignableRoleError,
  invitationExpiry,
  invitationState,
  joinPath,
  listInvitations,
  newInvitationToken,
  normaliseEmail,
} from "@/lib/platform/team";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Invitations — Phase 7.1.
 *
 * `platform:team:*` is on the SENSITIVE list in `packages/auth`, so no role
 * reaches it by glob: OWNER and ADMIN hold it through a bare `*`, and anybody
 * else needs it granted by name on their membership. That is deliberate and it
 * is the reason MANAGER exists as a separate role at all — running a call centre
 * day to day is not the same job as deciding who works there.
 *
 * `productOf("platform:…")` is null, so this surface is NOT entitlement-gated. A
 * tenant whose subscription lapsed can still manage its own people; losing your
 * team screen because the invoice bounced is how a company loses the ability to
 * remove the person who stopped paying.
 * ========================================================================== */

const Body = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(ASSIGNABLE_ROLES as unknown as [TenantRole, ...TenantRole[]]),
});

export const GET = tenantRoute("platform:team:read", async ({ db }) => {
  return apiOk({ items: await listInvitations(db) });
});

/**
 * Invite somebody by address and role.
 *
 * THE EMAIL IS NOT PROOF OF ANYTHING, and this route says so in its response
 * rather than pretending. There is no mail transport on the platform yet, so it
 * returns the join link once and reports `delivery: "none"` — the same stance
 * the AI surface takes with its 501: state the absence, do not simulate the
 * feature. A caller that renders `delivery` gets a screen which stops showing
 * "copy this link" by itself on the day a transport is configured.
 *
 * The address is not verified either, and cannot be from here. Whoever follows
 * the link is whoever received it; the invitation carries a role, not an
 * identity. That is why the token is 32 random bytes and why it expires.
 */
export const POST = tenantRoute("platform:team:write", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const actor = session.auth!;
  const ceiling = assignableRoleError(actor.role, parsed.data.role);
  if (ceiling) return apiError(ceiling.status, ceiling.code, ceiling.message);

  const email = normaliseEmail(parsed.data.email);
  const tenantId = actor.tenantId;

  /* Already here?
   *
   * `User` carries no tenantId and no policy, so this read resolves a global
   * identity; the membership read immediately after is what asks the
   * tenant-scoped question, and it is scoped by the binding rather than by a
   * filter. Refusing here is not an information leak: the caller holds
   * `platform:team:write` for this tenant and can list its members anyway. */
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    const member = await db.membership.findFirst({ where: { userId: existing.id } });
    if (member) {
      return apiError(409, "ALREADY_MEMBER", "That person is already on this team.");
    }
  }

  /* One row per address per tenant — `@@unique([tenantId, email])`.
   *
   * So a second invitation to the same person REPLACES the first rather than
   * inserting beside it, and the only case that must not replace is one that is
   * still live. Read, decide, then write, all on the client `withTenant` opened,
   * so the check and the write are one transaction and cannot interleave with a
   * second invite of the same address. */
  const prior = await db.invitation.findUnique({
    where: { tenantId_email: { tenantId, email } },
  });
  if (prior && invitationState(prior) === "open") {
    return apiError(409, "ALREADY_INVITED", "That address already has an open invitation.");
  }

  const token = newInvitationToken();
  const data = {
    role: parsed.data.role,
    token,
    invitedByUserId: session.user.id,
    expiresAt: invitationExpiry(),
    // A replaced invitation is a NEW one: whatever the old row settled into —
    // revoked, expired, or accepted and then the membership removed — must not
    // survive onto the row the new token points at.
    acceptedAt: null,
    revokedAt: null,
  };

  const invitation = prior
    ? await db.invitation.update({ where: { id: prior.id }, data })
    : await db.invitation.create({ data: { tenantId, email, ...data } });

  await db.auditEvent.create({
    data: {
      tenantId,
      userId: session.user.id,
      product: PLATFORM_PRODUCT,
      entity: "invitation",
      entityId: invitation.id,
      action: prior ? "reissue" : "create",
      // The address and the role, never the token. An audit table is append-only
      // and readable by everyone who can read the audit log; a live credential in
      // it can never be withdrawn.
      payload: { email, role: parsed.data.role },
    },
  });

  const path = joinPath(token);
  return apiOk(
    {
      id: invitation.id,
      email,
      role: invitation.role,
      state: invitationState(invitation),
      expiresAt: invitation.expiresAt,
      /* Returned HERE and nowhere else, ever again — see `listInvitations`. */
      token,
      path,
      url: new URL(path, req.url).toString(),
      delivery: "none",
    },
    { status: 201 },
  );
});
