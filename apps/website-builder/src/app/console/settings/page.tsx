import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CreditCard, Plug, Store, Truck, UserRound, Users } from "lucide-react";

import { can } from "@landingos/auth";

import { requireConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Platform settings.
 *
 * Owned by the SHELL, not by a product. A tenant running ten products still
 * has one company profile, one team, one set of integrations — which is why
 * none of these appear in any product manifest, and why adding a product adds
 * nothing here.
 *
 * Sections are filtered by permission, so this page never offers a link that
 * leads to a 403.
 * ========================================================================== */

export default async function SettingsIndex() {
  const session = await requireConsoleSession("/console/settings");
  const t = await getTranslations();
  const auth = session.auth;

  /* UI.21 — every string here was an English literal, in a product whose
     default locale is Arabic. AUDIT.4's i18n scan reads `t("…")` calls, so it
     could never see a string that never went through `t()` — which is exactly
     how six settings screens kept theirs. Assumption 6 is "every user-facing
     string is an i18n key. No literals." */
  const sections = [
    {
      href: "/console/settings/profile",
      icon: UserRound,
      title: t("settings.profile"),
      description: t("settings.profileHint"),
      // Everyone can edit their own profile — there is no permission to hold.
      visible: true,
    },
    {
      href: "/console/settings/store",
      icon: Store,
      title: t("settings.store"),
      description: t("settings.storeHint"),
      visible: !!auth && can(auth, "website-builder:settings:write"),
    },
    {
      href: "/console/settings/delivery-prices",
      icon: Truck,
      title: t("settings.deliveryPrices"),
      description: t("settings.deliveryPricesHint"),
      visible: !!auth && can(auth, "website-builder:settings:write"),
    },
    {
      href: "/console/settings/integrations",
      icon: Plug,
      title: t("settings.integrations"),
      description: t("settings.integrationsHint"),
      visible: !!auth && can(auth, "platform:integrations:read"),
    },
    {
      href: "/console/settings/team",
      icon: Users,
      title: t("settings.team"),
      description: t("settings.teamHint"),
      // `platform:team:read` is SENSITIVE — a MANAGER running the day does not
      // decide who works here, so the link is absent for them by itself.
      visible: !!auth && can(auth, "platform:team:read"),
    },
    {
      href: "/console/settings/billing",
      icon: CreditCard,
      title: t("settings.billing"),
      description: t("settings.billingHint"),
      // `platform:billing:read` is SENSITIVE — a MANAGER does not decide what
      // the company pays for.
      visible: !!auth && can(auth, "platform:billing:read"),
    },
  ].filter((s) => s.visible);

  return (
    <ConsoleShell session={session} productId={null}>
      <PageBody>
      <PageHeader
        title={session.tenant?.name ?? t("common.settings")}
        description={t("settings.subtitle")}
      />

      <ul
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(17rem,1fr))]"
        data-testid="settings-sections"
      >
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              data-section={s.href.split("/").pop()}
              className="flex h-full items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 transition-colors duration-(--duration-fast) hover:border-primary/40 hover:bg-surface-hover"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground"
              >
                <s.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{s.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{s.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      </PageBody>
    </ConsoleShell>
  );
}
