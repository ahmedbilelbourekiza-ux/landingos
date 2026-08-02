import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";

import { asPlatform, withUser } from "@landingos/db";
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
  verifyPassword,
  verifyAgainstDecoy,
  needsRehash,
  hashPassword,
} from "@landingos/auth";
import { getConsoleSession } from "@/lib/console/session";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/console");

  const db = asPlatform();
  const user = await db.user.findUnique({ where: { email } });

  // An unknown address burns the same work a real one does, so a miss is not
  // measurably faster than a hit — otherwise the uniform error below leaks
  // which accounts exist.
  if (!user || user.deletedAt) {
    await verifyAgainstDecoy(password);
    redirect(`/console/login?error=1&next=${encodeURIComponent(next)}`);
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    redirect(`/console/login?error=1&next=${encodeURIComponent(next)}`);
  }

  // Upgrade a legacy or under-strength hash on the way through, so old
  // formats disappear as people sign in rather than needing a forced reset.
  if (needsRehash(user.passwordHash)) {
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  // Land them in a tenant, bound to the user.
  //
  // Reading Membership through asPlatform() returns nothing: it is
  // tenant-scoped, no tenant is bound at sign-in, and RLS denies by returning
  // zero rows rather than erroring. The symptom is a successful login into an
  // empty console — which is exactly what happened before this used withUser,
  // and why the self-visibility policy exists.
  const memberships = await withUser(user.id, (tx) =>
    (tx as any).membership.findMany({
      select: { tenantId: true },
      orderBy: { createdAt: "asc" },
    }),
  );

  const h = await headers();
  const { token } = await createSession(user.id, memberships[0]?.tenantId ?? null, {
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for"),
  });

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  redirect(next);
}

export default async function ConsoleLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  if (await getConsoleSession()) redirect(next || "/console");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <form action={signIn} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold">LandingOS</h1>
          <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
        </div>

        {error ? (
          // One message for every failure. Naming which half was wrong tells an
          // attacker which addresses are real.
          <p
            role="alert"
            className="rounded-md border px-3 py-2 text-sm"
            style={{
              color: "var(--danger-fg)",
              backgroundColor: "var(--danger-bg)",
              borderColor: "var(--danger-border)",
            }}
          >
            That email and password combination is not correct.
          </p>
        ) : null}

        <input type="hidden" name="next" value={next ?? "/console"} />

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input
            id="email" name="email" type="email" required autoComplete="username"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input
            id="password" name="password" type="password" required autoComplete="current-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
