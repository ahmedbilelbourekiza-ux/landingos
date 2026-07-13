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

export type AuthenticatedAdmin = {
  id: string;
  username: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  lastPasswordChangeAt: Date | null;
  createdAt: Date;
};

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
  if (!admin) return null;

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
  if (!admin) return null;
  return admin;
}
