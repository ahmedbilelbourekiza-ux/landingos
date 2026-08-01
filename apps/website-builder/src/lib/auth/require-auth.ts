import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { verifySession, getSessionCookieName } from "./session";

// Helper for API route handlers. Returns the authenticated admin (with the
// fields a route typically needs) or `null`. Routes that need to enforce auth
// should call `requireAdmin()` and return a 401 envelope when it returns null.
//
// Centralising this means every protected route applies the same rules: cookie
// present → verify signature → verify the admin still exists in the DB. The
// `select` excludes `passwordHash` so no route can accidentally leak it.
//
// ORPHANED SESSIONS
//
// The signature check and the "does this admin still exist" check disagree in
// one specific case, and it strands the user completely.
//
// The session JWT carries an adminId. The middleware (Edge runtime) only
// verifies the signature — it cannot reach the database — so a token signed
// with the current AUTH_SECRET always satisfies it, and every dashboard PAGE
// renders. Route handlers then look the adminId up and find nothing, so every
// API call on that page returns 401.
//
// That state is unrecoverable through the UI: the middleware also redirects
// away from /login whenever it sees a valid-signature session, so the user
// cannot reach the login form to get a fresh token. The dashboard renders and
// nothing in it works, permanently.
//
// This is not hypothetical — it is what happens whenever the admin row's id
// changes while AUTH_SECRET stays the same. Migrating the database from SQLite
// to Postgres did exactly that: the seed recreated the admin with a fresh
// cuid() while existing browser cookies still referenced the old one.
//
// So when the token verifies but the admin is gone, the session is definitively
// dead and is cleared here. The next request arrives with no cookie, the
// middleware redirects to /login as usual, and the user logs back in. One
// failed request instead of a permanent lockout.

export type AuthenticatedAdmin = {
  id: string;
  username: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  lastPasswordChangeAt: Date | null;
  createdAt: Date;
};

// Drops the session cookie after an orphaned token is detected, so the next
// request is treated as logged out and the middleware can redirect to /login.
//
// Best-effort by design: cookie mutation is only permitted in Route Handlers
// and Server Actions. Every current caller is a Route Handler, but a future
// Server Component caller would throw here — and failing to clean up a dead
// cookie must never turn a 401 into a 500, so the error is swallowed.
async function clearOrphanedSession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(getSessionCookieName());
  } catch {
    // Not in a mutable-cookie context; the 401 below still stands.
  }
}

export async function getAuthenticatedAdmin(): Promise<AuthenticatedAdmin | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  const admin = await db.admin.findUnique({
    where: { id: session.adminId },
    select: {
      id: true,
      username: true,
      mustChangePassword: true,
      lastLoginAt: true,
      lastPasswordChangeAt: true,
      createdAt: true,
    },
  });
  // Valid signature, no such admin — the account this token was issued for no
  // longer exists. See ORPHANED SESSIONS above.
  if (!admin) {
    console.warn(
      `[auth] session references admin id "${session.adminId}" which no longer exists — clearing cookie`,
    );
    await clearOrphanedSession();
    return null;
  }

  return admin;
}

// Strict variant: callers that need the password hash (login, change-password).
// Never returns the hash through an API response — only used for bcrypt.compare.
export async function getAdminWithHash(): Promise<
  | (AuthenticatedAdmin & { passwordHash: string })
  | null
> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  const admin = await db.admin.findUnique({
    where: { id: session.adminId },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      mustChangePassword: true,
      lastLoginAt: true,
      lastPasswordChangeAt: true,
      createdAt: true,
    },
  });
  if (!admin) {
    console.warn(
      `[auth] session references admin id "${session.adminId}" which no longer exists — clearing cookie`,
    );
    await clearOrphanedSession();
    return null;
  }
  return admin;
}
