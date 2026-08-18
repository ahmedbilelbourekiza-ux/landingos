import Link from "next/link";

import { withTenant } from "@landingos/db";

import { requireProduct } from "@/lib/console/product-page";
import { analyticsRange, storefrontAnalytics } from "@/lib/builder/analytics";
import { pruneExpiredVisits } from "@/lib/storefront/visit-retention";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Storefront analytics (AN.1) — the first read surface for first-party
 * traffic: views per page, and the Facebook-vs-TikTok breakdown, each beside
 * its order count.
 *
 * The numbers come from `storefrontAnalytics` — the one query builder the
 * contract suite exercises directly — so this screen is rendering, not
 * arithmetic. Channel labels: platform names are brand names and stay
 * untranslated; only direct/other/unattributed are locale words.
 * ========================================================================== */

const CHANNEL_BRANDS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  google: "Google",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

export default async function BuilderAnalyticsScreen({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { session, t } = await requireProduct(
    "website-builder",
    "/console/builder/analytics",
  );
  const range = analyticsRange((await searchParams).days);

  /* `withTenant`, not `forTenant`: the uniques aggregate is raw SQL and needs
   * the one bound transaction connection (the proxy cannot carry it). The
   * prune runs FIRST, in the same transaction — AN.2's read-path retention:
   * whoever looks at analytics sweeps their own expired rows, so this screen
   * never reports over data the retention rule says should be gone. */
  const data = await withTenant(session.auth!.tenantId, async (db) => {
    await pruneExpiredVisits(db);
    return storefrontAnalytics(db, range);
  });

  const channelLabel = (channel: string) =>
    CHANNEL_BRANDS[channel] ?? t(`builder.analytics.channel.${channel}` as any);

  const pageLabel = (row: (typeof data.byPage)[number]) => {
    if (row.landingPageId) return row.title ?? "—";
    return row.pageKind === "home"
      ? t("builder.analytics.storeHome")
      : t("builder.analytics.categoryPages");
  };

  return (
    <PageBody>
      <PageHeader title={t("builder.nav.analytics")} />

      {/* The counting basis, stated where the numbers are read: browser-side,
          so crawlers and the editor's own preview never count — and the
          merchant's own browsing does. Saying it beats a heuristic that
          half-hides it. */}
      <p className="text-sm text-muted-foreground">{t("builder.analytics.basis")}</p>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-4 text-sm" data-testid="analytics-totals">
          <span>
            <span className="font-semibold tabular-nums">{data.totals.views}</span>{" "}
            <span className="text-muted-foreground">{t("builder.analytics.views")}</span>
          </span>
          {/* AN.2 — visitors split new/returning; the two halves sum to the
              total by construction (returning = seen before their session
              began; new = the remainder). */}
          <span data-testid="analytics-visitors">
            <span className="font-semibold tabular-nums">{data.totals.visitors}</span>{" "}
            <span className="text-muted-foreground">{t("builder.analytics.visitors")}</span>
          </span>
          <span data-testid="analytics-new">
            <span className="font-semibold tabular-nums">{data.totals.newVisitors}</span>{" "}
            <span className="text-muted-foreground">{t("builder.analytics.newVisitors")}</span>
          </span>
          <span data-testid="analytics-returning">
            <span className="font-semibold tabular-nums">{data.totals.returningVisitors}</span>{" "}
            <span className="text-muted-foreground">{t("builder.analytics.returningVisitors")}</span>
          </span>
          <span>
            <span className="font-semibold tabular-nums">{data.totals.orders}</span>{" "}
            <span className="text-muted-foreground">{t("builder.analytics.orders")}</span>
          </span>
        </div>
        <nav className="flex gap-1 text-sm" aria-label={t("builder.analytics.rangeLabel")}>
          {[7, 30].map((days) => (
            <Link
              key={days}
              href={days === 7 ? "?" : `?days=${days}`}
              data-testid={`analytics-range-${days}`}
              className={
                range.days === days
                  ? "rounded-md bg-accent px-3 py-1 font-medium"
                  : "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {t(days === 7 ? "builder.analytics.range7" : "builder.analytics.range30")}
            </Link>
          ))}
        </nav>
      </div>

      <DataTable
        testId="analytics-pages"
        empty={t("builder.analytics.emptyPages")}
        rows={data.byPage}
        rowKey={(row) => `${row.pageKind}:${row.landingPageId ?? "-"}`}
        columns={[
          { id: "page", header: t("builder.analytics.colPage"), cell: pageLabel },
          {
            id: "views",
            header: t("builder.analytics.colViews"),
            align: "end",
            numeric: true,
            cell: (row) => row.views,
          },
          {
            id: "orders",
            header: t("builder.analytics.colOrders"),
            align: "end",
            numeric: true,
            cell: (row) => row.orders,
          },
        ]}
      />

      <DataTable
        testId="analytics-channels"
        empty={t("builder.analytics.emptyChannels")}
        rows={data.byChannel}
        rowKey={(row) => row.channel}
        rowAttrs={(row) => ({ "data-channel": row.channel })}
        columns={[
          {
            id: "channel",
            header: t("builder.analytics.colChannel"),
            cell: (row) => channelLabel(row.channel),
          },
          {
            id: "views",
            header: t("builder.analytics.colViews"),
            align: "end",
            numeric: true,
            cell: (row) => row.views,
          },
          {
            id: "orders",
            header: t("builder.analytics.colOrders"),
            align: "end",
            numeric: true,
            cell: (row) => row.orders,
          },
        ]}
      />
    </PageBody>
  );
}
