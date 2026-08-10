import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, Clock, PackageX, PhoneOff, PlugZap,
  ShieldAlert, TrendingDown, Truck,
} from "lucide-react";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import { resolveStatus, toneVars } from "@landingos/ui";

import { requireProduct } from "@/lib/console/product-page";
import {
  PageHeader, PageBody, Section, Notice, EmptyState,
} from "@/components/console/ui/primitives";
import {
  PeriodTabs, KpiTile, AlertCard, TrendChart, RankList,
  type RankRow, type TrendBar,
} from "@/components/console/erp/dashboard-parts";
import { StockChip } from "@/components/console/erp/stock-chip";
import { ProductThumb } from "@/components/console/erp/product-thumb";
import { seesWholeBook, orderScope, followupScope } from "@/lib/erp/scope";
import { readSettings } from "@/lib/erp/settings";
import {
  readDashboard, DASHBOARD_RANGES, isDashboardRange, type DashboardRange,
} from "@/lib/erp/dashboard";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The ERP's front door — rebuilt as an operational dashboard (PM.1).
 *
 * WHAT IT REPLACED, and why replacing it was the highest-value thing left in
 * this product. `/console/erp` was six lifetime counts and a banner. Every
 * figure on it was a total with no period, no comparison and no trend, so the
 * screen answered "how many confirmed orders exist" — a question nobody has —
 * and never "is this week going better or worse than last", which is the only
 * question a manager opens a dashboard with. Nothing on it was a decision, and
 * the one thing that was (the overdue banner) had to fight a grid of tiles for
 * attention.
 *
 * THE ORDER OF THE PAGE IS THE ARGUMENT:
 *
 *   1. WHAT NEEDS A PERSON. Only what is non-zero, each linking to the screen
 *      where it gets fixed. When there is nothing, the page says so in one line
 *      instead of showing six zeros — a panel of zeros is furniture, and
 *      furniture is what people stop reading.
 *   2. WHAT THE PERIOD DID, each figure against the same length of time before
 *      it. A confirmation rate with no comparison is trivia.
 *   3. THE SHAPE OVER TIME, so a slide is visible as a slope rather than
 *      inferred from one number.
 *   4. WHO AND WHAT IS DOING IT — agents, carriers, products, and the stock
 *      that is about to stop all three.
 *
 * WHAT IT SHOWS DEPENDS ON WHO IS LOOKING, and not cosmetically. Every figure
 * is scoped by the same `orderScope` the API uses, so a confirmation agent's
 * dashboard is their own queue. The league table of colleagues additionally
 * requires `erp:agents:manage` — the permission the analytics route checks for
 * the same table — because a screen reading the database directly must apply
 * the permission its API equivalent applies.
 * ========================================================================== */

