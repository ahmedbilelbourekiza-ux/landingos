import { NextRequest, NextResponse } from "next/server";
import {
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth/session";
import { ok } from "@/lib/api-response";

// Clearing the cookie means writing an empty value with maxAge=0, not just
// delete() — some browsers and proxies drop a bare delete.
function clearSessionCookie(res: NextResponse): NextResponse {
  const opts = getSessionCookieOptions();
  res.cookies.set(getSessionCookieName(), "", { ...opts, maxAge: 0 });
  return res;
}

// POST /api/auth/logout — clears the session cookie. Used by the logout button.
export async function POST() {
  return clearSessionCookie(NextResponse.json(ok({})));
}

// GET /api/auth/logout — clears the session cookie, then redirects to /login.
//
// This exists as a redirect target the server can send a browser to, which POST
// cannot serve. It is what breaks the orphaned-session deadlock described in
// src/lib/auth/require-auth.ts: the dashboard layout detects that the session
// points at an admin that no longer exists, but a Server Component cannot clear
// a cookie, and redirecting straight to /login would bounce off the middleware
// (which sees a signature-valid session and sends the user back to /dashboard)
// into an infinite loop. Routing through here clears the cookie first, so the
// middleware then sees a logged-out request and lets /login render.
export async function GET(req: NextRequest) {
  return clearSessionCookie(
    NextResponse.redirect(new URL("/login", req.url), 303),
  );
}
