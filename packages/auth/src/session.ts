import crypto from 'node:crypto';

import { asPlatform, withTenant, withUser } from '@landingos/db';
import type { AuthContext, TenantRole } from './rbac.ts';

/* =============================================================================
 * Sessions (M-09) — opaque and server-side, not a stateless JWT.
 *
 * The architecture's decision, and the ERP's reasoning was right: suspending a
 * team member has to revoke access IMMEDIATELY, and in a product whose headline
 * feature is team management that is a daily operation rather than an edge
 * case. A stateless seven-day token means a dismissed employee keeps working
 * access for up to a week.
 *
 * Only the SHA-256 of the token is stored. The raw value exists once, in the
 * response that issues it, so a database leak cannot be replayed as a live
 * login.
 *
 * The cost is honest: authentication needs a database read, so it cannot run on
 * Next's Edge runtime. That is a real deployment consequence and was accepted
 * when the decision was made.
 * ========================================================================== */

export const SESSION_COOKIE = 'landingos_session';

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 24 * 14) * 3600 * 1000;

/* lastSeenAt was written on EVERY authenticated request in the ERP — an UPDATE
 * per API call, pure write contention for a field nobody reads more precisely
 * than "roughly when". Once every few minutes is plenty. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Issue a session. Returns the RAW token — the only time it exists in this
 * process. Only its hash is persisted.
 */
export async function createSession(
  userId: string,
  activeTenantId: string | null,
  meta: SessionMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await asPlatform().session.create({
    data: {
      id: sha256(raw),
      userId,
      activeTenantId,
      expiresAt,
      userAgent: (meta.userAgent ?? '').slice(0, 300) || null,
      ip: (meta.ip ?? '').slice(0, 64) || null,
    },
  });

  return { token: raw, expiresAt };
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly user: { id: string; email: string; name: string; locale: string | null; mustChangePassword: boolean };
  readonly tenant: { id: string; slug: string; name: string; locale: string; currency: string } | null;
  readonly auth: AuthContext | null;
  /** Every tenant this user belongs to — the tenant switcher reads this. */
  readonly memberships: readonly { tenantId: string; tenantSlug: string; tenantName: string; role: TenantRole }[];
}

/**
 * Resolve a raw token to a live session, or null.
 *
 * Re-reads the user, membership and subscription on EVERY request rather than
 * trusting what was true at login. That is what makes suspending an account,
 * changing a role, or a subscription lapsing take effect on the next call
 * instead of whenever the session happens to expire.
 */
export async function resolveSession(rawToken: string | null | undefined): Promise<ResolvedSession | null> {
  if (!rawToken) return null;
  const db = asPlatform();
  const id = sha256(rawToken);

  /* Read in three steps, each with the narrowest binding that can serve it.
   *
   * A single nested include would be simpler to write and would return
   * nothing: Membership and Subscription are tenant-scoped, and this query
   * runs before any tenant is known. Reading them unbound yields zero rows —
   * silently, because RLS denies by returning nothing rather than erroring. */

  // 1. Identity. Session and User carry no tenantId and no policy.
  const row = await db.session.findUnique({ where: { id }, include: { user: true } });
  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id } }).catch(() => {});
    return null;
  }

  const user = row.user;
  if (!user || user.deletedAt) {
    // Orphaned session: the token verifies but names a user who is gone. Clean
    // it up rather than leaving a cookie that fails every request forever.
    await db.session.delete({ where: { id } }).catch(() => {});
    return null;
  }

  // 2. Memberships, bound to this user. Membership's self-visibility policy is
  //    what makes this readable without already knowing a tenant.
  const rows = await withUser(user.id, (tx) =>
    (tx as any).membership.findMany({ include: { tenant: true } }),
  );

  const live = rows.filter((m: any) => !m.tenant.deletedAt);
  const memberships = live.map((m: any) => ({
    tenantId: m.tenantId,
    tenantSlug: m.tenant.slug,
    tenantName: m.tenant.name,
    role: m.role as TenantRole,
  }));

  let active = row.activeTenantId
    ? live.find((m: any) => m.tenantId === row.activeTenantId)
    : undefined;

  /* SELF-HEALING: a session bound to a tenant this user can no longer reach.
   *
   * Removing a membership deliberately does not destroy sessions — but a
   * surviving session then carried an activeTenantId that matched nothing,
   * resolved to `tenant: null, products: []`, and rendered a dead console
   * captioned "No products are enabled for this company" with no switcher to
   * escape by (observed in production: the demo owner's sessions still bound
   * to a tenant she had been removed from). A binding the user can no longer
   * hold falls back to their first live membership, and the correction is
   * PERSISTED so the healed state is what every later request reads. A user
   * with no memberships at all keeps tenant: null — that state is real and
   * the front door now says it honestly. */
  if (!active && live.length > 0) {
    active = live[0];
    await db.session
      .update({ where: { id }, data: { activeTenantId: active.tenantId } })
      .catch(() => {});
  }

  let tenant: ResolvedSession['tenant'] = null;
  let auth: AuthContext | null = null;

  if (active) {
    tenant = {
      id: active.tenant.id,
      slug: active.tenant.slug,
      name: active.tenant.name,
      locale: active.tenant.locale,
      currency: active.tenant.currency,
    };

    // 3. Tenant data. Now a tenant IS known, so this binds properly.
    const subscription = await withTenant(active.tenantId, (tx) =>
      (tx as any).subscription.findUnique({ where: { tenantId: active.tenantId } }),
    );

    auth = {
      userId: user.id,
      tenantId: active.tenantId,
      role: active.role as TenantRole,
      permissions: Array.isArray(active.permissions) ? (active.permissions as string[]) : [],
      // A SUSPENDED tenant loses access while its data and sessions survive —
      // the same distinction the ERP drew for a suspended agent.
      entitlements:
        active.tenant.status === 'ACTIVE' && Array.isArray(subscription?.entitlements)
          ? (subscription!.entitlements as string[])
          : [],
      suspended: active.suspended || active.tenant.status !== 'ACTIVE',
    };
  }

  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  return {
    sessionId: id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      mustChangePassword: user.mustChangePassword,
    },
    tenant,
    auth,
    memberships,
  };
}

/** Switch which tenant a session is acting as. Refuses a tenant the user is not a member of. */
export async function switchTenant(rawToken: string, tenantId: string): Promise<boolean> {
  const db = asPlatform();
  const id = sha256(rawToken);
  const row = await db.session.findUnique({ where: { id } });
  if (!row) return false;

  // Bound to the user, for the same reason resolveSession is: the check is
  // "is this person a member here", which cannot presume the tenant.
  const membership = await withUser(row.userId, (tx) =>
    (tx as any).membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: row.userId } },
    }),
  );
  // Without this the switcher would be a way to act as any tenant by id.
  if (!membership) return false;

  await db.session.update({ where: { id }, data: { activeTenantId: tenantId } });
  return true;
}

export async function destroySession(rawToken: string): Promise<void> {
  await asPlatform().session.delete({ where: { id: sha256(rawToken) } }).catch(() => {});
}

/** Revoke every session for a user — password change, suspension, "sign out everywhere". */
export async function destroySessionsForUser(userId: string): Promise<number> {
  const { count } = await asPlatform().session.deleteMany({ where: { userId } });
  return count;
}

/** Housekeeping: drop sessions that have already expired. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await asPlatform().session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

/** Cookie attributes. Centralised so a flag is never forgotten on one path. */
export function sessionCookieOptions(secure = process.env.NODE_ENV === 'production') {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
