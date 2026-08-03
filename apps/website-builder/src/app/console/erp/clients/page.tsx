import { withTenant } from "@landingos/db";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";
import { CLIENT_SELECT, clientFilter, withDerived } from "@/lib/erp/clients";
import { seesWholeBook } from "@/lib/erp/scope";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The customer registry.
 *
 * The most sensitive screen in the product: every customer's name, phone
 * number, address and lifetime spend, in one scrollable list. D-05.1 made
 * `erp:clients:read` a permission no role grants implicitly, and this page
 * checks it explicitly rather than relying on the nav to have hidden the link —
 * a nav item is a hint, not a boundary, and the URL is typeable.
 *
 * The counters are LIFETIME EVENT counts and the column headings say so:
 * "delivered" is how many of this customer's orders have ever been delivered,
 * not how many currently are. Rendering them as live figures would invite
 * somebody to "fix" the arithmetic that produces them.
 * ========================================================================== */

const PAGE_SIZE = 50;

export default async function ErpClientsScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/clients");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // The same answer the API gives, from the same function. A screen that
  // rendered because the nav happened to show it would be a second, weaker
  // copy of the rule.
  if (!seesWholeBook(session)) notFound();

  const search = (await searchParams).search;
  const clients = await withTenant(session.auth!.tenantId, (db) =>
    db.client.findMany({
      where: clientFilter(typeof search === "string" ? search : undefined),
      orderBy: [{ lastOrderAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      select: CLIENT_SELECT,
    }),
  );

  const currency = session.tenant!.currency;

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.clients.title")}</h1>

      <DataTable
        testId="erp-clients-table"
        empty={t("erp.clients.none")}
        rows={clients.map(withDerived)}
        rowKey={(c) => c.id}
        rowAttrs={(c) => ({ "data-client-id": c.id })}
        columns={[
          {
            id: "customer",
            header: t("erp.clients.title"),
            cell: (c) => (
              <>
                <span className="font-medium">{c.name || "—"}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {c.phoneDisplay || c.phone}
                </span>
              </>
            ),
          },
          {
            id: "where",
            header: t("erp.orders.destination"),
            cell: (c) => (
              <span className="text-muted-foreground">
                {[c.wilaya, c.commune].filter(Boolean).join(" · ") || "—"}
              </span>
            ),
          },
          {
            id: "orders",
            header: t("erp.clients.orders"),
            numeric: true,
            align: "end",
            cell: (c) => c.totalOrders,
          },
          {
            id: "delivered",
            header: t("erp.clients.delivered"),
            numeric: true,
            align: "end",
            cell: (c) => c.deliveredOrders,
          },
          {
            id: "spent",
            header: t("erp.clients.spent"),
            numeric: true,
            align: "end",
            cell: (c) => formatMoney(c.totalSpent.toString(), locale, currency),
          },
          {
            id: "average",
            header: t("erp.clients.average"),
            numeric: true,
            align: "end",
            // Derived on read, never stored — a third number that can disagree
            // with the two it comes from. The divisor is DELIVERED orders:
            // "what do they spend when they actually take the parcel".
            cell: (c) => formatMoney(c.avgOrderValue.toString(), locale, currency),
          },
          {
            id: "last",
            header: t("erp.clients.lastOrder"),
            cell: (c) => (
              <span className="text-muted-foreground">
                {c.lastOrderAt ? formatDate(c.lastOrderAt, locale) : "—"}
              </span>
            ),
          },
          {
            id: "imported",
            header: t("erp.clients.imported"),
            cell: (c) =>
              c.importedSource ? (
                // Kept visibly separate from the counters this system observed.
                // An import must never be mistaken for history we watched happen.
                <span
                  data-testid="client-imported"
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {c.importedSource}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]}
      />
    </ConsoleShell>
  );
}
