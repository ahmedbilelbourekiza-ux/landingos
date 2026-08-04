import type { TeamStrings } from "@/components/console/platform/team-screen";

/* =============================================================================
 * The platform's write-control labels, resolved once per screen.
 *
 * Sibling to `erp-strings.ts`. No directive: the server calls these, the client
 * only receives the result — the same shape every client component in this
 * console has. Splitting platform strings from ERP strings keeps the import
 * graph honest: a settings screen that owns nothing ERP-specific should not pull
 * the ERP's string bundle to reach one label.
 * ========================================================================== */

export function teamStrings(t: (key: string) => string): TeamStrings {
  return {
    saving: t("common.saving"),
    save: t("team.save"),
    edit: t("team.edit"),
    cancel: t("team.cancel"),
    you: t("team.you"),
    invite: t("team.invite"),
    inviteTitle: t("team.inviteTitle"),
    email: t("team.email"),
    inviteRole: t("team.inviteRole"),
    sendInvite: t("team.sendInvite"),
    changeRole: t("team.changeRole"),
    suspend: t("team.suspend"),
    reactivate: t("team.reactivate"),
    remove: t("team.remove"),
    removeConfirm: t("team.removeConfirm"),
    revoke: t("team.revoke"),
    copyLink: t("team.copyLink"),
    linkCopied: t("team.linkCopied"),
    invitationLink: t("team.invitationLink"),
  };
}
