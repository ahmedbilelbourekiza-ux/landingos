export {
  hashPassword,
  verifyPassword,
  needsRehash,
  verifyAgainstDecoy,
  PASSWORD_LIMITS,
} from './password.ts';

export {
  SESSION_COOKIE,
  createSession,
  resolveSession,
  switchTenant,
  destroySession,
  destroySessionsForUser,
  destroyOtherSessions,
  purgeExpiredSessions,
  sessionCookieOptions,
  type ResolvedSession,
  type SessionMeta,
} from './session.ts';

export {
  can,
  requirePermission,
  isEntitled,
  productOf,
  grantedPermissions,
  accessibleProducts,
  ForbiddenError,
  ROLES,
  type AuthContext,
  type TenantRole,
} from './rbac.ts';
