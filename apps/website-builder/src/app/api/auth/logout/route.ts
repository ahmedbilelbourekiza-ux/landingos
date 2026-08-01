import { NextResponse } from "next/server";
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
// The Location header is deliberately RELATIVE, and the response is built by
// hand rather than with NextResponse.redirect(), which requires an absolute URL.
//
// Behind Render's proxy the container is addressed internally, so `req.url`
// resolves to the bind address rather than the public hostname:
// `new URL("/login", req.url)` produced `https://0.0.0.0:10000/login`, which no
// browser can follow. The middleware is unaffected because Next rewrites its
// redirects to relative form; route handlers get no such treatment.
//
// A relative Location is valid per RFC 7231 and leaves the browser to resolve
// it against whatever host it actually used, so this stays correct on any
// domain — the deployment URL, a custom domain, or localhost.
export async function GET() {
  return clearSessionCookie(
    new NextResponse(null, { status: 303, headers: { Location: "/login" } }),
  );
}
