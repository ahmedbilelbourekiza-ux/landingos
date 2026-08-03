import "server-only";

import crypto from "node:crypto";

import { ROLES, type TenantRole } from "@landingos/auth";
import type { TenantDb } from "@landingos/db";

/* =============================================================================
 * Team management — Phase 7.1.
 *
 * A PLATFORM service, for the same reason notifications and settings are: a
 * tenant running ten products still has ONE list of people. `packages/product-
 * registry` already refuses a product nav item called `team`, and this is the
 * other half of that rule — `POST /api/erp/agents` has answered 501 with "team
 * members are invited from company settings, not from a product" since Phase 5.3
 * (M-02), and until now that sentence named a screen that did not exist.
 *
 * Everything here is stated as a rule over roles, never over product data. The
 * ERP's `agents` screen still owns pay rates, days off and the JOB role
 * (`confirmation | followup | both`); this owns who exists and what privilege
 * they hold. The two are deliberately separate — the ERP kept them separate so a
 * follow-up agent could also be a manager, and collapsing them here would undo
 * that.
 *
 * -----------------------------------------------------------------------------
 * WHY EVERY GUARD RETURNS A REFUSAL RATHER THAN THROWING
 *
 * Each of the rules below has a distinct code, and the routes turn a refusal
 * into exactly that code. A test that violates a rule can then assert WHICH rule
 * refused it — "403" alone would pass against a route that happens to refuse for
 * the wrong reason, which is how a permission gate quietly becomes the only
 * thing standing between an ADMIN and the owner's account.
 * ========================================================================== */

/** The product id these audit rows carry. Not a registry product — the platform. */
export const PLATFORM_PRODUCT = "platform";

/** How long an invitation link is good for. */
export const INVITATION_TTL_DAYS = 7;

/**
 * The roles this API may grant. OWNER is deliberately absent.
 *
 * `Tenant` has exactly one owner and the schema says so in a comment rather than
 * a constraint, so "assign OWNER" would silently produce two — both holding `*`,
 * neither removable, and no way back without a database edit. Transferring
 * ownership is a separate, deliberate operation with its own confirmation, and it
 * is not this. Excluding the value here means the "exactly one" invariant is held
 * by the vocabulary instead of by a count query that races itself.
 */
export const ASSIGNABLE_ROLES: readonly TenantRole[] = ["ADMIN", "MANAGER", "MEMBER", "VIEWER"];

/**
 * Seniority, highest first — the order `ROLES` is already declared in.
 *
 * Derived rather than written down a second time: a role added to the platform
 * takes its place here by being declared, not by somebody remembering to update
 * a list in another file.
 */
export function roleRank(role: TenantRole): number {
  const i = ROLES.indexOf(role);
  // An unknown string ranks below everything rather than above it. A role that
  // fell out of the enum must not become a promotion.
  return i === -1 ? -1 : ROLES.length - i;
}

export interface TeamRefusal {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/* -----------------------------------------------------------------------------
 * The rules
 * -------------------------------------------------------------------------- */

/**
 * May this actor hand out this role?
 *
 * Two refusals, and they are different questions. OWNER is not a role anybody
 * may assign at all; every other role is assignable only up to the actor's own
 * seniority. Without the second, `platform:team:write` is a route to OWNER: a
 * MANAGER granted the permission by name — which is the whole point of a
 * SENSITIVE permission being grantable — could invite themselves an ADMIN
 * account and sign in as it.
 */
export function assignableRoleError(
  actorRole: TenantRole,
  role: TenantRole,
): TeamRefusal | null {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return {
      status: 422,
      code: "UNASSIGNABLE_ROLE",
      message: "Ownership is transferred, not assigned.",
    };
  }
  if (roleRank(role) > roleRank(actorRole)) {
    return {
      status: 403,
      code: "ROLE_ABOVE_SELF",
      message: "You cannot give somebody more access than you have.",
    };
  }
  return null;
}

/**
 * May this actor act on this member at all?
 *
 * Two rules that hold before any permission is consulted, because both are about
 * WHO the target is rather than what the actor may do:
 *
 *   - **The owner cannot be demoted, suspended or removed by anybody**,
 *     themselves included. A tenant with no owner has nobody who can restore one.
 *     The ERP's "last manager" protection is this same rule one generation
 *     earlier, and it existed because the ERP had been locked out of a tenant by
 *     exactly this.
 *
 *   - **Nobody may act on their own membership here.** It reads as three
 *     separate foot-guns — promoting yourself, suspending yourself, removing
 *     yourself — and is one rule: a team screen is for administering OTHER
 *     people. Leaving a company is a real operation and a different one; it
 *     belongs to the person, with its own confirmation, not to a row in a list
 *     of colleagues.
 */
