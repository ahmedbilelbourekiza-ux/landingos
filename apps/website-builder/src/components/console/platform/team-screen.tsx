"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * The team screen — Phase 7.1c.
 *
 * D-06.1. A CONTROL CALLS THE API ROUTE. Every mutation here already has a
 * route with contract tests in front of it (7.1a): invite, revoke, change role,
 * suspend, reactivate, remove. This component adds NO write path of its own —
 * no server action, no second copy of the permission gate. It calls the routes
 * the contract suite covers.
 *
 * D-06.2. A CONTROL IS RENDERED ONLY WHERE THE API WOULD ACCEPT IT. The refusals
 * the team API makes — `SELF_TARGET`, `OWNER_IMMUTABLE`, `ROLE_ABOVE_SELF` — are
 * unreachable from here, because the controls that would trip them are not
 * rendered. The page computes `isSelf` and `isOwner` server-side and passes them
 * down; `canWrite` gates the whole write surface; the role select only offers
 * the roles the actor can grant (the page filters `assignableRoles` by ceiling).
 *
 * The component takes TRANSLATED STRINGS and VOCABULARIES as props and holds
 * neither — the same shape as every client component in this console.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface TeamStrings {
  readonly resetPassword: string;
  readonly resetPasswordHint: string;
  readonly saving: string;
  readonly save: string;
  readonly edit: string;
  readonly cancel: string;
  readonly you: string;
  readonly invite: string;
  readonly inviteTitle: string;
  readonly email: string;
  readonly inviteRole: string;
  readonly sendInvite: string;
  readonly changeRole: string;
  readonly suspend: string;
  readonly reactivate: string;
  readonly remove: string;
  readonly removeConfirm: string;
  readonly revoke: string;
  readonly copyLink: string;
  readonly linkCopied: string;
  readonly invitationLink: string;
}

/** A member row, as the page resolved it from the API + server-side flags. */
export interface TeamMemberRow {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly suspended: boolean;
  readonly joinedAt: string;
  /** The page computed these — the controls that would trip them are absent. */
  readonly isSelf: boolean;
  readonly isOwner: boolean;
  /** The roles THIS actor may grant to this member (ceiling-filtered). */
  readonly grantableRoles: readonly WriteOption[];
}

/** An invitation row, as the page resolved it. */
export interface TeamInvitationRow {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly state: string;
  readonly stateLabel: string;
  /** Present only for an open invitation — the one-time link, returned at issue. */
  readonly path?: string;
}

export function TeamScreen({
  members,
  invitations,
  roles,
  canWrite,
  errors,
  s,
}: {
  readonly members: readonly TeamMemberRow[];
  readonly invitations: readonly TeamInvitationRow[];
  /** The full assignable vocabulary from the API (OWNER absent by design). */
  readonly roles: readonly WriteOption[];
  readonly canWrite: boolean;
  readonly errors: ActionErrors;
  readonly s: TeamStrings;
}) {
  return (
    <div className="space-y-8">
      {canWrite ? <InvitePanel roles={roles} errors={errors} s={s} /> : null}

      <section data-testid="team-members">
        <ul className="divide-y divide-border rounded-lg border border-border">
          {members.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">{s.email}</li>
          ) : null}
          {members.map((m) => (
            <MemberRow key={m.userId} member={m} canWrite={canWrite} errors={errors} s={s} />
          ))}
        </ul>
      </section>

      {invitations.length > 0 ? (
        <section data-testid="team-invitations">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} canWrite={canWrite} errors={errors} s={s} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function InvitePanel({
  roles,
  errors,
  s,
}: {
  readonly roles: readonly WriteOption[];
  readonly errors: ActionErrors;
  readonly s: TeamStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0]?.value ?? "");

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="team-invite-panel"
    >
      <h2 className="text-sm font-semibold tracking-tight">{s.inviteTitle}</h2>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const { ok } = await run("POST", "/api/platform/team/invitations", { email, role });
          if (ok) {
            setEmail("");
            // The router refresh brings the new invitation row (without its
            // token); the one-time link is shown by the route's response, which
            // a real UI surfaces from `data`. This slice renders the list.
          }
        }}
      >
        <div className="grow">
          <label htmlFor="team-invite-email" className="ui-label block">
            {s.email}
          </label>
          <input
            id="team-invite-email"
            type="email"
            required
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        <div>
          <label htmlFor="team-invite-role" className="ui-label block">
            {s.inviteRole}
          </label>
          <select
            id="team-invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={`mt-1 ${FIELD}`}
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <ActionButton type="submit" pending={pending} pendingLabel={s.saving} variant="primary">
          {s.sendInvite}
        </ActionButton>
      </form>
      <ActionError message={error} />
    </section>
  );
}

