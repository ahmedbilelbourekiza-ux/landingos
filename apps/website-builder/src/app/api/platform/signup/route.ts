import { NextResponse, type NextRequest } from "next/server";

import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@landingos/auth";

import { signUp } from "@/lib/platform/signup";

export const dynamic = "force-dynamic";

/* =============================================================================
 * POST /api/platform/signup — Phase 7.3.
 *
 * The first public, unauthenticated write path on the platform. NOT wrapped in
 * `tenantRoute` (which requires a session + active tenant) — the whole point is
 * that the caller has neither yet. The page at `/console/signup` calls this and
 * on success lands the new owner in their console.
 *
 * On success it creates a session, sets the cookie and returns the new tenant's
 * slug + the owner's role. The cookie is what makes the signup "sign you in" —
 * the same shape login uses, and the same one the join flow (7.1b) does NOT use
 * (acceptance attaches a membership to an existing user; signup creates both).
 * ========================================================================== */

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await signUp({
    slug: String(body.slug ?? ""),
    companyName: String(body.companyName ?? body.name ?? ""),
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    password: String(body.password ?? ""),
  });

  if ("code" in result) {
    return NextResponse.json(
      { success: false, error: { code: result.code, message: result.message } },
      { status: result.status },
    );
  }

  // Land them signed in. The session's activeTenantId is the new tenant, so the
  // console opens straight into the company they just created.
  const h = req.headers;
  const { token } = await createSession(result.userId, result.tenantId, {
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for"),
  });

  const response = NextResponse.json(
    {
      success: true,
      data: {
        userId: result.userId,
        tenantSlug: result.tenantSlug,
        role: result.role,
      },
    },
    { status: 201 },
  );
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