export default async function ErpOverview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const wholeBook = seesWholeBook(session);
  const supervisor = can(session.auth!, "erp:agents:manage");

  const requested = (await searchParams).range;
  const rangeParam = Array.isArray(requested) ? requested[0] : requested;
  // An unknown window renders the default rather than refusing — the rule
  // `orderSort` and `rangeBounds` already apply to a stale bookmark.
  const range: DashboardRange = isDashboardRange(rangeParam) ? rangeParam : "today";

  const { alertMinutes, data, members } = await withTenant(
    session.auth!.tenantId,
    async (db) => {
      // Read before the counts: the overdue threshold is the tenant's own, and
      // the queue badge, the order row and this all take it from here.
      const settings = await readSettings(db);
      const alertMinutes = Number(settings.alertMinutes) || 60;

      const data = await readDashboard(db, {
        range,
        scope: orderScope(session),
        alertMinutes,
        /* EACH OF THESE IS THE PERMISSION ITS DESTINATION CHECKS, read off the
           manifest's own nav gates. A card that counts something correctly and
           links into a 404 is worse than no card. */
        mayManageAgents: supervisor,
        mayReachCarriers: can(session.auth!, "erp:shipments:write"),
        mayReachChannels: can(session.auth!, "erp:settings:write"),
        mayReachInventory: can(session.auth!, "erp:inventory:write"),
        // D-05.1 — the registry is sensitive, so the count is absent for
        // somebody who may not read it rather than shown as a zero.
        maySeeCustomers: wholeBook,
        followupScope: followupScope(session),
      });

      // Only to turn a user id into a name in the roster panel. Read once,
      // never once per row, and never at all for somebody who is not shown it.
      const members = supervisor
        ? await db.membership.findMany({
            select: { userId: true, user: { select: { name: true, email: true } } },
          })
        : [];

      return { alertMinutes, data, members };
    },
  );

  const currency = session.tenant!.currency;
  const money = (v: string) => formatMoney(v, locale, currency);
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name || m.user.email]));

  /* Literal keys in a record, never `t(\`erp…${id}\`)`. The i18n suite scans
     `t("literal")` calls and cannot see a runtime key — which is how a missing
     Arabic string becomes a 500 on the default locale and a green build for
     everybody else (AUDIT.4). */
  const ALERT_LABEL: Record<string, { label: string; hint: string; icon: React.ReactNode }> = {
    overdue: {
      label: t("erp.overview.alertOverdue"),
      hint: t("erp.overview.overdueHint", { minutes: alertMinutes }),
      icon: <Clock className="size-4" />,
    },
    unbooked: {
      label: t("erp.overview.alertUnbooked"),
      hint: t("erp.overview.alertUnbookedHint"),
      icon: <Truck className="size-4" />,
    },
    followupDue: {
      label: t("erp.overview.alertFollowup"),
      hint: t("erp.overview.alertFollowupHint"),
      icon: <AlertTriangle className="size-4" />,
    },
    stockOut: {
      label: t("erp.overview.alertStockOut"),
      hint: t("erp.overview.alertStockOutHint"),
      icon: <PackageX className="size-4" />,
    },
    stockCritical: {
      label: t("erp.overview.alertStockCritical"),
      hint: t("erp.overview.alertStockCriticalHint"),
      icon: <TrendingDown className="size-4" />,
    },
    suspicious: {
      label: t("erp.overview.alertSuspicious"),
      hint: t("erp.overview.alertSuspiciousHint"),
      icon: <ShieldAlert className="size-4" />,
    },
    carrierFailures: {
      label: t("erp.overview.alertCarrier"),
      hint: t("erp.overview.alertIntegrationHint"),
      icon: <PlugZap className="size-4" />,
    },
    channelFailures: {
      label: t("erp.overview.alertChannel"),
      hint: t("erp.overview.alertIntegrationHint"),
      icon: <PlugZap className="size-4" />,
    },
  };

  /* The tile ids are the same words `data-tile=` has carried since Phase 6.1,
     because two of them are contract BOUNDARIES rather than markup: an agent is
     not shown `customers` (D-05.1), and the confirmation rate is rendered with
     the count it comes from. */
  const KPI_LABEL: Record<
    string,
    { label: string; suffix?: string; href?: string; tileId?: string; subId?: string }
  > = {
    orders: { label: t("erp.analytics.orders"), href: `/console/erp/orders?range=${range}` },
    confirmationRate: {
      label: t("erp.analytics.confirmationRate"),
      suffix: "%",
      tileId: "confirmation-rate",
      subId: "confirmed",
      href: `/console/erp/orders?status=confirmed&range=${range}`,
    },
    neverCalled: {
      label: t("erp.analytics.neverCalled"),
      tileId: "never-called",
      href: "/console/erp/orders?status=pending&sort=createdAt&dir=asc",
    },
    confirmedValue: { label: t("erp.analytics.confirmedValue"), tileId: "confirmed-value" },
    deliveredValue: { label: t("erp.overview.revenue"), tileId: "delivered-value" },
    deliveryRate: {
      label: t("erp.analytics.deliveryRate"),
      suffix: "%",
      tileId: "delivery-rate",
      subId: "delivered",
    },
    returnRate: { label: t("erp.overview.returnRate"), suffix: "%", tileId: "return-rate" },
    averageOrder: { label: t("erp.analytics.averageOrder"), tileId: "average-order" },
    customers: {
      label: t("erp.overview.customers"),
      href: "/console/erp/clients",
    },
  };

  /* A quoted literal, not a template one, and it is not a style preference:
     `packages/i18n`'s scan reads `t("literal")` calls and cannot see a runtime
     key — which is how AUDIT.4's missing string became a 500 on the default
     locale and a green build for everybody else. The period name below has to
     be interpolated and therefore cannot be protected; this does not. */
  const comparison = t("erp.overview.vsPrevious", {
    period: t(`erp.filters.range.${range}` as "erp.filters.range.today"),
  });

  const bars: TrendBar[] = data.trend.map((p) => ({
    day: p.day,
    // Day and month only — a 30-bar axis with full dates is unreadable, and the
    // year is the same for every bar on any window this screen offers.
    label: formatDate(new Date(`${p.day}T12:00:00`), locale).replace(/,.*$/, ""),
    orders: p.orders,
    confirmed: p.confirmed,
  }));

  const maxAgentOrders = data.agents.reduce((m, a) => Math.max(m, a.orders), 0);
  const agentRows: RankRow[] = data.agents.map((a) => ({
    key: a.key || "unassigned",
    label: a.key ? (nameOf.get(a.key) ?? a.key) : t("erp.orders.unassigned"),
    sub: `${a.confirmed}/${a.orders} · ${money(a.value)}`,
    value: `${a.rate}%`,
    share: maxAgentOrders ? (a.orders / maxAgentOrders) * 100 : 0,
    href: a.key ? `/console/erp/orders?agentUserId=${encodeURIComponent(a.key)}&range=${range}` : undefined,
    // The bar length is workload and the colour is quality, so a busy agent
    // converting badly reads differently from a busy agent converting well.
    tone: Number(a.rate) >= 60 ? "success" : Number(a.rate) >= 40 ? "warning" : "danger",
  }));

  const maxProductOrders = data.products.reduce((m, p) => Math.max(m, p.orders), 0);
  const productRows: RankRow[] = data.products.map((p) => ({
    key: p.key || "unknown",
    label: p.key || t("erp.analytics.unknown"),
    sub: `${p.orders} · ${p.rate}%`,
    value: money(p.value),
    share: maxProductOrders ? (p.orders / maxProductOrders) * 100 : 0,
    tone: "primary",
  }));

  const carrierRows: RankRow[] = data.carriers.map((c) => ({
    key: c.key || "none",
    label: c.key || t("erp.analytics.unknown"),
    sub: `${c.delivered} / ${c.shipped}`,
    value: `${c.deliveryRate}%`,
    share: Number(c.deliveryRate),
    tone: Number(c.deliveryRate) >= 80 ? "success" : Number(c.deliveryRate) >= 60 ? "warning" : "danger",
  }));

  return (
    <>
      <PageBody>
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
          actions={
            <PeriodTabs
              basePath="/console/erp"
              active={range}
              label={t("erp.overview.period")}
              options={DASHBOARD_RANGES.map((r) => ({
                value: r,
                label: t(`erp.filters.range.${r}` as "erp.filters.range.today"),
              }))}
            />
          }
        />

        {/* 1 — WHAT NEEDS A PERSON.
            It leads the screen because it is the only part of it with a
            deadline. Everything below is a figure to read; this is a queue to
            drain, and a dashboard that gives them equal weight has no
            hierarchy at all. */}
        {data.alerts.length > 0 ? (
          <Section
            title={t("erp.overview.attention")}
            description={t("erp.overview.attentionHint")}
            testId="erp-attention"
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {data.alerts.map((a) => (
                <AlertCard
                  key={a.id}
                  id={a.id}
                  count={a.count}
                  href={a.href}
                  severity={a.severity}
                  label={ALERT_LABEL[a.id]?.label ?? a.id}
                  hint={ALERT_LABEL[a.id]?.hint ?? ""}
                  icon={ALERT_LABEL[a.id]?.icon}
                  /* The overdue queue kept its old hooks. It IS the banner that
                     used to sit above the tiles — restyled and moved into the
                     panel where the rest of the day's work is — and the suite
                     asserts a real property about it: absent when there is
                     nothing to drain, present with the count when there is. */
                  testId={a.id === "overdue" ? "erp-overdue-banner" : undefined}
                  data-overdue={a.id === "overdue" ? a.count : undefined}
                />
              ))}
            </div>
          </Section>
        ) : (
          <Notice
            tone={toneVars("success")}
            testId="erp-attention-clear"
            icon={<CheckCircle2 className="size-4" />}
          >
            <span className="font-medium">{t("erp.overview.allClear")}</span>{" "}
            <span className="opacity-80">{t("erp.overview.allClearHint")}</span>
          </Notice>
        )}

        {/* 2 — WHAT THE PERIOD DID. */}
        <div
          data-testid="erp-overview-tiles"
          className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12.5rem,1fr))]"
        >
          {data.kpis.map((k) => {
            const meta = KPI_LABEL[k.id];
            return (
              <KpiTile
                key={k.id}
                id={meta?.tileId ?? k.id}
                label={meta?.label ?? k.id}
                suffix={meta?.suffix}
                href={meta?.href}
                value={k.kind === "money" ? money(k.value) : k.value}
                sub={
                  k.parts
                    ? t("erp.overview.ofTotal", { n: k.parts[0], total: k.parts[1] })
                    : undefined
                }
                subId={meta?.subId}
                delta={k.delta}
                deltaKind={k.deltaKind}
                riseIsGood={k.riseIsGood}
                comparison={comparison}
                noComparison={t("erp.overview.noComparison")}
              />
            );
          })}
        </div>

        {/* 3 — THE SHAPE OVER TIME. */}
        <Section
          title={t("erp.overview.trend")}
          description={t("erp.overview.trendHint")}
          testId="erp-trend-section"
          actions={
            <Link href="/console/erp/analytics" className="ui-btn ui-btn-default ui-btn-sm tap">
              {t("erp.overview.openAnalytics")}
            </Link>
          }
        >
          <TrendChart
            bars={bars}
            emptyLabel={t("erp.overview.trendEmpty")}
            labels={{
              caption: t("erp.overview.trend"),
              day: t("erp.overview.day"),
              orders: t("erp.analytics.orders"),
              confirmed: t("erp.overview.confirmed"),
            }}
          />
        </Section>

        {/* 4 — WHO AND WHAT. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Section
            title={t("erp.overview.recentOrders")}
            testId="erp-recent-orders"
            actions={
              <Link href="/console/erp/orders" className="ui-btn ui-btn-default ui-btn-sm tap">
                {t("erp.overview.viewAll")}
              </Link>
            }
          >
            {data.recent.length === 0 ? (
              <EmptyState compact title={t("erp.orders.noneYet")} />
            ) : (
              <ul className="-mx-1 divide-y divide-border">
                {data.recent.map((o) => {
                  const tone = resolveStatus("confirmation", o.status);
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/console/erp/orders/${o.id}`}
                        data-order-row={o.id}
                        className="tap flex items-center gap-3 rounded-md px-1 py-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-xs text-foreground" dir="ltr">
                              {o.reference ?? o.id.slice(0, 8)}
                            </span>
                            <span className="truncate text-sm text-foreground">
                              {o.client || "—"}
                            </span>
                            {/* The one fact a manager reads this list for that a
                                status cannot carry: has anybody phoned yet. */}
                            {!o.called && o.status === "pending" && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-medium leading-none"
                                style={toneVars("warning")}
                              >
                                <PhoneOff aria-hidden="true" className="size-2.5" />
                                {t("erp.analytics.neverCalled")}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                            {[o.product, o.wilaya].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                        <span className="shrink-0 text-end">
                          <span
                            className="block text-sm font-medium tabular-nums text-foreground"
                            dir="ltr"
                          >
                            {money(o.price)}
                          </span>
                          <span className="mt-0.5 block text-2xs text-muted-foreground">
                            {formatDate(o.createdAt, locale)}
                          </span>
                        </span>
                        <span
                          className="hidden shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium sm:inline-flex"
                          style={toneVars(tone.tone)}
                        >
                          {t(tone.labelKey as "status.unknown")}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title={t("erp.overview.stockAlerts")}
            testId="erp-stock-alerts"
            actions={
              // The stockroom for somebody who may open it, the catalogue for
              // everybody else — the same rule the stock alert cards apply.
              <Link
                href={
                  can(session.auth!, "erp:inventory:write")
                    ? "/console/erp/inventory"
                    : "/console/erp/products"
                }
                className="ui-btn ui-btn-default ui-btn-sm tap"
              >
                {t("erp.overview.viewAll")}
              </Link>
            }
          >
            {data.stock.length === 0 ? (
              <EmptyState
                compact
                title={t("erp.inventory.healthy")}
                description={t("erp.overview.stockHealthyHint")}
              />
            ) : (
              <ul className="-mx-1 divide-y divide-border">
                {data.stock.map((s) => (
                  <li key={`${s.productId}:${s.variantName ?? ""}`}>
                    <Link
                      href={`/console/erp/products/${s.productId}`}
                      data-stock-row={s.productId}
                      className="tap flex items-center gap-2.5 rounded-md px-1 py-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                    >
                      <ProductThumb src={s.image} alt="" size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {s.name || "—"}
                        </span>
                        {s.variantName && (
                          <span className="block truncate text-2xs text-muted-foreground">
                            {s.variantName}
                          </span>
                        )}
                      </span>
                      <StockChip
                        stock={s.stock}
                        threshold={s.threshold}
                        labels={{
                          out: t("erp.inventory.out"),
                          critical: t("erp.inventory.critical"),
                          low: t("erp.inventory.low"),
                          ok: t("erp.inventory.ok"),
                          threshold: t("erp.inventory.threshold"),
                        }}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {supervisor && (
            <Section
              title={t("erp.overview.agentPerformance")}
              description={t("erp.overview.agentPerformanceHint")}
              testId="erp-agent-performance"
            >
              <RankList rows={agentRows} emptyLabel={t("common.empty")} testId="erp-agents-rank" />
            </Section>
          )}

          {supervisor && (
            <Section
              title={t("erp.overview.carrierPerformance")}
              description={t("erp.overview.carrierPerformanceHint")}
              testId="erp-carrier-performance"
            >
              <RankList rows={carrierRows} emptyLabel={t("common.empty")} testId="erp-carriers-rank" />
            </Section>
          )}

          <Section
            title={t("erp.overview.topProducts")}
            description={t("erp.overview.topProductsHint")}
            testId="erp-top-products"
          >
            <RankList rows={productRows} emptyLabel={t("common.empty")} testId="erp-products-rank" />
          </Section>
        </div>
      </PageBody>
    </>
  );
}