function MemberRow({
  member,
  canWrite,
  errors,
  s,
}: {
  readonly member: TeamMemberRow;
  readonly canWrite: boolean;
  readonly errors: ActionErrors;
  readonly s: TeamStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(member.role);

  // D-06.2: the role-change control is offered only where the API would accept
  // it. `ROLE_ABOVE_SELF` and `SELF_TARGET` are unreachable because the page
  // filtered `grantableRoles` by the actor's ceiling and the control is absent
  // for the actor's own row and for the owner.
  const canChangeRole = canWrite && !member.isSelf && !member.isOwner && member.grantableRoles.length > 0;
  const canSuspendOrRemove = canWrite && !member.isSelf && !member.isOwner;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4" data-user-id={member.userId}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{member.name || member.email}</span>
          {member.isSelf ? <span className="text-xs text-muted-foreground">({s.you})</span> : null}
        </div>
        <span className="mt-0.5 block text-xs text-muted-foreground" dir="ltr">{member.email}</span>
        {member.suspended ? (
          <span className="mt-1 inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            ⏸
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {/* The role, shown always; editable only where the API accepts it. */}
        {canChangeRole && editing ? (
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={FIELD}
            data-testid="team-role-select"
          >
            {member.grantableRoles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-muted-foreground">{member.role}</span>
        )}

        {canChangeRole ? (
          <ActionButton
            pending={pending}
            pendingLabel={s.saving}
            onClick={async () => {
              if (editing) {
                const { ok } = await run("PATCH", `/api/platform/team/members/${member.userId}`, { role });
                if (ok) setEditing(false);
              } else {
                setRole(member.role);
                setEditing(true);
              }
            }}
            data-testid="team-role-toggle"
          >
            {editing ? s.save : s.changeRole}
          </ActionButton>
        ) : null}

        {canSuspendOrRemove ? (
          <>
            <ActionButton
              pending={pending}
              pendingLabel={s.saving}
              variant={member.suspended ? "default" : "danger"}
              onClick={() => void run("POST", `/api/platform/team/members/${member.userId}/${member.suspended ? "reactivate" : "suspend"}`)}
              data-testid={member.suspended ? "team-reactivate" : "team-suspend"}
            >
              {member.suspended ? s.reactivate : s.suspend}
            </ActionButton>
            <ActionButton
              pending={pending}
              pendingLabel={s.saving}
              variant="danger"
              onClick={() => {
                if (confirm(s.removeConfirm)) {
                  void run("DELETE", `/api/platform/team/members/${member.userId}`);
                }
              }}
              data-testid="team-remove"
            >
              {s.remove}
            </ActionButton>

            {/* R15. There was self-service change and nothing else — no reset
                and no forgot-password flow — so a locked-out agent could not be
                recovered by anybody, which in a call centre is a weekly event.
                It is behind the same guards as everything else on this row: not
                the owner, and never yourself (changing your own password is
                /console/settings/profile, which asks for the current one).

                D-LP.12.1: this one DOES sign the person out everywhere, unlike
                suspension. The credential is global — it is how they prove who
                they are to every company they belong to — and the warning says
                so before the click rather than after it. */}
            <ActionButton
              pending={pending}
              pendingLabel={s.saving}
              data-testid="team-reset-password"
              data-user-id={member.userId}
              onClick={() => {
                const next = prompt(s.resetPasswordHint);
                if (next) {
                  void run("POST", `/api/platform/team/members/${member.userId}/password`, {
                    password: next,
                  });
                }
              }}
            >
              {s.resetPassword}
            </ActionButton>
          </>
        ) : null}
      </div>

      <ActionError message={error} />
    </li>
  );
}

function InvitationRow({
  invitation,
  canWrite,
  errors,
  s,
}: {
  readonly invitation: TeamInvitationRow;
  readonly canWrite: boolean;
  readonly errors: ActionErrors;
  readonly s: TeamStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  // An open invitation can be revoked; an accepted one cannot (the membership
  // is the thing now — D-07.3). The page sends `state`; we key off it — NOT the
  // path, because the list carries no token (D-07.3) and `path` is undefined
  // for every row read here.
  const canRevoke = canWrite && invitation.state === "open";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4" data-invitation-id={invitation.id}>
      <div className="min-w-0">
        <span className="font-medium" dir="ltr">{invitation.email}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {invitation.role} · {invitation.stateLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {invitation.path ? (
          <a
            href={invitation.path}
            className="text-xs text-muted-foreground underline"
            data-testid="team-invitation-link"
          >
            {s.invitationLink}
          </a>
        ) : null}
        {canRevoke ? (
          <ActionButton
            pending={pending}
            pendingLabel={s.saving}
            variant="danger"
            onClick={() => void run("POST", `/api/platform/team/invitations/${invitation.id}/revoke`)}
            data-testid="team-revoke"
          >
            {s.revoke}
          </ActionButton>
        ) : null}
      </div>
      <ActionError message={error} />
    </li>
  );
}
