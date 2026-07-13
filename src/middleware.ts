import { NextRequest, NextResponse } from "next/server";
import {
  verifySession,
  getSessionCookieName,
} from "@/lib/auth/session";

// Authentication & force-password-change enforcement.
//
// Public routes (no auth required):
//   /                        — storefront homepage
//   /category/*              — storefront category pages
//   /l/*                     — public landing pages
//   /thank-you/*             — post-checkout thank-you page
//   /api/public/*            — storefront data API
//   /api/wilayas             — wilaya list for checkout
//   /api/themes              — theme list
//   /api/settings/delivery-prices  — delivery prices for checkout
//   /api/orders              — customer checkout (POST)
//   /api/landings            — landing CRUD
//   /api/categories          — category list (public storefront reads)
//   /api/upload              — media upload
//   /api/health              — health check
//
// Protected (auth required):
//   /dashboard/*             — all admin UI
//   /api/auth/me             — current admin profile (GET always allowed;
//                              PATCH blocked by route handler when
//                              mustChangePassword=true)
//   /api/auth/change-password
//   /api/auth/profile        — reserved
//   /api/settings/store      — store settings (PUT)
//
// Force-change flow:
//   If the session JWT carries mustChangePassword=true:
//     - /dashboard/* (except /dashboard/profile) → 307 redirect to /profile
//     - GET /api/auth/me → ALLOWED (Profile page must load admin data)
//     - POST /api/auth/change-password → ALLOWED (escape hatch)
//     - All other protected APIs → 403 MUST_CHANGE_PASSWORD
//
// Edge runtime: verifySession() from session.ts is fully Edge-compatible
// (jose works in Edge). It swallows AuthSecretMissingError (returns null)
// so a missing AUTH_SECRET never crashes the middleware bootstrap — the
// user is simply treated as unauthenticated and sent to /login.

const PUBLIC_API_PREFIXES = [
  "/api/public",
  "/api/wilayas",
  "/api/themes",
  "/api/settings/delivery-prices",
  "/api/orders",
  "/api/landings",
  "/api/upload",
  "/api/categories",
  "/api/health",
];

const PUBLIC_PAGE_PREFIXES = [
  "/category/",
  "/l/",
  "/thank-you/",
];

const AUTH_PAGE_PATHS = new Set(["/login"]);

// During the force-change lock, these API endpoints remain accessible.
// GET /api/auth/me is needed so the Profile page can render the admin's
// data (username, timestamps, the warning banner). POST /api/auth/change-
// password is the escape hatch that clears the flag.
function isAllowedDuringForceChange(pathname: string, method: string): boolean {
  if (pathname === "/api/auth/me" && method === "GET") return true;
  if (pathname === "/api/auth/change-password" && method === "POST") return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) Public API routes — short-circuit.
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
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

  // 4) Determine whether this is a protected route.
  const isProtectedPage = pathname.startsWith("/dashboard");
  const isProtectedApi =
    pathname === "/api/auth/me" ||
    pathname === "/api/auth/change-password" ||
    pathname === "/api/auth/profile" ||
    pathname.startsWith("/api/settings/store");

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

  // 6) Force-change enforcement. GET /api/auth/me and POST /api/auth/change-
  //    password are the only API calls allowed; everything else is blocked
  //    so a client can't sneak in edits while the password is still default.
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

// Thin wrapper around the shared verifySession(). Kept here so the middleware
// reads the cookie from the NextRequest directly (Edge runtime doesn't have
// next/headers cookies()).
async function readSession(req: NextRequest) {
  const token = req.cookies.get(getSessionCookieName())?.value;
  if (!token) return null;
  return verifySession(token);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/auth/:path*",
    "/api/settings/store/:path*",
    "/login",
  ],
};
