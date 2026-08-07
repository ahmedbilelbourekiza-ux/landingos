import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { asPlatform } from "@landingos/db";
import {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  destroySessionsForUser,
  createSession,
  sessionCookieOptions,
} from "@landingos/auth";
import { LOCALES, LOCALE_NAMES } from "@landingos/i18n";

import { withTenant } from "@landingos/db";
import { getTranslations } from "next-intl/server";

import { requireConsoleSession } from "@/lib/console/session";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { NotifyPreferences } from "@/components/console/notify-preferences";
import { notifyPrefStrings } from "@/lib/console/erp-strings";
import { readNotifyPrefs, NOTIFY_DEFAULTS } from "@/lib/platform/notify-prefs";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The signed-in person's own profile.
 *
 * A PLATFORM screen: a user is global, not a member of one product, so this
 * exists once however many applications the tenant runs. Their name and locale
 * follow them between tenants; only their role changes.
 * ========================================================================== */

async function saveProfile(formData: FormData) {
  "use server";
  const session = await requireConsoleSession("/console/settings/profile");

  const name = String(formData.get("name") ?? "").trim();
  const locale = String(formData.get("locale") ?? "");
  if (!name) redirect("/console/settings/profile?error=name");

  await asPlatform().user.update({
    where: { id: session.user.id },
    data: {
      name: name.slice(0, 160),
      locale: (LOCALES as readonly string[]).includes(locale) ? locale : null,
    },
  });

  // Keep the display language in step with the stored preference, so the
  // change is visible immediately rather than on the next cookie refresh.
  if ((LOCALES as readonly string[]).includes(locale)) {
    (await cookies()).set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  }

  revalidatePath("/console/settings/profile");
  redirect("/console/settings/profile?saved=1");
}

async function changePassword(formData: FormData) {
  "use server";
  const session = await requireConsoleSession("/console/settings/profile");

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  if (next.length < 12) redirect("/console/settings/profile?error=short");

  const user = await asPlatform().user.findUnique({ where: { id: session.user.id } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    redirect("/console/settings/profile?error=current");
  }

  await asPlatform().user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(next),
      mustChangePassword: false,
      lastPasswordChangeAt: new Date(),
    },
  });

  // Every other session dies with the old password. This is the property a
  // stateless token cannot offer: a stolen session ends the moment the person
  // it belongs to changes their password.
  await destroySessionsForUser(user.id);

  // Then issue a fresh one, so changing a password does not sign you out of
  // the tab you changed it in.
  const { token } = await createSession(user.id, session.tenant?.id ?? null);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());

  redirect("/console/settings/profile?saved=password");
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await requireConsoleSession("/console/settings/profile");
  const { saved, error } = await searchParams;
  const t = await getTranslations();

  /* LP.11. On the PROFILE screen because a notification feed is one per person
     across every product — putting it inside the ERP would mean a second copy
     the day a second product raises anything. Read under the same fallback the
     shell uses: an operator hears their alerts rather than sitting in silence
     because a settings row could not be fetched. */
  let prefs = NOTIFY_DEFAULTS;
  if (session.auth) {
    try {
      prefs = await withTenant(session.auth.tenantId, (db) =>
        readNotifyPrefs(db, session.user.id),
      );
    } catch (e) {
      console.error("[console] could not read notification preferences", e);
    }
  }

  const messages: Record<string, string> = {
    name: "A name is required.",
    short: "Use at least 12 characters.",
    current: "That current password is not correct.",
  };

  return (
    <ConsoleShell session={session} productId={null}>
      <h1 className="text-xl font-semibold">Profile</h1>

      {saved ? (
        <p
          role="status"
          data-testid="saved"
          className="mt-4 rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--success-fg)",
            backgroundColor: "var(--success-bg)",
            borderColor: "var(--success-border)",
          }}
        >
          {saved === "password" ? "Password changed. Other sessions were signed out." : "Saved."}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          data-testid="error"
          className="mt-4 rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--danger-fg)",
            backgroundColor: "var(--danger-bg)",
            borderColor: "var(--danger-border)",
          }}
        >
          {messages[error] ?? "That did not work."}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form
          action={saveProfile}
          className="space-y-4 rounded-lg border border-border bg-card p-4"
          data-testid="profile-form"
        >
          <div className="space-y-1">
            <label htmlFor="email" className="ui-label">Email</label>
            {/* Read-only: the address IS the identity across every tenant, so
                changing it is an account operation rather than a profile edit. */}
            <input
              id="email"
              value={session.user.email}
              readOnly
              className="ui-control w-full bg-muted text-muted-foreground"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="name" className="ui-label">Name</label>
            <input
              id="name"
              name="name"
              defaultValue={session.user.name}
              required
              className="ui-control tap w-full"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="locale" className="ui-label">Language</label>
            <select
              id="locale"
              name="locale"
              defaultValue={session.user.locale ?? session.tenant?.locale ?? "ar"}
              className="ui-control tap w-full"
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="ui-btn ui-btn-primary tap"
          >
            Save
          </button>
        </form>

        <form
          action={changePassword}
          className="space-y-4 rounded-lg border border-border bg-card p-4"
          data-testid="password-form"
        >
          <h2 className="text-sm font-medium">Change password</h2>

          <div className="space-y-1">
            <label htmlFor="current" className="ui-label">Current password</label>
            <input
              id="current" name="current" type="password" required autoComplete="current-password"
              className="ui-control tap w-full"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="next" className="ui-label">New password</label>
            <input
              id="next" name="next" type="password" required minLength={12} autoComplete="new-password"
              className="ui-control tap w-full"
            />
            <p className="text-xs text-muted-foreground">At least 12 characters.</p>
          </div>

          <button
            type="submit"
            className="ui-btn ui-btn-default tap"
          >
            Change password
          </button>
        </form>
      </div>

      {/* Only where there is a feed to configure. Without an active tenant
          `Notification` is unbindable and the shell renders no bell either. */}
      {session.auth && (
        <NotifyPreferences
          errors={actionErrors(t)}
          s={notifyPrefStrings(t)}
          initial={prefs}
        />
      )}
    </ConsoleShell>
  );
}
