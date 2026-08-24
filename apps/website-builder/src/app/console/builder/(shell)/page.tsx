import Link from "next/link";
import {
  CheckCircle2, FileWarning, PackagePlus, PhoneMissed,
} from "lucide-react";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatNumber, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
/* OV.1 — the traffic widget speaks the SAME definitions as the screen it
 * links to: analyticsRange("week") for the window (so the tile can never
 * disagree with the Traffic screen it opens), the same delta rules, the same
 * channel brand names. KpiTile is the console's one analytics tile (PM.1). */
import {
  analyticsRange,
  previousWindow,
  percentDelta,
  conversionRate,
  CHANNEL_BRANDS,
} from "@/lib/builder/analytics";
import { adSpendPanel } from "@/lib/builder/ad-spend-panel";
import { KpiTile } from "@/components/console/erp/dashboard-parts";
import {
  PageHeader, PageBody, Section, Notice, EmptyState, Stat, StatGrid,
} from "@/components/console/ui/primitives";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The builder's overview — rebuilt as a merchant's morning screen (UXP.1).
 *
 * WHAT IT REPLACED. Four bare tiles, one of which was labelled "Delivered"
 * while showing revenue, on a screen with no attention items, no recent
 * activity and no way into the product's first action. A merchant opening
 * their workspace was told four lifetime counts and nothing about what to do
 * next — the exact shape PM.1 replaced on the ERP's front door.
 *
 * THE ORDER OF THE PAGE follows the ERP dashboard's argument:
 *   1. WHAT NEEDS A PERSON — new orders, abandoned carts holding a phone
 *      number, finished pages nobody published. Only non-zero items render;
 *      each links to the screen where it is handled.
 *   2. WHAT THE SHOP HAS DONE — pages, orders, delivered revenue.
 *   3. WHAT JUST HAPPENED — the latest orders, each opening its record.
 *
 * Every figure is real and tenant-bound; nothing here invents a metric. Order
 * figures are additionally gated on `website-builder:orders:read` — the
 * permission the orders screens check — because a card that counts correctly
 * and links into a 404 is worse than no card (D-PM.A).
 * ========================================================================== */

