import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/lib/db";
import { verifySession, getSessionCookieName } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Dashboard route group — the internal admin surface. Every page under
// (dashboard) inherits the AppShell (sidebar + header + sticky footer).
//
// We resolve the current admin here, on the server, so the navigation can
// disable every link except Profile when `mustChangePassword` is true. The
// middleware already enforces the redirect, so this is a UX hint, not a
// security control — but it makes the lock obvious to the user.
//
// The middleware guarantees that any request reaching this layout is
// authenticated. If the session cookie is missing or invalid, the user has
// already been redirected to /login. We still guard defensively.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let mustChangePassword = false;

  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (token) {
    const session = await verifySession(token);
    if (session) {
      const admin = await db.admin.findUnique({
        where: { id: session.adminId },
        select: { mustChangePassword: true },
      });
      mustChangePassword = admin?.mustChangePassword ?? false;
    }
  }

  return <AppShell mustChangePassword={mustChangePassword}>{children}</AppShell>;
}
