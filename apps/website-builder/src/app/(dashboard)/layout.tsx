import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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
// The middleware guarantees the SIGNATURE on any request reaching this layout
// is valid. It cannot guarantee the admin still exists, because it runs on the
// Edge runtime with no database access. This layout is therefore the first
// place on a page navigation where an orphaned session can be detected — a
// token that verifies but names an admin id that is no longer in the database
// (see src/lib/auth/require-auth.ts for how that arises).
//
// Previously this case fell through to `mustChangePassword = false` and
// rendered the shell as though everything were fine, which is what produced
// the failure mode of a dashboard that loads but where every API call returns
// 401 and the user cannot reach /login to fix it. Redirecting through the
// logout route clears the cookie and lands them on the login form.
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
      if (!admin) {
        // Orphaned session. GET /api/auth/logout clears the cookie and then
        // redirects to /login; redirecting straight to /login instead would
        // bounce off the middleware back to /dashboard forever.
        redirect("/api/auth/logout");
      }
      mustChangePassword = admin.mustChangePassword;
    }
  }

  return <AppShell mustChangePassword={mustChangePassword}>{children}</AppShell>;
}
