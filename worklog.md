# LandingOS — Work Log

---
Task ID: 30
Agent: main
Task: Authentication Hardening & Admin Security (Task 30)

Work Log:
- Read existing auth files: session.ts, login route, me route, change-password route, logout route, middleware.ts, profile page, seed-admin.ts, schema.prisma Admin model
- Identified gaps: no mustChangePassword field, no rate limiting, no lastLogin/lastPasswordChange tracking, login route has bottom-of-file NextResponse import bug, middleware only checks cookie existence (doesn't verify JWT), profile page missing required sections
- Plan: harden schema, session lib, all auth APIs, middleware, dashboard layout server-side redirect, nav disabling, full profile rewrite

Stage Summary:
- (in progress)

Implementation completed. Full verification done via curl + HTML inspection.

Files Changed:
1. prisma/schema.prisma — Added mustChangePassword, lastLoginAt, lastPasswordChangeAt to Admin
2. prisma/seed-admin.ts — Set mustChangePassword: true on create
3. src/lib/auth/session.ts — Rewritten: JWT includes mustChangePassword, centralized cookie options, fail-fast on missing AUTH_SECRET
4. src/lib/auth/rate-limit.ts — NEW: in-memory rate limiter (5 attempts / 5 min per IP)
5. src/lib/auth/require-auth.ts — NEW: getAuthenticatedAdmin + getAdminWithHash helpers (exclude passwordHash)
6. src/app/api/auth/login/route.ts — Rate limit, lastLoginAt, return mustChangePassword, fixed import bug
7. src/app/api/auth/me/route.ts — Full admin info returned, PATCH blocked when mustChangePassword
8. src/app/api/auth/change-password/route.ts — Set mustChangePassword=false, lastPasswordChangeAt, prevent same/default password, reissue session
9. src/app/api/auth/logout/route.ts — Use centralized cookie options
10. src/app/api/settings/store/route.ts — Use require-auth helper, block when mustChangePassword
11. src/middleware.ts — Actual JWT verification (jose edge-compatible), force-change redirect, /login redirect when authenticated
12. src/app/(auth)/login/page.tsx — Suspense wrapper for useSearchParams, 429 handling, mustChangePassword redirect
13. src/app/(dashboard)/layout.tsx — Server-side fetch mustChangePassword, pass to AppShell
14. src/components/layout/app-shell.tsx — Accept mustChangePassword prop
15. src/components/layout/dashboard-sidebar.tsx — Accept mustChangePassword prop
16. src/components/layout/dashboard-header.tsx — Accept mustChangePassword prop
17. src/components/layout/mobile-sidebar.tsx — Accept mustChangePassword prop
18. src/components/layout/dashboard-nav.tsx — Disable all nav items except Profile when mustChangePassword
19. src/components/profile/profile-ui.tsx — NEW: SectionCard, InfoRow, formatArabicDate helpers
20. src/components/profile/profile-cards.tsx — NEW: AccountCard, SecurityCard, SessionCard, LogoutCard
21. src/app/(dashboard)/dashboard/profile/page.tsx — Rewritten: 4 sections (Account, Security, Session, Logout) + warning banner

Verification Results:
- Login rate limit: 5 failed attempts → 6th returns 429 with Arabic message + Retry-After header
- Login with admin/admin123 → 200, returns mustChangePassword=true
- Middleware blocks /api/auth/me with 403 MUST_CHANGE_PASSWORD when flag is true
- Middleware blocks PUT /api/settings/store with 403 when flag is true
- Middleware redirects /dashboard, /dashboard/orders, /dashboard/landings → /dashboard/profile (307)
- Change password → 200, mustChangePassword=false, lastPasswordChangeAt set, new session cookie issued
- After change, /api/auth/me returns full admin info (id, username, mustChangePassword=false, lastLoginAt, lastPasswordChangeAt, createdAt)
- /dashboard without auth → 307 redirect to /login?next=/dashboard
- /api/auth/me without auth → 401 UNAUTHORIZED
- /api/settings/store without auth → 401 UNAUTHORIZED
- /dashboard/profile HTML: nav items have aria-disabled="true" + cursor-not-allowed (all except Profile)
- ESLint: 0 errors, 2 pre-existing warnings (in untouched files)

Stage Summary:
- All 8 parts of Task 30 implemented and verified
- Force-change flow works end-to-end (login → redirect → blocked APIs → change password → unlocked)
- Rate limiting works (429 with Arabic message)
- Session tracking works (lastLoginAt, lastPasswordChangeAt, createdAt)
- Profile page has 4 sections (Account, Security, Session, Logout) + warning banner
- Middleware enforces auth at the edge with actual JWT verification
- All protected APIs return 401/403 without valid session
- Public routes remain accessible
- ESLint clean (0 errors)

---
Task ID: 30-bugfix
Agent: main
Task: BUG FIX — AUTH_SECRET bootstrap failure

Root Cause:
src/lib/auth/session.ts had a module-level throw:
  const SECRET_ENV = process.env.AUTH_SECRET;
  if (!SECRET_ENV) {
    throw new Error("AUTH_SECRET is required...");
  }
  const secret = new TextEncoder().encode(SECRET_ENV);

This file is imported by src/middleware.ts (Edge runtime), which runs
before any route handler. When AUTH_SECRET was missing from .env, the
module evaluation threw at import time, crashing the entire Next.js
process before the app could start.

Work Log:
- Refactored src/lib/auth/session.ts:
  - Removed module-level throw and module-level secret evaluation
  - Added lazy getAuthSecret() helper that reads process.env.AUTH_SECRET
    only when called and throws AuthSecretMissingError (typed) if missing
  - createSession() now calls getAuthSecret() internally — callers catch
    AuthSecretMissingError and return a clear 500
  - verifySession() swallows AuthSecretMissingError (returns null) so the
    middleware treats missing-secret as "no valid session" without crashing
  - Module is now safe to import from anywhere, including Edge runtime
- Updated src/middleware.ts:
  - readSession() now explicitly checks for missing/empty AUTH_SECRET and
    returns null (treats as unauthenticated) instead of using the non-null
    assertion process.env.AUTH_SECRET! which would encode the string
    "undefined"
  - Middleware never crashes during bootstrap
- Updated src/app/api/auth/login/route.ts:
  - Catches AuthSecretMissingError and returns HTTP 500 with code
    AUTH_SECRET_MISSING and actionable message
  - Removed unused `ok` import
- Updated src/app/api/auth/change-password/route.ts:
  - Same AuthSecretMissingError handling for the session reissue path
- Created src/.env.example (actually /home/z/my-project/.env.example):
  - Documents DATABASE_URL and AUTH_SECRET
  - Includes generation instructions: openssl rand -base64 32
  - Notes that .env is gitignored
- Restored .env with a freshly generated AUTH_SECRET (the .env had been
  reset to only DATABASE_URL, which triggered the original crash)

Verification:
1. Bootstrap WITHOUT AUTH_SECRET:
   - Server starts cleanly (no crash)
   - Login API returns 500 AUTH_SECRET_MISSING with clear message
   - Middleware redirects /dashboard → /login (no crash)
2. Bootstrap WITH AUTH_SECRET:
   - Server starts cleanly
   - Login (admin/admin123) → 200, mustChangePassword=true
   - /api/auth/me without auth → 401 UNAUTHORIZED
   - /api/auth/me with auth + mustChangePassword → 403 MUST_CHANGE_PASSWORD
   - Change password → 200, mustChangePassword=false, new cookie issued
   - /api/auth/me after change → 200 with full admin info
   - Logout → 200, cookie cleared
   - /api/auth/me after logout → 401
3. ESLint: 0 errors, 2 pre-existing warnings (untouched files)

Files Changed:
1. src/lib/auth/session.ts — removed module-level throw, added getAuthSecret()
2. src/middleware.ts — graceful missing-secret handling in readSession()
3. src/app/api/auth/login/route.ts — catch AuthSecretMissingError → 500
4. src/app/api/auth/change-password/route.ts — catch AuthSecretMissingError → 500
5. .env.example — NEW: template with AUTH_SECRET + instructions
6. .env — restored AUTH_SECRET (was missing, triggering the crash)

Stage Summary:
- AUTH_SECRET is now resolved lazily — module import never throws
- Middleware bootstrap is safe regardless of AUTH_SECRET presence
- Missing AUTH_SECRET produces clear, actionable errors at the API layer
- .env.example documents the requirement for new developers
- All auth flows verified end-to-end
