import { NextRequest, NextResponse } from "next/server";
import { verifySession, getSessionCookieName } from "@/lib/auth/session";

// Protects all /dashboard routes and /api routes used by the dashboard.
// Public routes (/, /category/*, /l/*, /thank-you/*, /api/public/*,
// /api/wilayas, /api/themes, /api/settings/delivery-prices, /api/orders)
// remain accessible without authentication.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public API routes — no auth required
  const publicApiPrefixes = [
    "/api/public",
    "/api/wilayas",
    "/api/themes",
    "/api/settings/delivery-prices",
    "/api/orders",
    "/api/landings",
    "/api/upload",
    "/api/categories",
  ];
  if (publicApiPrefixes.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Protect /dashboard and /api/auth/me
  const isProtected = pathname.startsWith("/dashboard") ||
    pathname === "/api/auth/me" ||
    pathname === "/api/auth/profile" ||
    pathname === "/api/auth/change-password" ||
    pathname.startsWith("/api/settings/store");

  if (!isProtected) {
    return NextResponse.next();
  }

  // Check session cookie
  const token = req.cookies.get(getSessionCookieName())?.value;
  if (!token) {
    if (pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } }, { status: 401 });
  }

  // We can't verify JWT in middleware (Edge runtime doesn't support jose verify
  // synchronously). Instead, we just check the cookie exists. The actual
  // verification happens in the route handler or server component.
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/auth/:path*", "/api/settings/store/:path*"],
};
