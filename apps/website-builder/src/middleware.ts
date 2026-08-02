import { NextRequest, NextResponse } from "next/server";
import { productRegistry } from "@landingos/product-registry";
import {
  verifySession,
  getSessionCookieName,
} from "@/lib/auth/session";

// Authentication & force-password-change enforcement.
//
// DENY-BY-DEFAULT model: every route requires authentication UNLESS it is
// explicitly listed in the public allowlist below. The previous allowlist
// approach (PUBLIC_API_PREFIXES) accidentally made every HTTP method on
// those paths public — including DELETE /api/landings/[id] and
// PUT /api/settings/delivery-prices — because it matched path prefixes
// without considering the method.
//
// Public routes (no auth required):
//   Pages:
//     /                        — storefront homepage
//     /category/*              — storefront category pages
//     /l/*                     — public landing pages (published only)
//     /thank-you/*             — post-checkout thank-you page
//     /login                   — login page
//
//   API GET (storefront reads):
//     GET  /api/public/*       — storefront data API (includes active pixel IDs, no tokens)
//     GET  /api/wilayas        — wilaya list for checkout
//     GET  /api/themes         — theme list
//     GET  /api/settings/delivery-prices — delivery prices for checkout
//     GET  /api/categories     — category list (storefront)
//     GET  /api/health         — health check
//
//   API POST (customer checkout only):
//     POST /api/orders         — customer order submission
//     POST /api/draft-orders   — abandoned-checkout capture (rate-limited)
//                                NOTE: GET on this path stays PROTECTED — it
//                                returns captured customer phone numbers.
//
// Protected (auth required) — everything else:
//   /dashboard/*              — all admin UI
//   /api/auth/*               — auth endpoints
//   /api/settings/store       — store settings (GET + PUT)
//   /api/settings/delivery-prices PUT — admin bulk update
//   /api/settings/meta-pixels — Meta pixel/CAPI configs (GET + POST), contains access tokens
//   /api/settings/meta-pixels/[id] — PATCH/DELETE
//   /api/settings/webhooks    — outgoing CRM webhook endpoints, contains signing secrets
//   /api/settings/webhooks/[id] — PATCH/DELETE
//   /api/landings GET (list)  — admin list
//   /api/landings POST        — admin create
//   /api/landings/[id] GET    — admin detail
//   /api/landings/[id] DELETE — admin delete
//   /api/landings/[id]/* PATCH/PUT/POST — admin section edits
//   /api/categories POST      — admin create
//   /api/categories/[id] PATCH/DELETE — admin edit/delete
//   /api/orders GET           — admin order list (contains PII!)
//   /api/orders/[id] GET/DELETE — admin order detail/delete
//   /api/orders/[id]/status PATCH — admin status update
//
// Force-change flow:
//   If the session JWT carries mustChangePassword=true:
//     - /dashboard/* (except /dashboard/profile) → 307 redirect to /profile
//     - GET /api/auth/me → ALLOWED (Profile page must load admin data)
//     - POST /api/auth/change-password → ALLOWED (escape hatch)
//     - All other protected APIs → 403 MUST_CHANGE_PASSWORD

// Exact (method, path) pairs that are public. Checked before auth.
const PUBLIC_API_ROUTES: { method: string; path: string }[] = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/wilayas" },
  { method: "GET", path: "/api/themes" },
  { method: "GET", path: "/api/settings/delivery-prices" },
  { method: "GET", path: "/api/categories" },
  { method: "POST", path: "/api/orders" }, // customer checkout only
  { method: "POST", path: "/api/draft-orders" }, // abandoned-checkout capture
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/auth/logout" },
  // GET logout clears the cookie and redirects to /login. Public because it is
  // the recovery path out of a broken session — gating it behind auth would
  // mean the states that most need it (orphaned or already-cleared session)
  // could not reach it. It only ever deletes a cookie.
  { method: "GET", path: "/api/auth/logout" },
];

// Path prefixes that are public for GET requests (storefront data reads).
const PUBLIC_GET_PREFIXES = [
  "/api/public/",
  // Uploaded product images. Storefront visitors are not logged in, so these
  // must be readable without auth — same as any static image. The route only
  // ever reads image bytes out of the uploads directory.
  "/api/uploads/",
];

const PUBLIC_PAGE_PREFIXES = [
  "/category/",
  "/l/",
  "/thank-you/",
];

