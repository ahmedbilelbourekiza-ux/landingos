import Link from "next/link";

import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import { toneVars } from "@landingos/ui";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { seesWholeBook, orderScope } from "@/lib/erp/scope";
import { readSettings } from "@/lib/erp/settings";
import { rate } from "@/lib/erp/analytics";

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

  // Read before the counts, because the overdue threshold is the tenant's own.
  const alertMinutes = await withTenant(session.auth!.tenantId, async (db) => {
    const settings = await readSettings(db);
    return Number(settings.alertMinutes) || 60;
  });

  const stats = await withTenant(session.auth!.tenantId, async (db) => {
    const scope = orderScope(session);
    const scoped = (extra: object) =>
      Object.keys(scope).length ? { AND: [scope, extra] } : extra;

    /* LP.13 / N18 — THE THREE NUMBERS WITH THE SHORTEST REACTION TIME.
     *
     * The platform's dashboard traded the legacy's four reaction-time figures
     * for three delivery ones. In-delivery, delivered and customers are a
     * genuine gain and stay — but the four that went are the four somebody acts
     * on within the hour, and three of them come back here:
     *
     *   - the CONFIRMATION RATE, which was computed nowhere on this platform
     *     and is the number a COD call centre is managed by;
     *   - NEVER CALLED, which is not the same question as "pending": an order
     *     with three failed attempts is being worked and one with none is being
     *     ignored, and a status count cannot tell them apart;
     *   - OVERDUE, as a banner rather than a tile, because a count of orders
     *     nobody has phoned within the tenant's own `alertMinutes` is not
     *     information, it is a queue that needs draining now.
     *
     * `total` is the confirmation rate's denominator and is not a tile of its
     * own — a raw order count answers no question the others do not. */
    const [total, pending, confirmed, inDelivery, delivered, customers, revenue, neverCalled, overdue] =
      await Promise.all([
      db.fulfillmentOrder.count({ where: scoped({}) }),
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
      // The relation, not a denormalised counter: no column maintains one, and
      // a count that drifts is worse than no count on a screen people act on.
      db.fulfillmentOrder.count({ where: scoped({ calls: { none: {} } }) }),
      // Overdue is never-called AND older than the TENANT'S OWN threshold —
      // `alertMinutes`, the same setting the queue screen's badge uses, not a
      // number invented here. Two screens with two thresholds would disagree
      // about the same order.
      db.fulfillmentOrder.count({
        where: scoped({
          calls: { none: {} },
          createdAt: { lt: new Date(Date.now() - alertMinutes * 60_000) },
        }),
      }),
    ]);

    return { total, pending, confirmed, inDelivery, delivered, customers, revenue, neverCalled, overdue };
  });

  const tiles: Array<{
    id: string; label: string; value: string; href?: string; sub?: string;
  }> = [
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
      // THE NUMBER THE BUSINESS IS MANAGED BY, beside the count it is derived
      // from. It was computed nowhere on this platform before LP.13.
      sub: `${rate(stats.confirmed, stats.total)}% ${t("erp.analytics.confirmationRate")}`,
      href: "/console/erp/orders?status=confirmed",
    },
    {
      id: "never-called",
      label: t("erp.analytics.neverCalled"),
      value: String(stats.neverCalled),
      href: "/console/erp/orders?status=pending",
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
      /* The audit found `erp.overview.revenue` missing when the product detail
         screen asked for it — a `t()` key that does not exist throws
         MISSING_MESSAGE at RENDER time in the missing locale only, which is
         Arabic here and therefore the default. It exists now, and this tile
         uses it: it was borrowing "Delivered", so the overview showed two
         tiles with the same label and different numbers. */
      label: t("erp.overview.revenue"),
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

      {/* A BANNER, not a tile, and only when there is something to act on. The
          legacy shows this and the platform lost it: orders nobody has phoned
          within the company's own `alertMinutes` are a queue that needs
          draining, and a zero in a grid of tiles is furniture. */}
      {stats.overdue > 0 && (
        <div
          role="status"
          data-testid="erp-overdue-banner"
          data-overdue={stats.overdue}
          className="mt-4 rounded-lg border px-4 py-3 text-sm"
          style={toneVars("danger")}
        >
          <Link href={`/console/erp/orders?status=pending`} className="font-medium underline">
            {t("erp.overview.overdue")}: {stats.overdue}
          </Link>{" "}
          <span className="opacity-80">
            {t("erp.overview.overdueHint", { minutes: alertMinutes })}
          </span>
        </div>
      )}

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
              {tile.sub && (
                <span className="mt-0.5 block text-xs text-muted-foreground" data-sub={tile.id}>
                  {tile.sub}
                </span>
              )}
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
