import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { withTenant, type TenantDb } from "@landingos/db";
import { can } from "@landingos/auth";
import { getConsoleSession, type ConsoleSession } from "@/lib/console/session";

/* =============================================================================
 * The one abstraction Phase 4.4 introduces.
 *
 * Every console API route needs the same four things: resolve the platform
 * session, refuse without an active tenant, check a permission, and run the
 * work bound to that tenant. Written out thirty times that is thirty chances to
 * forget the binding — and forgetting it does not fail loudly, it returns an
 * empty list, because row-level security denies by returning no rows.
 *
 * PRODUCT-AGNOSTIC BY CONSTRUCTION. The permission is a parameter and nothing
 * here knows which products exist. `tenantRoute('erp:orders:read', ...)` is the
 * same call as `tenantRoute('website-builder:pages:write', ...)`, and a tenth
 * product uses it unchanged. The entitlement half of the check lives in
 * @landingos/auth, which resolves a permission to its product through the
 * registry — so a route for a product the tenant has not bought is refused
 * without this file knowing anything about subscriptions.
 *
 * It lives in the app rather than a package because it depends on Next's
 * request types. When Phase 5 brings the ERP into this same app it uses this
 * directly; a second Next app is what would justify extracting it.
 * ========================================================================== */

export interface RouteContext<P> {
  /** Bound to the caller's active tenant. Cannot see another tenant's rows. */
  readonly db: TenantDb;
  readonly session: ConsoleSession;
  readonly req: NextRequest;
  readonly params: P;
  /** Convenience for the common `?page=&search=` shape. */
  readonly searchParams: URLSearchParams;
}

type Handler<P> = (ctx: RouteContext<P>) => Promise<Response> | Response;

/** The error envelope every console route returns, so clients parse one shape. */
export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

/**
 * Wrap a console route handler.
 *
 * @param permission  e.g. "website-builder:pages:write". Checked against role,
 *                    explicit grants AND the tenant's entitlements.
 */
export function tenantRoute<P = Record<string, never>>(
  permission: string,
  handler: Handler<P>,
) {
  return async (req: NextRequest, ctx?: { params?: Promise<P> }) => {
    const session = await getConsoleSession();

    // 401 and 403 are different answers to different questions, and collapsing
    // them would make "sign in again" the advice for a permissions problem.
    if (!session) {
      return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (!session.auth) {
      return apiError(
        403,
        "NO_ACTIVE_TENANT",
        "Choose a company before using this feature.",
      );
    }
    if (!can(session.auth, permission)) {
      // Deliberately does not say whether the reason is the role or the
      // subscription. Both are "you cannot do this here", and distinguishing
      // them tells a caller what a tenant has bought.
      return apiError(403, "FORBIDDEN", "You do not have access to this.");
    }

    const params = ((await ctx?.params) ?? {}) as P;
    const searchParams = new URL(req.url).searchParams;

    try {
      return await withTenant(session.auth.tenantId, (db) =>
        Promise.resolve(handler({ db, session, req, params, searchParams })),
      );
    } catch (error) {
      // A thrown handler must not leak a stack trace or a SQL fragment to the
      // client. The detail goes to the log, where it is useful.
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}`, error);
      return apiError(500, "INTERNAL_ERROR", "Something went wrong.");
    }
  };
}

/** Parse and clamp pagination. A caller asking for 100000 rows gets 100. */
export function pagination(searchParams: URLSearchParams, defaultSize = 25) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const raw = Number(searchParams.get("pageSize")) || defaultSize;
  const pageSize = Math.min(100, Math.max(1, raw));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