const AUTH_PAGE_PATHS = new Set(["/login"]);

function isPublicApi(method: string, pathname: string): boolean {
  // Exact route matches
  if (PUBLIC_API_ROUTES.some((r) => r.method === method && r.path === pathname)) {
    return true;
  }
  // GET-only prefix matches (storefront data)
  if (method === "GET" && PUBLIC_GET_PREFIXES.some((p) => pathname.startsWith(p))) {
    return true;
  }
  return false;
}

// During the force-change lock, these API endpoints remain accessible.
function isAllowedDuringForceChange(pathname: string, method: string): boolean {
  if (pathname === "/api/auth/me" && method === "GET") return true;
  if (pathname === "/api/auth/change-password" && method === "POST") return true;
  return false;
}

/**
 * Surfaces owned by the PLATFORM session, not this middleware.
 *
 * This file guards the legacy dashboard, which authenticates with a stateless
 * JWT it can verify on the Edge runtime. The console authenticates with an
 * opaque, revocable session that needs a database read — impossible here (M-09)
 * — so those routes do their own check: `/console/*` and every product page via
 * requireConsoleSession, and `/api/<product>/*` via the tenantRoute wrapper.
 *
 * Letting them through is therefore not a hole. Reaching one of these paths
 * without a platform session gets a redirect to sign in, or a 401 with the
 * console's error shape, from the handler itself.
 *
 * This split is temporary. It exists only while the legacy dashboard and the
 * console run side by side; when the last page has moved, this middleware and
 * the JWT it verifies are deleted together.
 */
const PLATFORM_OWNED_PREFIXES = ["/console", "/api/builder/", "/api/erp/", "/api/platform/"];

/** Product consoles, resolved from the registry so a new product needs no edit. */
const PRODUCT_BASE_PATHS = productRegistry.list().map((p) => p.basePath);

function isPlatformOwned(pathname: string): boolean {
  if (PLATFORM_OWNED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return true;
  return PRODUCT_BASE_PATHS.some((b) => pathname === b || pathname.startsWith(b + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  // 0) The console and the product APIs authenticate themselves.
  if (isPlatformOwned(pathname)) {
    return NextResponse.next();
  }

  // 1) Public API routes — short-circuit (method-aware).
  if (isPublicApi(method, pathname)) {
    return NextResponse.next();
  }

  // 2) Auth pages (e.g. /login) — if already logged in, send to dashboard.
  if (AUTH_PAGE_PATHS.has(pathname)) {
    const session = await readSession(req);
    if (session) {
      const target = session.mustChangePassword
        ? "/dashboard/profile"
        : "/dashboard";
      return NextResponse.redirect(new URL(target, req.url));
    }
    return NextResponse.next();
  }

  // 3) Public storefront pages — no auth.
  if (PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 4) Everything else is protected. This includes:
  //    - /dashboard/*
  //    - /api/landings (GET list, POST create, [id] GET/DELETE, [id]/* PATCH)
  //    - /api/orders (GET list, [id] GET/DELETE, [id]/status PATCH)
  //    - /api/categories POST, [id] PATCH/DELETE
  //    - /api/settings/store (GET + PUT)
  //    - /api/settings/delivery-prices PUT
  //    - /api/auth/* (except login which is public POST)
  const isProtectedPage = pathname.startsWith("/dashboard");
  const isProtectedApi = pathname.startsWith("/api/");

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  // 5) Verify the session cookie at the edge.
  const session = await readSession(req);
  if (!session) {
    if (isProtectedPage) {
      const url = new URL("/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      },
      { status: 401 },
    );
  }

  // 6) Force-change enforcement.
  if (session.mustChangePassword) {
    if (isProtectedPage && pathname !== "/dashboard/profile") {
      return NextResponse.redirect(new URL("/dashboard/profile", req.url));
    }
    if (
      isProtectedApi &&
      !isAllowedDuringForceChange(pathname, req.method)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MUST_CHANGE_PASSWORD",
            message:
              "يجب تغيير كلمة المرور الافتراضية قبل متابعة استخدام النظام.",
          },
        },
        { status: 403 },
      );
    }
  }

  return NextResponse.next();
}

async function readSession(req: NextRequest) {
  const token = req.cookies.get(getSessionCookieName())?.value;
  if (!token) return null;
  return verifySession(token);
}

// Match everything except static assets and Next.js internals.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.svg|products|avatars|uploads).*)",
  ],
};
