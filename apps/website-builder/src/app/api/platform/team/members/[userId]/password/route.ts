import { z } from "zod";

import { asPlatform } from "@landingos/db";
import { hashPassword, destroySessionsForUser } from "@landingos/auth";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadMember, targetMemberError, PLATFORM_PRODUCT } from "@/lib/platform/team";

export const dynamic = "force-dynamic";

type Params = { userId: string };

/* =============================================================================
 * A manager sets a locked-out colleague's password — LP.12, restoring R15.
 *
 * There was self-service change and nothing else: **no reset, and no
 * forgot-password flow.** A locked-out agent could not be recovered by anybody,
 * which in a call centre is a weekly event and turns into "somebody edits the
 * database" the first time it happens on a busy morning.
 *
 * -----------------------------------------------------------------------------
 * D-LP.12.1 — THIS ONE DOES DESTROY SESSIONS, AND SUSPENSION DELIBERATELY DOES
 * NOT
 *
 * D-07.2 says suspending a member must NOT call `destroySessionsForUser`,
 * because that function is keyed on the PERSON and one person belongs to many
 * companies — signing a consultant out of an unrelated employer to suspend them
 * here would be wrong.
 *
 * A password reset is the opposite case, for the same reason. The credential is
 * global: it is how that person proves who they are to every company they
 * belong to. Changing it and leaving old sessions alive would mean the person
 * who forgot the password still cannot get in while whoever was already signed
 * in on a shared handset stays signed in — which is precisely backwards, since
 * "somebody else has my session" is one of the reasons a reset gets asked for.
 * So every session goes, everywhere, and the screen says so before the click.
 *
 * -----------------------------------------------------------------------------
 * THE GUARDS ARE THE TEAM SURFACE'S OWN
 *
 * `targetMemberError` — the owner is immutable and nobody acts on their own
 * membership here. Changing your own password is `/console/settings/profile`,
 * which asks for the CURRENT one; this route does not, which is exactly why it
 * must not be reachable against yourself.
 *
 * The new password is never echoed, never logged, and never lands in the audit
 * payload — only that a reset happened, by whom, to whom.
 * ========================================================================== */

const NewPassword = z.object({
  // The same floor `signup` and the profile screen use. A reset is not the
  // place to relax it: it is a password somebody else chose for you and will
  // very likely keep.
  password: z.string().min(12).max(200),
});

export const POST = tenantRoute<Params>("platform:team:write", async ({ db, req, params, session }) => {
  const member = await loadMember(db, params.userId);
  // 404, never 403 — a member of another company must not be distinguishable
  // from one who does not exist.
  if (!member) return apiError(404, "NOT_FOUND", "No such team member.");

  const refusal = targetMemberError(session.user.id, {
    userId: member.userId,
    role: member.role,
  });
  if (refusal) return apiError(refusal.status, refusal.code, refusal.message);

  const parsed = NewPassword.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", "A password of at least 12 characters is required.");
  }

  // `User` is global identity and carries no `tenantId`, so it has no RLS and
  // is reached through `asPlatform()` — the same split signup uses. The
  // MEMBERSHIP check above is what made this caller entitled to be here, and it
  // ran inside the binding.
  await asPlatform().user.update({
    where: { id: member.userId },
    data: { passwordHash: await hashPassword(parsed.data.password) },
  });

  // Everywhere, for D-LP.12.1's reason.
  const destroyed = await destroySessionsForUser(member.userId);

  await db.auditEvent.create({
    data: {
      tenantId: session.auth!.tenantId,
      product: PLATFORM_PRODUCT,
      entity: "member",
      entityId: member.userId,
      action: "reset-password",
      userId: session.user.id,
      // What happened, never what it was set to.
      payload: { sessionsDestroyed: destroyed ?? 0 },
    },
  });

  return apiOk({ userId: member.userId, sessionsDestroyed: destroyed ?? 0 });
});
