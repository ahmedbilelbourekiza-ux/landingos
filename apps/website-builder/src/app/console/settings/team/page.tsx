import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { can, type TenantRole } from "@landingos/auth";
import { withTenant } from "@landingos/db";

import { requireConsoleSession } from "@/lib/console/session";
import { actionErrors } from "@/lib/console/action-errors";
import { teamStrings } from "@/lib/console/platform-strings";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { TeamScreen } from "@/components/console/platform/team-screen";
import type { WriteOption } from "@/components/console/edit-field";
import {
  ASSIGNABLE_ROLES,
  listInvitations,
  listMembers,
  roleRank,
  type TeamMember,
  type TeamInvitation,
} from "@/lib/platform/team";

export const dynamic = "force-dynamic";

/* =============================================================================
 * /console/settings/team — Phase 7.1c.
 *
 * The team management screen. Gated on `platform:team:read` (SENSITIVE — no role
 * glob reaches it, so OWNER and ADMIN hold it through a bare `*` and everybody
 * else needs it by name). A MANAGER running a call centre day to day does not
 * see this page at all.
 *
 * D-06.2 in full force: the write controls are rendered ONLY where the API would
 * accept them. The page computes, server-side, three things per row and passes
 * them down so the client cannot offer a control that would be refused:
 *
 *   - `isSelf` / `isOwner` — nobody acts on their own membership here (D-07.4),
 *     and the owner is immutable by anybody (the ERP's "last manager" rule).
 *   - `grantableRoles` — the subset of `ASSIGNABLE_ROLES` THIS actor can grant,
 *     filtered by ceiling (`ROLE_ABOVE_SELF`). An empty list means the actor
 *     cannot change this member's role at all, and the control is absent.
 *
 * `canWrite` gates the whole write surface. A reader (read granted by name, no
 * write) sees the list with no controls — the same way the ERP's carriers page
 * reads-only for an agent who holds no carrier route.
 * ========================================================================== */

export default async function TeamSettingsPage() {
  const session = await requireConsoleSession("/console/settings/team");

  // `platform:team:read` is SENSITIVE. 404, not 403 — confirming a screen exists
  // is itself information, and a URL is typeable.
  if (!session.auth || !can(session.auth, "platform:team:read")) notFound();

  const t = await getTranslations();
  const tenantId = session.auth!.tenantId;
  const actorRole = session.auth!.role as TenantRole;
  const actorUserId = session.user.id;

  // The members and invitations lists, read through the bound client. The routes
  // serve these shapes; the page reads the helpers directly (no second HTTP hop)
  // because it already holds the tenant binding `withTenant` provides.
  const { members, invitations } = await readTeam(tenantId);

  const canWrite = can(session.auth!, "platform:team:write");

  // The role vocabulary, translated once. OWNER is deliberately absent — the
  // API never hands it out (D-07.1) and a select offering it would be a lie.
  const roles: WriteOption[] = ASSIGNABLE_ROLES.map((value) => ({
    value,
    label: t(`join.role.${value}`),
  }));

  const errors = actionErrors(t);
  const s = teamStrings(t);

  // Per-member flags + grantable roles, computed server-side (D-06.2).
  const memberRows = members.map((m) => {
    // A member already above the actor's ceiling cannot have their role changed
    // by this actor at all — `ROLE_ABOVE_SELF` would refuse every option. The
    // control is absent, not merely empty. (The owner is caught here too, since
    // OWNER ranks above everything; `isOwner` also withholds suspend/remove.)
    const memberAboveActor = roleRank(m.role) > roleRank(actorRole);
    return {
      userId: m.userId,
      email: m.email,
      name: m.name,
      role: m.role,
      suspended: m.suspended,
      joinedAt: m.joinedAt.toISOString(),
      isSelf: m.userId === actorUserId,
      isOwner: m.role === "OWNER",
      // The roles THIS actor may grant: every assignable role whose rank does
      // not exceed the actor's own. ROLE_ABOVE_SELF is unreachable from the
      // select. Empty when the member is above the actor — and an empty list
      // means the role-change control is not rendered at all.
      grantableRoles: memberAboveActor
        ? []
        : roles.filter((r) => roleRank(r.value as TenantRole) <= roleRank(actorRole)),
    };
  });

  // Invitations with translated state labels. The one-time path is attached
  // only to open invitations the actor just issued — the list never carries a
  // token (D-07.3), so `path` is undefined for rows read here and the link
  // control simply does not render for them.
  const invitationRows = invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    state: inv.state,
    stateLabel: t(`team.states.${inv.state}`),
    // No token on the list — a link that reads "invitation link" only appears
    // for a row the issuer created this render, which this server read does not
    // surface. Revocation is the recovery path for a mislaid link.
    path: undefined as string | undefined,
  }));

  return (
    <ConsoleShell session={session} productId={null}>
      <PageBody>
      <PageHeader title={t("team.title")} description={t("team.description")} />

      <div className="mt-6">
        <TeamScreen
          members={memberRows}
          invitations={invitationRows}
          roles={roles}
          canWrite={canWrite}
          errors={errors}
          s={s}
        />
      </div>
      </PageBody>
    </ConsoleShell>
  );
}

/**
 * Read members and invitations through the tenant binding.
 *
 * Uses the same helpers the routes use (`listMembers`, `listInvitations`) so the
 * page and the API cannot disagree about shape. `withTenant` opens one
 * transaction; both reads run inside it.
 */
async function readTeam(tenantId: string): Promise<{
  members: TeamMember[];
  invitations: TeamInvitation[];
}> {
  return withTenant(tenantId, async (db) => ({
    members: await listMembers(db),
    invitations: await listInvitations(db),
  }));
}
