import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { forTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import { getLocale } from "next-intl/server";

import { requireConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Landing pages — the builder's core screen, on the shared shell.
 *
 * A SERVER component reading through the tenant-bound client, not a client
 * component fetching /api. The legacy version fetched its own API over the
 * network from the browser; here the page and the query run in the same
 * request, so there is one round trip instead of two and no loading state to
 * design. The API route still exists for anything that genuinely needs it.
 *
 * Note what is absent: no `where: { tenantId }`. The binding is applied by
 * forTenant and enforced by row-level security, and a second filter here would
 * be a weaker copy of a rule that already holds.
 *
 * Every string is a translation key and every colour is a token. Status tone
 * comes from @landingos/ui, so a PUBLISHED page looks the same here as the
 * equivalent state does anywhere else in the platform.
 * ========================================================================== */

export default async function BuilderPagesScreen() {
  const session = await requireConsoleSession("/builder/pages");

  // Reaching for the URL must give the same answer as not seeing the link.
  if (!session.products.some((p) => p.id === "website-builder")) notFound();

  const t = await getTranslations();
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const mayEdit = can(session.auth!, "website-builder:pages:write");

  const pages = await forTenant(session.auth!.tenantId).landingPage.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, title: true, slug: true, status: true, price: true,
      currency: true, createdAt: true,
      category: { select: { name: true } },
      _count: { select: { salesOrders: true } },
    },
  });

  return (
    <ConsoleShell session={session} productId="website-builder">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("builder.nav.pages")}</h1>
        {mayEdit ? (
          <Link
            href="/builder/pages/new"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("common.create")}
          </Link>
        ) : null}
      </div>

      {pages.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("common.empty")}
        </p>
      ) : (
        // Wide content scrolls inside its own container so the page body never
        // scrolls sideways.
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm" data-testid="landings-table">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("builder.nav.pages")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("builder.nav.categories")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("builder.nav.orders")}</th>
                <th className="px-4 py-3 text-end font-medium tabular-nums">
                  {t("builder.nav.deliveryPrices")}
                </th>
                <th className="px-4 py-3 text-start font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => {
                const status = resolveStatus("landingPage", p.status);
                return (
                  <tr key={p.id} data-page-id={p.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <span className="font-medium">{p.title}</span>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        /{p.slug}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category?.name ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {p._count.salesOrders}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {/* Decimal is formatted from its string form so it never
                          passes through a JS float (M-06). */}
                      {formatMoney(String(p.price), locale, p.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        data-status={p.status}
                        className="inline-block rounded-full border px-2 py-0.5 text-xs"
                        style={toneVars(status.tone)}
                      >
                        {t(status.labelKey)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatDate(p.createdAt, locale)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ConsoleShell>
  );
}
