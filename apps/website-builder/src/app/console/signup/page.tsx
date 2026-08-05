import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getConsoleSession } from "@/lib/console/session";
import { SignupForm } from "@/components/console/signup-form";

export const dynamic = "force-dynamic";

/* =============================================================================
 * /console/signup — Phase 7.3.
 *
 * The public sign-up page. Mirrors `/console/login`: it renders for a signed-OUT
 * visitor and redirects to `/console` if the caller is already signed in. The
 * form calls `POST /api/platform/signup` (the first public write path), and on
 * success the route sets a session cookie and the client navigates to `/console`.
 *
 * NOT gated by `tenantRoute` or `requireConsoleSession` — the whole point is
 * that the caller has no session and no tenant yet.
 * ========================================================================== */

export default async function SignupPage() {
  // Already signed in? Send them to their console rather than offering to make
  // a second company unprompted. (They can still sign up another from the API.)
  if (await getConsoleSession()) redirect("/console");

  const t = await getTranslations();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold">{t("signup.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("signup.subtitle")}</p>
        </div>

        <SignupForm
          labels={{
            companyName: t("signup.companyName"),
            slug: t("signup.slug"),
            slugHint: t("signup.slugHint"),
            name: t("signup.name"),
            email: t("signup.email"),
            password: t("signup.password"),
            submit: t("signup.submit"),
            haveAccount: t("signup.haveAccount"),
            signIn: t("signup.signIn"),
            reservedSlug: t("signup.reservedSlug"),
            slugTaken: t("signup.slugTaken"),
            emailTaken: t("signup.emailTaken"),
            invalidSlug: t("signup.invalidSlug"),
          }}
        />
      </div>
    </main>
  );
}
