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
  /**
   * Run work AFTER this request's tenant transaction has committed, and before
   * the response is sent (D-LP.5.1).
   *
   * FOR ONE THING ONLY: talking to somebody else's server. `withTenant` opens an
   * interactive transaction whose timeout is 15 seconds, so a carrier's API
   * called from inside a handler makes a third party's latency able to roll back
   * this tenant's writes. LP.5 hit the sharp end of that: booking a parcel is
   * triggered by CONFIRMING an order, so a slow carrier would undo the fact that
   * an agent rang a customer and the customer said yes.
   *
   * Work registered here runs once the transaction is committed and released, in
   * registration order. Returning a Response replaces the handler's; throwing is
   * logged and leaves the handler's response standing, because the committed
   * work is real whatever happened afterwards.
   *
   * It is NOT a background queue. The response waits for it — an operator who
   * pressed "book the parcel" is owed the answer, not an acknowledgement.
   */
  afterCommit(work: () => Promise<Response | void>): void;
}

type Handler<P> = (ctx: RouteContext<P>) => Promise<Response> | Response;

/**
 * The error envelope every console route returns, so clients parse one shape.
 *
 * `extra` carries machine-readable detail alongside the message — the set of
 * valid call results, the field that was refused. It exists so a console does
 * not have to hardcode a vocabulary the server owns and then drift from it the
 * next time that vocabulary grows. Keep it to data the caller can act on; it is
 * not a place for a stack trace or a SQL fragment.
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { success: false, error: { code, message, ...(extra ?? {}) } },
    { status },
  );
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

    const deferred: Array<() => Promise<Response | void>> = [];
    const afterCommit = (work: () => Promise<Response | void>) => {
      deferred.push(work);
    };

    try {
      let response = await withTenant(session.auth.tenantId, (db) =>
        Promise.resolve(handler({ db, session, req, params, searchParams, afterCommit })),
      );

      // The transaction is committed and its connection released before any of
      // this runs. See `afterCommit` above for why that matters.
      for (const work of deferred) {
        try {
          const replacement = await work();
          if (replacement) response = replacement;
        } catch (error) {
          // Logged, never rethrown: what was committed happened, and turning it
          // into a 500 would tell the caller their confirmed call was not saved.
          console.error(`[api] after-commit ${req.method} ${new URL(req.url).pathname}`, error);
        }
      }

      return response;
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
