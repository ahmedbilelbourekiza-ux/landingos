import Link from "next/link";

import { can } from "@landingos/auth";

import { requireConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";

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
  const auth = session.auth;

  const sections = [
    {
      href: "/console/settings/profile",
      title: "Profile",
      description: "Your name, language and password.",
      // Everyone can edit their own profile — there is no permission to hold.
      visible: true,
    },
    {
      href: "/console/settings/store",
      title: "Store profile",
      description: "Public name, contact details and social links.",
      visible: !!auth && can(auth, "website-builder:settings:write"),
    },
    {
      href: "/console/settings/delivery-prices",
      title: "Delivery prices",
      description: "What each wilaya costs, for home delivery and stop desk.",
      visible: !!auth && can(auth, "website-builder:settings:write"),
    },
    {
      href: "/console/settings/integrations",
      title: "Integrations",
      description: "Outgoing webhooks and Meta pixels.",
      visible: !!auth && can(auth, "platform:integrations:read"),
    },
  ].filter((s) => s.visible);

  return (
    <ConsoleShell session={session} productId={null}>
      <h1 className="text-xl font-semibold">{session.tenant?.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Settings shared by every application in this workspace.
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="settings-sections">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              data-section={s.href.split("/").pop()}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
            >
              <span className="font-medium">{s.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{s.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </ConsoleShell>
  );
}
