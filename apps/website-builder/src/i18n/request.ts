import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

import { isLocale, localeFromAcceptLanguage, messages } from "@landingos/i18n";

/**
 * Per-request locale for next-intl.
 *
 * next-intl resolves this file through the plugin in next.config.ts; without
 * it, any server component touching a next-intl API fails at RUNTIME with
 * "Couldn't find next-intl config file" while the build reports success. The
 * build only proves the imports resolve.
 *
 * Resolution order is deliberate and matches @landingos/i18n's resolveLocale:
 * an explicit choice, then the browser's preference, then Arabic. Once
 * sessions carry a user (Phase 4.3) the stored User.locale takes precedence
 * over both, and this file is where that lookup lands.
 *
 * No locale segment in the URL: decision D2 already puts tenant slugs at the
 * path root, and a `/fr` prefix would be indistinguishable from a tenant
 * called "fr" (R-08).
 */
export default getRequestConfig(async () => {
  const stored = (await cookies()).get("locale")?.value;
  const locale = isLocale(stored)
    ? stored
    : localeFromAcceptLanguage((await headers()).get("accept-language"));

  return { locale, messages: messages[locale] };
});
