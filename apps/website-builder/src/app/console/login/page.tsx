import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { AlertCircle, Briefcase } from "lucide-react";

import { siteConfig } from "@/config/site";

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

  const t = await getTranslations();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface-raised p-6 shadow-e2"
      >
        <div>
          {/* UI.21 — every string on the FIRST screen anybody sees was an
              English literal, in a product whose default locale is Arabic.
              AUDIT.4's i18n scan reads `t("…")` calls and could never see a
              string that never went through `t()`, which is how these survived
              four passes. The product name stays a literal because it is a
              proper noun, and it comes from `siteConfig` so there is one of it. */}
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
            >
              <Briefcase className="size-4" />
            </span>
            <h1 className="text-lg font-semibold tracking-tight">{siteConfig.name}</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("auth.subtitle")}</p>
        </div>

        {error ? (
          // One message for every failure. Naming which half was wrong tells an
          // attacker which addresses are real.
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            style={{
              color: "var(--danger-fg)",
              backgroundColor: "var(--danger-bg)",
              borderColor: "var(--danger-border)",
            }}
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{t("auth.invalid")}</span>
          </p>
        ) : null}

        <input type="hidden" name="next" value={next ?? "/console"} />

        <div className="space-y-1.5">
          <label htmlFor="email" className="ui-label block">
            {t("auth.email")}
          </label>
          <input
            id="email" name="email" type="email" required autoComplete="username"
            // Left-to-right whatever the page direction: an address is not
            // Arabic text, and rendering it RTL puts the domain first.
            dir="ltr"
            className="ui-control tap w-full"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="ui-label block">
            {t("auth.password")}
          </label>
          <input
            id="password" name="password" type="password" required autoComplete="current-password"
            dir="ltr"
            className="ui-control tap w-full"
          />
        </div>

        <button type="submit" className="ui-btn ui-btn-primary ui-btn-lg tap w-full">
          {t("auth.signIn")}
        </button>
      </form>
    </main>
  );
}
