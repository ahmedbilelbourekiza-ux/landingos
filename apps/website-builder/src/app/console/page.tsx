import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { productRegistry } from "@landingos/product-registry";
import { requireConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageBody } from "@/components/console/ui/primitives";

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

  // hrefFor, never the bare basePath: `/builder` is the STOREFRONT namespace
  // (a tenant could be called "builder"), and redirecting there sent every
  // single-product customer's console front door to a 404 (BUILDER_AUDIT S-01).
  if (session.products.length === 1) {
    redirect(productRegistry.hrefFor(session.products[0].id) ?? "/console/settings");
  }

  return (
    <ConsoleShell session={session} productId={null}>
      <PageBody>
      <h1 className="text-xl font-semibold">{session.tenant?.name ?? "LandingOS"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {session.products.length === 0 ? t("common.noProducts") : t("common.chooseApp")}
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {session.products.map((p) => (
          <li key={p.id}>
            <a
              href={productRegistry.hrefFor(p.id) ?? "/console"}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
            >
              <span className="font-medium">{t(p.nameKey)}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(p.descriptionKey)}</span>
            </a>
          </li>
        ))}
      </ul>
      </PageBody>
    </ConsoleShell>
  );
}
