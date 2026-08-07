import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import { toneVars } from "@landingos/ui";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, Notice, Stat, StatGrid } from "@/components/console/ui/primitives";
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
      <PageHeader
        title={t("erp.overview.title")}
        description={
          <>
            {t("erp.overview.subtitle")} ·{" "}
            <span data-testid="erp-scope">
              {wholeBook ? t("erp.overview.wholeBook") : t("erp.overview.myQueue")}
            </span>
          </>
        }
      />

      {/* A BANNER, not a tile, and only when there is something to act on. The
          legacy shows this and the platform lost it: orders nobody has phoned
          within the company's own `alertMinutes` are a queue that needs
          draining, and a zero in a grid of tiles is furniture.

          UI.20 — it LEADS the screen now rather than sitting between the title
          and a grid of six equal tiles. It is the only thing on this page with a
          deadline; everything below it is a figure to read, not a queue to
          drain, and a dashboard that gives them the same weight has no
          hierarchy at all. */}
      {stats.overdue > 0 && (
        <Notice
          tone={toneVars("danger")}
          testId="erp-overdue-banner"
          data-overdue={String(stats.overdue)}
          icon={<AlertTriangle className="size-4" />}
          className="mb-4"
        >
          <Link
            href={`/console/erp/orders?status=pending`}
            className="font-medium underline underline-offset-2"
          >
            {t("erp.overview.overdue")}: {stats.overdue}
          </Link>{" "}
          <span className="opacity-80">
            {t("erp.overview.overdueHint", { minutes: alertMinutes })}
          </span>
        </Notice>
      )}

      {/* `auto-fit`, not `lg:grid-cols-3`: five tiles on a laptop became three
          and two-stretched-to-fill, and an agent — who is not shown the customer
          count (D-05.1) — got a hole where it would have been. */}
      <StatGrid testId="erp-overview-tiles">
        {tiles.map((tile) => (
          <Stat
            key={tile.id}
            id={tile.id}
            label={tile.label}
            value={tile.value}
            sub={tile.sub}
            href={tile.href}
          />
        ))}
      </StatGrid>
    </ConsoleShell>
  );
}