export default async function BuilderOverview() {
  const { session, locale: raw, t } = await requireProduct("website-builder", "/console/builder");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const currency = session.tenant?.currency ?? "DZD";

  const mayReadOrders = can(session.auth!, "website-builder:orders:read");
  const mayWritePages = can(session.auth!, "website-builder:pages:write");

  /* ONE binding, consolidated queries — D-PM.1.3's rule, learned again here.
     The first build of this screen fired nine parallel counts through
     `forTenant`, each opening its own binding, and under suite load that is
     how the manifest nav-walk test caught this page answering 500 on the
     documented Neon connection limit. One `groupBy` per table answers what
     four counts asked. */
  /* OV.1 — the traffic widget's window: the SAME "week" the Traffic screen
     defaults to (one function, one answer — the tile must not disagree with
     the screen it opens). */
  const trafficRange = analyticsRange({ range: "week" });
  const trafficPrev = previousWindow(trafficRange);
  const inWeek = { createdAt: { gte: trafficRange.since, lt: trafficRange.until } };
  const inPrev = { createdAt: { gte: trafficPrev.since, lt: trafficPrev.until } };

  const {
    pageGroups, orderGroups, abandoned, abandonedWithPhone, recent,
    weekViews, prevViews, weekOrders, prevOrders, weekChannels, spend,
  } = await withTenant(
    session.auth!.tenantId,
    async (db) => ({
      pageGroups: await db.landingPage.groupBy({ by: ["published"], _count: { _all: true } }),
      orderGroups: mayReadOrders
        ? await db.salesOrder.groupBy({
            by: ["status"],
            _count: { _all: true },
            _sum: { totalPrice: true },
          })
        : [],
      abandoned: await db.draftOrder.count({ where: { convertedOrderId: null } }),
      abandonedWithPhone: await db.draftOrder.count({
        where: { convertedOrderId: null, phone: { not: null } },
      }),
      recent: mayReadOrders
        ? await db.salesOrder.findMany({
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
              id: true,
              customerName: true,
              totalPrice: true,
              status: true,
              createdAt: true,
              wilaya: true,
              landingPage: { select: { title: true } },
            },
          })
        : [],
      /* OV.1 — six cheap aggregates, deliberately NOT storefrontAnalytics:
         that module runs a dozen queries for tables this widget never shows,
         and this screen was specifically rebuilt (D-PM.1.3) to consolidate
         its counts after nine parallel bindings 500'd under suite load.
         Same binding, sequential, like everything above. */
      weekViews: await (db as any).storefrontVisit.count({ where: inWeek }),
      prevViews: await (db as any).storefrontVisit.count({ where: inPrev }),
      weekOrders: mayReadOrders ? await db.salesOrder.count({ where: inWeek }) : 0,
      prevOrders: mayReadOrders ? await db.salesOrder.count({ where: inPrev }) : 0,
      weekChannels: (await (db as any).storefrontVisit.groupBy({
        by: ["sourceChannel"],
        where: inWeek,
        _count: { _all: true },
      })) as { sourceChannel: string; _count: { _all: number } }[],
      spend: await adSpendPanel(db as never, trafficRange, session.tenant?.currency ?? "DZD"),
    }),
  );

  const pages = pageGroups.reduce((n, g) => n + g._count._all, 0);
  const published = pageGroups.find((g) => g.published)?._count._all ?? 0;
  const orders = orderGroups.reduce((n, g) => n + g._count._all, 0);
  const newOrders = orderGroups.find((g) => g.status === "NEW")?._count._all ?? 0;
  const deliveredGroup = orderGroups.find((g) => g.status === "DELIVERED");
  const delivered = deliveredGroup?._count._all ?? 0;
  // Revenue counts DELIVERED only. An order that was placed is not money; an
  // order that arrived is.
  const earned = deliveredGroup?._sum.totalPrice ?? 0;
  const draftPages = pages - published;

  /* OV.1 — the widget's derived figures: conversion in points (a rate
     compares by difference), the leading source by views. */
  const weekConv = mayReadOrders ? conversionRate(weekOrders, weekViews) : null;
  const prevWeekConv = mayReadOrders ? conversionRate(prevOrders, prevViews) : null;
  const weekConvDelta =
    weekConv !== null && prevWeekConv !== null ? weekConv - prevWeekConv : null;
  const topChannel = weekChannels
    .map((g) => ({ channel: g.sourceChannel, views: g._count._all }))
    .sort((a, b) => b.views - a.views)[0] ?? null;

  /* 1 — what needs a person. Rendered only when non-zero, like the ERP's
     attention panel: a grid of zeros is furniture. */
  const alerts: {
    id: string;
    count: number;
    href: string;
    label: string;
    hint: string;
    icon: React.ReactNode;
  }[] = [];
  if (mayReadOrders && newOrders > 0) {
    alerts.push({
      id: "new-orders",
      count: newOrders,
      href: "/console/builder/orders",
      label: t("builder.overview.newOrders"),
      hint: t("builder.overview.newOrdersHint"),
      icon: <PackagePlus className="size-4" />,
    });
  }
  if (mayReadOrders && abandonedWithPhone > 0) {
    alerts.push({
      id: "abandoned-leads",
      count: abandonedWithPhone,
      href: "/console/builder/abandoned",
      label: t("builder.overview.abandonedLeads"),
      hint: t("builder.overview.abandonedLeadsHint"),
      icon: <PhoneMissed className="size-4" />,
    });
  }
  if (draftPages > 0) {
    alerts.push({
      id: "draft-pages",
      count: draftPages,
      href: "/console/builder/pages",
      label: t("builder.overview.draftPages"),
      hint: t("builder.overview.draftPagesHint"),
      icon: <FileWarning className="size-4" />,
    });
  }

  return (
    <>
      <PageBody>
        <PageHeader
          title={session.tenant?.name}
          description={t("product.websiteBuilder.description")}
        />

        {pages === 0 ? (
          /* A brand-new workspace: the one situation where the screen's job is
             not to report but to start. */
          <EmptyState
            testId="builder-first-page"
            title={t("builder.overview.firstPageTitle")}
            description={t("builder.overview.firstPageHint")}
            action={
              mayWritePages ? (
                <Link href="/console/builder/pages/new" className="ui-btn ui-btn-primary tap">
                  {t("builder.overview.createPage")}
                </Link>
              ) : undefined
            }
          />
        ) : alerts.length > 0 ? (
          <Section
            title={t("builder.overview.attention")}
            description={t("builder.overview.attentionHint")}
            testId="builder-attention"
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {alerts.map((a) => (
                <Link
                  key={a.id}
                  href={a.href}
                  data-alert={a.id}
                  className="tap flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:border-muted-foreground/30"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border"
                    style={toneVars("warning")}
                  >
                    {a.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-lg font-semibold tabular-nums" dir="ltr">
                        {formatNumber(a.count, locale)}
                      </span>
                      <span className="text-sm font-medium text-foreground">{a.label}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{a.hint}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        ) : (
          <Notice
            tone={toneVars("success")}
            testId="builder-attention-clear"
            icon={<CheckCircle2 className="size-4" />}
          >
            <span className="font-medium">{t("builder.overview.allClear")}</span>{" "}
            <span className="opacity-80">{t("builder.overview.allClearHint")}</span>
          </Notice>
        )}

        {/* OV.1 — traffic, the last 7 days, in the console's analytics
            language: views with their week-over-week delta, conversion with
            its denominators, the leading source, and real ad spend when an
            account is connected. Every figure clicks through to the Traffic
            screen, whose default window is THIS window by construction. A
            store with no views yet gets one quiet line, not four zero tiles. */}
        {pages > 0 && (
          <Section
            title={t("builder.overview.trafficTitle")}
            testId="builder-traffic"
            actions={
              <Link href="/console/builder/analytics" className="ui-btn ui-btn-default ui-btn-sm tap">
                {t("builder.overview.trafficView")}
              </Link>
            }
          >
            {weekViews === 0 ? (
              <p className="py-2 text-sm text-muted-foreground" data-testid="builder-traffic-none">
                {t("builder.overview.trafficNone")}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile
                  id="ov-traffic-views"
                  label={t("builder.overview.trafficViews")}
                  value={formatNumber(weekViews, locale)}
                  delta={percentDelta(weekViews, prevViews)}
                  deltaKind="percent"
                  riseIsGood
                  comparison={t("builder.analytics.vsPrevious")}
                  noComparison={t("builder.analytics.noPrevious")}
                  href="/console/builder/analytics"
                />
                {mayReadOrders && (
                  <KpiTile
                    id="ov-traffic-conversion"
                    label={t("builder.analytics.kpiConversion")}
                    value={weekConv === null ? "—" : weekConv.toFixed(1)}
                    suffix={weekConv === null ? undefined : "%"}
                    sub={`${formatNumber(weekOrders, locale)} / ${formatNumber(weekViews, locale)}`}
                    delta={weekConvDelta}
                    deltaKind="points"
                    riseIsGood
                    comparison={t("builder.analytics.vsPrevious")}
                    noComparison={t("builder.analytics.noPrevious")}
                    href="/console/builder/analytics"
                  />
                )}
                {topChannel && (
                  <KpiTile
                    id="ov-traffic-source"
                    label={t("builder.overview.trafficTopSource")}
                    value={
                      CHANNEL_BRANDS[topChannel.channel] ??
                      t(`builder.analytics.channel.${topChannel.channel}` as never)
                    }
                    sub={t("builder.overview.trafficShare", {
                      share: Math.round((topChannel.views / weekViews) * 100),
                    })}
                    delta={null}
                    deltaKind="percent"
                    riseIsGood
                    comparison=""
                    noComparison={t("builder.overview.trafficLast7")}
                    href="/console/builder/analytics"
                  />
                )}
                {spend.state === "ready" && (
                  <KpiTile
                    id="ov-traffic-spend"
                    label={t("builder.analytics.adSpendTitle")}
                    value={spend.spend}
                    sub={`${spend.currency} · ${formatNumber(spend.orders, locale)} ${t("builder.analytics.adSpendOrders")}`}
                    delta={null}
                    deltaKind="percent"
                    riseIsGood={false}
                    comparison=""
                    noComparison={t("builder.overview.trafficLast7")}
                    href="/console/builder/analytics"
                  />
                )}
              </div>
            )}
          </Section>
        )}

        {/* 2 — what the shop has. */}
        <StatGrid testId="builder-overview">
          <Stat
            label={t("builder.nav.pages")}
            value={formatNumber(pages, locale)}
            sub={`${formatNumber(published, locale)} ${t("status.landingPage.published")}`}
            href="/console/builder/pages"
          />
          {mayReadOrders && (
            <Stat
              label={t("builder.nav.orders")}
              value={formatNumber(orders, locale)}
              sub={`${formatNumber(delivered, locale)} ${t("status.salesOrder.delivered")}`}
              href="/console/builder/orders"
            />
          )}
          <Stat
            label={t("builder.nav.abandoned")}
            value={formatNumber(abandoned, locale)}
            href={mayReadOrders ? "/console/builder/abandoned" : undefined}
          />
          {mayReadOrders && (
            <Stat
              label={t("builder.overview.revenue")}
              value={formatMoney(String(earned), locale, currency)}
              sub={`${formatNumber(delivered, locale)} ${t("status.salesOrder.delivered")}`}
            />
          )}
        </StatGrid>

        {/* 3 — what just happened. */}
        {mayReadOrders && pages > 0 && (
          <Section
            title={t("builder.overview.recentOrders")}
            testId="builder-recent-orders"
            actions={
              <Link href="/console/builder/orders" className="ui-btn ui-btn-default ui-btn-sm tap">
                {t("builder.overview.viewAll")}
              </Link>
            }
          >
            {recent.length === 0 ? (
              <EmptyState
                compact
                title={t("builder.overview.noOrdersYet")}
                description={t("builder.overview.noOrdersYetHint")}
              />
            ) : (
              <ul className="-mx-1 divide-y divide-border">
                {recent.map((o) => {
                  const s = resolveStatus("salesOrder", o.status);
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/console/builder/orders/${o.id}`}
                        data-order-row={o.id}
                        className="tap flex items-center gap-3 rounded-md px-1 py-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {o.customerName}
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                            {[o.landingPage?.title, o.wilaya].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                        <span className="shrink-0 text-end">
                          <span
                            className="block text-sm font-medium tabular-nums text-foreground"
                            dir="ltr"
                          >
                            {formatMoney(String(o.totalPrice), locale, currency)}
                          </span>
                          <span className="mt-0.5 block text-2xs text-muted-foreground">
                            {formatDate(o.createdAt, locale)}
                          </span>
                        </span>
                        <span
                          className="hidden shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium sm:inline-flex"
                          style={toneVars(s.tone)}
                        >
                          {t(s.labelKey)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        )}
      </PageBody>
    </>
  );
}
