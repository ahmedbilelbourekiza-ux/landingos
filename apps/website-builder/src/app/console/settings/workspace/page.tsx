import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { can } from "@landingos/auth";
import { asPlatform } from "@landingos/db";
import { LOCALES, LOCALE_NAMES } from "@landingos/i18n";

import { requireConsoleSession } from "@/lib/console/session";
import { actionErrors } from "@/lib/console/action-errors";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { WorkspaceForm } from "@/components/console/platform/workspace-form";

export const dynamic = "force-dynamic";

/* /console/settings/workspace — B9 (CAPABILITY_AUDIT). The tenant's display
 * defaults were frozen at signup: no update path existed for name, locale,
 * currency or timezone anywhere in the platform. The slug stays immutable —
 * it is every public URL the tenant has shared.
 * `platform:workspace:manage` is SENSITIVE: OWNER/ADMIN only. */

// The zones that matter to this market plus the UTC anchor; the API accepts
// any IANA zone, so widening this list later is a UI edit, not a migration.
const TIMEZONES = [
  "Africa/Algiers", "Africa/Tunis", "Africa/Casablanca", "Africa/Cairo",
  "Europe/Paris", "Europe/London", "UTC",
];

export default async function WorkspaceSettingsPage() {
  const session = await requireConsoleSession("/console/settings/workspace");
  if (!session.auth || !can(session.auth, "platform:workspace:manage")) notFound();

  const t = await getTranslations();
  const tenant = await asPlatform().tenant.findUnique({
    where: { id: session.auth.tenantId },
    select: { slug: true, name: true, locale: true, currency: true, timezone: true },
  });
  if (!tenant) notFound();

  const timezones = TIMEZONES.includes(tenant.timezone)
    ? TIMEZONES
    : [tenant.timezone, ...TIMEZONES];

  return (
    <>
      <PageBody>
      <PageHeader title={t("workspace.title")} description={t("workspace.hint")} />
      <WorkspaceForm
        slug={tenant.slug}
        initial={{
          name: tenant.name,
          locale: tenant.locale,
          currency: tenant.currency,
          timezone: tenant.timezone,
        }}
        locales={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
        currencies={["DZD", "EUR", "USD"]}
        timezones={timezones}
        s={{
          name: t("workspace.name"),
          slug: t("workspace.slug"),
          slugHint: t("workspace.slugHint"),
          locale: t("workspace.locale"),
          currency: t("workspace.currency"),
          timezone: t("workspace.timezone"),
          save: t("common.save"),
          saved: t("common.saved"),
        }}
        errors={actionErrors(t)}
      />
      </PageBody>
    </>
  );
}