export function targetMemberError(
  actorUserId: string,
  target: { userId: string; role: TenantRole },
): TeamRefusal | null {
  if (target.role === "OWNER") {
    return {
      status: 409,
      code: "OWNER_IMMUTABLE",
      message: "The owner of a company cannot be changed here.",
    };
  }
  if (target.userId === actorUserId) {
    return {
      status: 409,
      code: "SELF_TARGET",
      message: "You cannot change your own membership here.",
    };
  }
  return null;
}

/* -----------------------------------------------------------------------------
 * Invitations
 * -------------------------------------------------------------------------- */

/**
 * The link's secret half.
 *
 * Same shape and same size as a session token, for the same reason: it is
 * followed from an email with no session and no tenant bound, so possession of
 * it IS the claim. 32 random bytes, base64url so it survives a URL.
 */
export function newInvitationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Addresses are compared case-insensitively; a display form is not identity. */
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export type InvitationState = "open" | "accepted" | "revoked" | "expired";

/**
 * What state an invitation row is in.
 *
 * Order matters: an accepted invitation that has since passed its expiry is
 * ACCEPTED, not expired — the membership it produced is real and the row is now
 * a record of how it happened.
 */
export function invitationState(row: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitationState {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return "open";
}

export const invitationExpiry = () =>
  new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

/* -----------------------------------------------------------------------------
 * Reads
 * -------------------------------------------------------------------------- */

export interface TeamMember {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: TenantRole;
  readonly jobRole: string | null;
  readonly suspended: boolean;
  readonly permissions: readonly string[];
  readonly joinedAt: Date;
}

/**
 * Everybody in this tenant.
 *
 * No `where` clause and none is wanted: `db` is bound, and row-level security is
 * what scopes this. Adding `where: { tenantId }` would be a second, weaker copy
 * of a rule the database already enforces.
 */
export async function listMembers(db: TenantDb): Promise<TeamMember[]> {
  const rows = await db.membership.findMany({
    include: { user: { select: { email: true, name: true, deletedAt: true } } },
    orderBy: { createdAt: "asc" },
  });

  return rows
    // A soft-deleted user keeps their membership rows so history stays readable,
    // but they are not a person on the team any more.
    .filter((m) => !m.user.deletedAt)
    .map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role as TenantRole,
      jobRole: m.jobRole,
      suspended: m.suspended,
      permissions: Array.isArray(m.permissions) ? (m.permissions as string[]) : [],
      joinedAt: m.createdAt,
    }));
}

/**
 * One member of THIS tenant, or null.
 *
 * `findFirst` on the bound client rather than a compound lookup naming
 * `tenantId`: the tenant is already bound and the database is what scopes the
 * read. Somebody who belongs to another company therefore resolves to null and
 * the route answers 404 — never 403, because "you may not touch that" confirms
 * the row exists.
 */
export function loadMember(db: TenantDb, userId: string) {
  return db.membership.findFirst({ where: { userId } });
}

export interface TeamInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: TenantRole;
  readonly state: InvitationState;
  readonly invitedByUserId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * Every invitation this tenant has issued — **without its token**.
 *
 * The token is returned exactly once, by the call that creates it, the way
 * `createSession` returns a raw session token once and stores only its hash.
 * There is no email transport yet, so the link IS the delivery mechanism, and a
 * list endpoint that hands it back turns "who have we invited?" — a question a
 * team screen answers on every page load — into a live credential in a response
 * body, a log and a browser cache.
 *
 * The recovery path when somebody loses a link is revoke, then invite again.
 * That is two clicks and it produces a NEW token, which is the correct outcome:
 * a link that has been mislaid is a link that may have been seen.
 */
export async function listInvitations(db: TenantDb): Promise<TeamInvitation[]> {
  const rows = await db.invitation.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role as TenantRole,
    state: invitationState(r),
    invitedByUserId: r.invitedByUserId,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

/** Where an invitation is accepted. Built in one place so the email and the screen agree. */
export const joinPath = (token: string) => `/console/join/${token}`;
