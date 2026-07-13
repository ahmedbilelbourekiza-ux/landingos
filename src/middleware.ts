import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSessionCookieName } from "@/lib/auth/session";

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
//   /api/landings            — landing CRUD (already covered by session at runtime; left public at the edge so customer-facing server components that proxy through can still fetch)
//   /api/categories          — category list (public storefront reads)
//   /api/upload              — kept public for now; auth added at route level where needed
//   /api/health              — health check
//
// Protected (auth required):
//   /dashboard/*             — all admin UI
//   /api/auth/me             — current admin profile (GET + PATCH)
//   /api/auth/change-password
//   /api/auth/profile        — reserved
//   /api/settings/store      — store settings (PUT)
//
// Force-change flow:
//   If the session JWT carries mustChangePassword=true, the only dashboard
//   route allowed is /dashboard/profile. Every other /dashboard/* path
//   302-redirects there. The /api/auth/me PATCH endpoint is also blocked
//   server-side so the username cannot be changed before the password is.
//
// Edge runtime note: jose's jwtVerify is fully Edge-compatible, so we verify
// the JWT signature and expiration here rather than just checking the cookie
// exists. This means a tampered or expired cookie is rejected at the edge
// before it ever reaches a route handler.

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

interface VerifiedSession {
  adminId: string;
  username: string;
  mustChangePassword: boolean;
}

// Edge-runtime session reader. Returns the verified session payload, or null
// if there is no cookie, the cookie is tampered, the JWT is expired, or
// AUTH_SECRET is missing. We intentionally swallow all errors here: the
// middleware treats "no valid session" the same way regardless of cause, and
// a missing AUTH_SECRET must NOT crash the bootstrap — it simply means no
// session can ever verify, so the user is sent to /login. The route handlers
// that actually need to sign tokens (login, change-password) call getAuthSecret()
// directly and return a clear 500 if the secret is missing.
async function readSession(req: NextRequest): Promise<VerifiedSession | null> {
  const token = req.cookies.get(getSessionCookieName())?.value;
  if (!token) return null;
  try {
    const rawSecret = process.env.AUTH_SECRET;
    if (!rawSecret || rawSecret.trim() === "") {
      // No secret configured — no session can be valid. Treat as unauthenticated.
      return null;
    }
    const secret = new TextEncoder().encode(rawSecret);
    const { payload } = await jwtVerify(token, secret);
    return {
      adminId: payload.adminId as string,
      username: payload.username as string,
      mustChangePassword: Boolean(payload.mustChangePassword),
    };
  } catch {
    return null;
  }
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

  // 6) Force-change: only /dashboard/profile is reachable. API calls (other
  //    than change-password, which itself clears the flag) get 403 so a
  //    malicious client can't sneak in edits while the password is still the
  //    default.
  if (session.mustChangePassword) {
    if (isProtectedPage && pathname !== "/dashboard/profile") {
      return NextResponse.redirect(new URL("/dashboard/profile", req.url));
    }
    if (isProtectedApi && pathname !== "/api/auth/change-password") {
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

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/auth/:path*",
    "/api/settings/store/:path*",
    "/login",
  ],
};
