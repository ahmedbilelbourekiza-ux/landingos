"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, switchTenant, destroySession } from "@landingos/auth";
import { isLocale } from "@landingos/i18n";

/**
 * Change which company the session is acting as.
 *
 * switchTenant refuses a tenant the user is not a member of, so this cannot be
 * turned into a way to act as any tenant by id — the check lives in the auth
 * package rather than here, where a caller could forget it.
 */
export async function switchTenantAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && tenantId) await switchTenant(token, tenantId);
  redirect("/console");
}

/** Change display language. Stored on the session cookie's sibling, not the URL. */
export async function switchLocaleAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "");
  if (isLocale(locale)) {
    (await cookies()).set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect(String(formData.get("returnTo") || "/console"));
}

/** Sign out: revoke the session server-side, then clear the cookie. */
export async function signOutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  // Order matters. Revoking first means a token captured in flight is already
  // dead; clearing the cookie first would leave a live session behind it.
  if (token) await destroySession(token);
  jar.delete(SESSION_COOKIE);
  redirect("/console/login");
}
