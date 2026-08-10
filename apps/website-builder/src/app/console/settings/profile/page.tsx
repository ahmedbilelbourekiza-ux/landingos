import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { asPlatform } from "@landingos/db";
import {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  destroySessionsForUser,
  destroyOtherSessions,
  createSession,
  sessionCookieOptions,
} from "@landingos/auth";
import { LOCALES, LOCALE_NAMES } from "@landingos/i18n";

import { withTenant } from "@landingos/db";
import { getTranslations } from "next-intl/server";

import { requireConsoleSession } from "@/lib/console/session";
import { actionErrors } from "@/lib/console/action-errors";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
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

/* B6 (CAPABILITY_AUDIT) — "sign out everywhere else". The write side of
 * session management quietly existed (lastSeenAt has a throttled writer,
 * destroy helpers, userAgent/ip stored); this is the screen it never had. */
async function signOutOthers() {
  "use server";
  const session = await requireConsoleSession("/console/settings/profile");
  await destroyOtherSessions(session.user.id, session.sessionId);
  revalidatePath("/console/settings/profile");
  redirect("/console/settings/profile?saved=1");
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await requireConsoleSession("/console/settings/profile");
  const { saved, error } = await searchParams;
  const t = await getTranslations();

  // Every live session of THIS user — the model is user-keyed and unscoped,
  // so the filter is the isolation (same argument as the workspace route).
  const sessions = await asPlatform().session.findMany({
    where: { userId: session.user.id, expiresAt: { gt: new Date() } },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, userAgent: true, ip: true, lastSeenAt: true, createdAt: true },
  });

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
    <>
      <PageBody>
      <PageHeader title={t("settings.profile")} description={t("settings.profileHint")} />

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
          {saved === "password" ? t("settings.passwordChanged") : t("settings.saved")}
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
            <label htmlFor="email" className="ui-label block">{t("settings.email")}</label>
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
            <label htmlFor="name" className="ui-label block">{t("settings.name")}</label>
            <input
              id="name"
              name="name"
              defaultValue={session.user.name}
              required
              className="ui-control tap w-full"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="locale" className="ui-label block">{t("settings.language")}</label>
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
            {t("common.save")}
          </button>
        </form>

        <form
          action={changePassword}
          className="space-y-4 rounded-lg border border-border bg-card p-4"
          data-testid="password-form"
        >
          <h2 className="text-sm font-semibold tracking-tight">{t("settings.changePassword")}</h2>

          <div className="space-y-1">
            <label htmlFor="current" className="ui-label block">{t("settings.currentPassword")}</label>
            <input
              id="current" name="current" type="password" required autoComplete="current-password"
              className="ui-control tap w-full"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="next" className="ui-label block">{t("settings.newPassword")}</label>
            <input
              id="next" name="next" type="password" required minLength={12} autoComplete="new-password"
              className="ui-control tap w-full"
            />
            <p className="text-xs text-muted-foreground">{t("settings.passwordHint")}</p>
          </div>

          <button
            type="submit"
            className="ui-btn ui-btn-default tap"
          >
            {t("settings.changePassword")}
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

      {/* B6 — the sessions this account holds, and the door that closes the
          others. `lastSeenAt` is the throttled touch resolveSession writes. */}
      <section
        aria-labelledby="sessions-title"
        data-testid="sessions-section"
        className="space-y-3 rounded-lg border border-border bg-card p-4"
      >
        <h2 id="sessions-title" className="text-sm font-semibold tracking-tight">
          {t("settings.sessions")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("settings.sessionsHint")}</p>
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              data-current={String(s.id === session.sessionId)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/30 px-3 py-2 text-xs"
            >
              <span className="max-w-72 truncate font-medium" title={s.userAgent ?? undefined}>
                {s.userAgent ?? "—"}
              </span>
              {s.ip && <span dir="ltr" className="font-mono text-muted-foreground">{s.ip}</span>}
              <span className="text-muted-foreground">
                {(s.lastSeenAt ?? s.createdAt).toISOString().slice(0, 16).replace("T", " ")}
              </span>
              {s.id === session.sessionId && (
                <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                  {t("settings.sessionCurrent")}
                </span>
              )}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <form action={signOutOthers}>
            <button type="submit" data-testid="sign-out-others" className="ui-btn ui-btn-default tap">
              {t("settings.signOutOthers")}
            </button>
          </form>
        )}
      </section>
      </PageBody>
    </>
  );
}
