import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";

export const dynamic = "force-dynamic";

/**
 * The console entry point.
 *
 * With one product, go straight there — an interstitial asking someone to pick
 * from a list of one is a click that teaches nothing. With several, show them.
 */
export default async function ConsoleHome() {
  const session = await requireConsoleSession("/console");
  const t = await getTranslations();

  if (session.products.length === 1) redirect(session.products[0].basePath);

  return (
    <ConsoleShell session={session} productId={null}>
      <h1 className="text-xl font-semibold">{session.tenant?.name ?? "LandingOS"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {session.products.length === 0
          ? "No products are enabled for this company."
          : "Choose an application to open."}
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {session.products.map((p) => (
          <li key={p.id}>
            <a
              href={p.basePath}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
            >
              <span className="font-medium">{t(p.nameKey)}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(p.descriptionKey)}</span>
            </a>
          </li>
        ))}
      </ul>
    </ConsoleShell>
  );
}
