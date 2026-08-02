import Link from "next/link";

import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { seesWholeBook, orderScope } from "@/lib/erp/scope";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The ERP's front door — the first real ERP screen (Phase 6.1).
 *
 * Until now `/console/erp` was served by the generic `console/[product]` route
 * with an honest placeholder. A static segment wins over a dynamic sibling in
 * Next, so this file takes over that path and the generic route carries on
 * serving any OTHER product that ships no screens — which is the property the
 * registry exists to protect and the reason nothing else had to change.
 *
 * WHAT IT SHOWS DEPENDS ON WHO IS LOOKING, and not cosmetically. A confirmation
 * agent's counts are scoped to their own queue by the same `orderScope` the API
 * uses, so the number on this page is the number of orders they can actually
 * open. A manager sees the whole book. Showing an agent a company-wide total
 * they cannot act on would be both a leak and a lie about their workload.
 * ========================================================================== */

export default async function ErpOverview() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const wholeBook = seesWholeBook(session);

  const stats = await withTenant(session.auth!.tenantId, async (db) => {
    const scope = orderScope(session);
    const scoped = (extra: object) =>
      Object.keys(scope).length ? { AND: [scope, extra] } : extra;

    const [pending, confirmed, inDelivery, delivered, customers, revenue] = await Promise.all([
      db.fulfillmentOrder.count({ where: scoped({ status: "pending" }) }),
      db.fulfillmentOrder.count({ where: scoped({ status: "confirmed" }) }),
      db.fulfillmentOrder.count({
        where: scoped({
          deliveryStatus: { in: ["dispatched", "in_transit", "at_office", "out_for_delivery"] },
        }),
      }),
      db.fulfillmentOrder.count({ where: scoped({ deliveryOutcome: "delivered" }) }),
      // The customer registry is D-05.1 sensitive, so an agent is not shown a
      // count of it. Absent, not zero: a zero would be a lie that reads as a
      // fact about the business.
      wholeBook ? db.client.count() : null,
      wholeBook
        ? db.fulfillmentOrder.aggregate({
            where: { deliveryOutcome: "delivered" },
            _sum: { price: true },
          })
        : null,
    ]);

    return { pending, confirmed, inDelivery, delivered, customers, revenue };
  });

  const tiles: Array<{ id: string; label: string; value: string; href?: string }> = [
    {
      id: "pending",
      label: t("erp.overview.pending"),
      value: String(stats.pending),
      href: "/console/erp/orders?status=pending",
    },
    {
      id: "confirmed",
      label: t("erp.overview.confirmed"),
      value: String(stats.confirmed),
      href: "/console/erp/orders?status=confirmed",
    },
    { id: "in-delivery", label: t("erp.overview.inDelivery"), value: String(stats.inDelivery) },
    { id: "delivered", label: t("erp.overview.delivered"), value: String(stats.delivered) },
  ];

  if (stats.customers !== null) {
    tiles.push({
      id: "customers",
      label: t("erp.overview.customers"),
      value: String(stats.customers),
    });
  }
  if (stats.revenue) {
    tiles.push({
      id: "revenue",
      label: t("erp.overview.delivered"),
      // Formatted from the Decimal's STRING form. Going through a JS number
      // here would undo M-06 at the last step, in the one place a person reads.
      value: formatMoney((stats.revenue._sum.price ?? 0).toString(), locale, session.tenant!.currency),
    });
  }

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.overview.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("erp.overview.subtitle")} ·{" "}
        <span data-testid="erp-scope">
          {wholeBook ? t("erp.overview.wholeBook") : t("erp.overview.myQueue")}
        </span>
      </p>

      <div
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="erp-overview-tiles"
      >
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="block text-xs text-muted-foreground">{tile.label}</span>
              {/* tabular-nums so a column of figures lines up, and dir="ltr"
                  because a number is read left-to-right even on an RTL page. */}
              <span className="mt-1 block text-2xl font-semibold tabular-nums" dir="ltr">
                {tile.value}
              </span>
            </>
          );
          return tile.href ? (
            <Link
              key={tile.id}
              href={tile.href}
              data-tile={tile.id}
              className="rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
            >
              {body}
            </Link>
          ) : (
            <div key={tile.id} data-tile={tile.id} className="rounded-lg border border-border p-4">
              {body}
            </div>
          );
        })}
      </div>
    </ConsoleShell>
  );
}
