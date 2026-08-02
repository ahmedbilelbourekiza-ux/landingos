import { productRegistry } from '@landingos/product-registry';

/* =============================================================================
 * Authorization (S-03).
 *
 * Replaces two systems that could not survive multi-tenancy: the ERP's binary
 * accountRole (agent | manager) enforced by a regex table over URL paths, and
 * the builder's everything-or-nothing single admin.
 *
 * THREE GATES, and a permission must clear all of them:
 *
 *   1. Entitlement — does the tenant's subscription include the product this
 *      permission belongs to? An ADMIN of a tenant that never bought the ERP
 *      has no business reaching an ERP permission, whatever their role says.
 *      This is what ties authorization to billing instead of leaving the two
 *      to drift.
 *
 *   2. Role — the patterns the role grants.
 *
 *   3. Explicit grant — anything on the membership itself, for the cases a
 *      role does not describe.
 *
 * Putting entitlement FIRST is deliberate. Checking role first and entitlement
 * later is how a downgrade leaves someone quietly holding access to a product
 * their company stopped paying for.
 *
 * Permissions are declared by products, never listed here — the registry is
 * the source of truth, so a tenth product brings its own vocabulary.
 * ========================================================================== */

export type TenantRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER';

/**
 * What each role grants, as glob patterns over `product:resource:action`.
 *
 * MANAGER deliberately stops short of team administration: running a
 * call-centre day to day is a different thing from deciding who works there,
 * and conflating them is how a shift lead ends up able to remove the owner.
 */
const ROLE_PATTERNS: Record<TenantRole, readonly string[]> = {
  OWNER: ['*'],
  ADMIN: ['*'],
  MANAGER: ['*:read', '*:*:read', '*:*:write', '*:*:publish'],
  MEMBER: ['*:read', '*:*:read'],
  VIEWER: ['*:read', '*:*:read'],
};

/**
 * Permissions no role grants implicitly — they must be granted explicitly on
 * the membership, or held by OWNER/ADMIN via `*`.
 *
 * These are the ones where "probably fine" is the wrong default: managing who
 * else has access, and spending money.
 */
const SENSITIVE = ['*:agents:manage', 'platform:billing:*', 'platform:team:*'];

export interface AuthContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: TenantRole;
  /** Extra permissions granted on the membership. */
  readonly permissions: readonly string[];
  /** Entitlement keys the tenant's subscription holds. */
  readonly entitlements: readonly string[];
  readonly suspended?: boolean;
}

/** Glob match over colon-separated permission segments. `*` matches one segment. */
function matches(pattern: string, permission: string): boolean {
  if (pattern === '*') return true;
  const p = pattern.split(':');
  const s = permission.split(':');
  if (p.length !== s.length) return false;
  return p.every((seg, i) => seg === '*' || seg === s[i]);
}

/**
 * The product a permission belongs to, or null for a platform permission.
 * `erp:orders:read` → the product whose id is `erp`.
 */
export function productOf(permission: string): string | null {
  const head = permission.split(':')[0];
  if (head === 'platform') return null;
  return productRegistry.has(head) ? head : null;
}

/**
 * Is this permission's product enabled for the tenant?
 *
 * Platform permissions and permissions belonging to no registered product are
 * not gated here — an unknown product would otherwise be silently permitted or
 * silently denied depending on which way the default fell, and both are worse
 * than letting the role check decide.
 */
export function isEntitled(permission: string, entitlements: readonly string[]): boolean {
  const product = productOf(permission);
  if (!product) return true;
  return productRegistry.isEnabled(product, entitlements);
}

/** The decision. */
export function can(ctx: AuthContext, permission: string): boolean {
  // A suspended member keeps their session but loses access on the very next
  // request. This is the whole reason sessions are server-side rather than a
  // stateless token (M-09).
  if (ctx.suspended) return false;

  if (!isEntitled(permission, ctx.entitlements)) return false;

  if (ctx.permissions.some((granted) => matches(granted, permission))) return true;

  const sensitive = SENSITIVE.some((s) => matches(s, permission));
  const patterns = ROLE_PATTERNS[ctx.role] ?? [];
  if (sensitive) {
    // Only a bare `*` — OWNER or ADMIN — reaches a sensitive permission by
    // role alone. Everyone else needs it granted by name.
    return patterns.includes('*');
  }
  return patterns.some((pattern) => matches(pattern, permission));
}

/** Throwing form, for route handlers. */
export class ForbiddenError extends Error {
  readonly permission: string;
  constructor(permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = 'ForbiddenError';
    this.permission = permission;
  }
}

export function requirePermission(ctx: AuthContext, permission: string): void {
  if (!can(ctx, permission)) throw new ForbiddenError(permission);
}

/**
 * Every permission this context actually holds, resolved against the products
 * the tenant is entitled to. Used by the shell to filter navigation, and by
 * the roles UI to show what a role means.
 */
export function grantedPermissions(ctx: AuthContext): string[] {
  return productRegistry
    .allPermissions()
    .filter((p) => can(ctx, p))
    .sort();
}

/** Products this context can actually reach: entitled AND permitted. */
export function accessibleProducts(ctx: AuthContext) {
  return productRegistry
    .enabledFor(ctx.entitlements)
    .filter((product) =>
      // A product with no permission the user holds is a tab that leads to
      // nothing but 403s, so it does not belong in the switcher.
      product.permissions.some((p) => can(ctx, p)),
    );
}

export const ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];
