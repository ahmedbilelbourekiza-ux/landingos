import {
  AlignLeft,
  BadgeCheck,
  Banknote,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  Eye,
  Images,
  Info,
  LayoutTemplate,
  Link2,
  Map as MapIcon,
  Megaphone,
  MousePointerClick,
  Coins,
  Gauge,
  PanelTop,
  Percent,
  Radio,
  ShoppingCart,
  Sparkles,
  Star,
  TriangleAlert,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { can } from "@landingos/auth";
import { withTenant } from "@landingos/db";
import { formatDate, formatNumber, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import { toneVars, type StatusTone } from "@landingos/ui";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import {
  analyticsRange,
  storefrontAnalytics,
  analyticsComparison,
  previousWindow,
  percentDelta,
  conversionRate,
  ANALYTICS_PERIODS,
  CHANNEL_BRANDS,
} from "@/lib/builder/analytics";
import { adSpendPanel } from "@/lib/builder/ad-spend-panel";
import { pruneExpiredVisits } from "@/lib/storefront/visit-retention";
import { INSIGHT_MIN_VIEWS, type InsightRecommendationData } from "@/lib/landing/ai-insight";
/* TR.1 — the screen's judgement layer, kept pure and out here so it can be
 * tested without a server (test/traffic-triage.test.ts). It returns tones and
 * kinds; the literal i18n keys for them live in this file, because the message
 * scanner cannot see a key built from a template. */
import {
  buildFunnel,
  deriveAlerts,
  pageHealth,
  rankInsights,
  type AlertKind,
  type FunnelStepKey,
  type PageHealth,
} from "@/lib/builder/traffic-triage";
import {
  PageHeader,
  PageBody,
  Section,
  Stat,
  StatGrid,
} from "@/components/console/ui/primitives";
import {
  DonutChart,
  Funnel,
  HealthChip,
  InsightCard,
  WilayaMap,
} from "@/components/console/builder/traffic-parts";
import { buildWilayaMapData } from "@/lib/builder/wilaya-map-data";
/* TR.2 — the four-tier scale and the merchant's tile preferences. The scale
 * colours nothing on its own: a figure is grey until a benchmark it can cite
 * exists, and on this screen that benchmark is the merchant's own thresholds. */
import { toneFor } from "@/lib/console/benchmark";
import {
  COLOURABLE,
  TILES_KEY,
  TILES_PRODUCT,
  parseTilePreferences,
  type TileKey,
} from "@/lib/builder/traffic-tiles";
import {
  CustomizeTilesPanel,
  type TileCatalogEntry,
} from "@/components/console/builder/customize-tiles-panel";
/* TS.2 — the console's ONE analytics language (PM.1's dashboard-parts):
 * KpiTile with its previous-window delta, PeriodTabs as URL-driven links.
 * Imported across the erp/ boundary deliberately — these are pure renders
 * over props with no ERP semantics, and a second copy for the builder is how
 * two dashboards drift apart. */
import { AlertCard, KpiTile, PeriodTabs, RankList } from "@/components/console/erp/dashboard-parts";
import { DataTable } from "@/components/console/data-table";
import { AnalyzePageButton } from "@/components/console/builder/analyze-page-button";
import { EnableTrackingButton } from "@/components/console/builder/enable-tracking-button";
import { RefreshSpendButton } from "@/components/console/builder/refresh-spend-button";
import { ConnectAdAccountPanel } from "@/components/console/builder/connect-ad-account";
import { DisconnectAdAccountButton } from "@/components/console/builder/disconnect-ad-account";

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

/* -----------------------------------------------------------------------------
 * TR.1 — the lookup tables that turn a machine key into something readable
 * -------------------------------------------------------------------------- */

/* WHY THESE ARE SWITCHES OVER LITERALS AND NOT `t(\`a.${kind}\`)`.
 * The message-parity suite scans the source for `t("…")` calls and fails the
 * build when a locale is missing one; it cannot see a key assembled from a
 * template, so a templated key ships untranslated and is found by a merchant.
 * The existing screen already carries this idiom for channel and section
 * names. One table per vocabulary, every key written out. */

const HEALTH_LABEL_KEY: Record<PageHealth, string> = {
  untested: "builder.analytics.healthUntested",
  selling: "builder.analytics.healthSelling",
  thin: "builder.analytics.healthThin",
  stalling: "builder.analytics.healthStalling",
  unreached: "builder.analytics.healthUnreached",
  noOrders: "builder.analytics.healthNoOrders",
};

/** A page's verdict, as a mark. Deliberately only three shapes across six
 *  verdicts: the colour already ranks them, and six icons would be six things
 *  to learn where the tone says it in one. */
const HEALTH_ICON: Record<PageHealth, LucideIcon> = {
  untested: Info,
  selling: BadgeCheck,
  thin: Info,
  stalling: CircleAlert,
  unreached: TriangleAlert,
  noOrders: TriangleAlert,
};

const ALERT_ICON: Record<AlertKind, LucideIcon> = {
  formUnreached: ClipboardList,
  spendNoOrders: Wallet,
  noOrders: TriangleAlert,
  trackingOff: Eye,
  analysisReady: Sparkles,
};

/** Where a recommendation points, as a mark. The nine values are BH.3's
 *  closed enum, validated at write time, so this table is exhaustive — but it
 *  is read through a fallback anyway, because rows stored before a future
 *  vocabulary change are cast unvalidated on the way out of the database. */
const SECTION_ICON: Record<string, LucideIcon> = {
  hero: PanelTop,
  gallery: Images,
  description: AlignLeft,
  benefits: BadgeCheck,
  reviews: Star,
  faq: CircleHelp,
  form: ClipboardList,
  announcement: Megaphone,
  general: LayoutTemplate,
};

/** What an insight's grounding number COUNTS, so the figure it now leads with
 *  is not a bare integer. Null for anything unrecognised — including every
 *  positional `faq.qN` key, whose question text is the label instead. */
function metricLabelKey(metric: string): string | null {
  switch (metric) {
    case "views":
      return "builder.analytics.views";
    case "orders":
      return "builder.analytics.orders";
    case "behavior.sawForm":
      return "builder.analytics.funnelSawFormShort";
    case "behavior.galleryChanges":
      return "builder.analytics.gallery";
    case "behavior.variantChanges":
      return "builder.analytics.variants";
    case "behavior.stickyBuyClicks":
      return "builder.analytics.stickyTaps";
    case "behavior.whatsappClicks":
      return "builder.analytics.colWhatsapp";
    case "drafts.started":
      return "builder.analytics.funnelDrafts";
    case "drafts.withPhone":
      return "builder.analytics.funnelPhone";
    default:
      return null;
  }
}

export default async function BuilderAnalyticsScreen({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; range?: string; from?: string; to?: string }>;
}) {
  const { session, locale: rawLocale, t } = await requireProduct(
    "website-builder",
    "/console/builder/analytics",
  );
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const range = analyticsRange(await searchParams);

  // SEC.8 — the analyze button bills the tenant's AI key, which is its own
  // permission now. Without it the button is not rendered at all: this screen
  // is reachable on orders:read, and a control that can only answer 403 is
  // the reachability defect in reverse.
  const maySpendOnAi = can(session.auth!, "website-builder:ai:spend");

  /* TS.3 / D2 — the per-card enable-tracking control writes through the
   * order-form route, which is gated on pages:write; rendering it for anyone
   * else would be the dead-control defect. Non-writers get the editor
   * pointer sentence instead. */
  const mayWritePages = can(session.auth!, "website-builder:pages:write");

  // SEC.9 (LB.23 review) — the connect form and Refresh call routes gated on
  // `platform:integrations:manage`, which only OWNER/ADMIN hold by role,
  // while THIS screen is reachable on orders:read. Rendered ungated, a
  // VIEWER was offered a credential field whose save could only answer 403 —
  // LB.23c's dead-control defect, wearing a permission instead of a missing
  // form. The spend NUMBERS stay for everyone the screen admits.
  const mayManageIntegrations = can(session.auth!, "platform:integrations:manage");

  /* TR.2 — the tile preferences write through a route gated on
     `settings:write`; the customize control is rendered only for whoever the
     route admits, the dead-control rule this screen already follows twice. */
  const maySetTiles = can(session.auth!, "website-builder:settings:write");

  /* `withTenant`, not `forTenant`: the uniques aggregate is raw SQL and needs
   * the one bound transaction connection (the proxy cannot carry it). The
   * prune runs FIRST, in the same transaction — AN.2's read-path retention:
   * whoever looks at analytics sweeps their own expired rows, so this screen
   * never reports over data the retention rule says should be gone. */
  const { data, insights, spend: adSpend, prev, tiles, wilayaGroups, wilayaRef } = await withTenant(session.auth!.tenantId, async (db) => {
    await pruneExpiredVisits(db);
    const analytics = await storefrontAnalytics(db, range);
    /* TS.2 — the same-length window immediately before, for the KPI deltas:
       three cheap aggregates on the same binding, never a second full
       storefrontAnalytics. */
    const comparison = await analyticsComparison(db, previousWindow(range));
    /* BH.3 — the newest stored analysis per landing page WITH TRAFFIC. TS.1:
     * keyed off byPage, not behaviorByPage — the analyze API never required
     * behavior (the summary's behavior half is honestly null without it), so
     * the read surface must not either; keyed off the behavior table, the
     * whole section was invisible until a page opted in, which no production
     * page ever had (the LB.6.d finding). DISTINCT ON is what this wants;
     * Prisma's shape for it is one ordered findMany kept first-per-page here
     * (bounded by pages that had views or orders in the window). */
    const insightPageIds = analytics.byPage
      .map((r) => r.landingPageId)
      .filter((id): id is string => id !== null);
    const insightRows = insightPageIds.length
      ? await (db as any).landingInsight.findMany({
          where: { landingPageId: { in: insightPageIds } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, landingPageId: true, windowDays: true,
            inputSummary: true, recommendations: true, createdAt: true,
          },
        })
      : [];
    const newestPerPage = new Map<string, (typeof insightRows)[number]>();
    for (const row of insightRows) {
      if (!newestPerPage.has(row.landingPageId)) newestPerPage.set(row.landingPageId, row);
    }
    /* LB.23 — inside the SAME transaction as the rest of the screen's reads:
       one tenant scope, one connection, and the spend cannot disagree with
       the orders it is shown beside. */
    const tenantRow = await (db as never as {
      tenant: { findUnique(a: unknown): Promise<{ currency: string } | null> };
    }).tenant.findUnique({
      where: { id: session.auth!.tenantId },
      select: { currency: true },
    });
    const spend = await adSpendPanel(db as never, range, tenantRow?.currency ?? "DZD");
    /* TR.2 — the merchant's tile preferences, one ProductSetting row read on
       the same binding. Parsed defensively: a hand-edited or pre-vocabulary
       value degrades to the defaults rather than throwing inside the screen. */
    const tileRow = await (db as any).productSetting.findFirst({
      where: { product: TILES_PRODUCT, key: TILES_KEY },
      select: { value: true },
    });
    /* WM.1 — orders per wilaya over the SAME window as every other figure on
       the screen, plus the reference rows the names join back through. The
       reference is global (RLS-exempt, the same table the checkout resolves
       destinations against) and 58 rows small. */
    const wilayaGroups = await (db as any).salesOrder.groupBy({
      by: ["wilaya"],
      where: { createdAt: { gte: range.since, lt: range.until } },
      _count: { _all: true },
    });
    const wilayaRef = await (db as any).wilaya.findMany({
      select: { code: true, name: true, nameAr: true },
      orderBy: { id: "asc" },
    });
    return {
      data: analytics,
      insights: newestPerPage,
      spend,
      prev: comparison,
      tiles: parseTilePreferences(tileRow?.value),
      wilayaGroups: wilayaGroups.map((g: any) => ({ wilaya: g.wilaya, count: g._count._all })),
      wilayaRef,
    };
  });

  const channelLabel = (channel: string) =>
    CHANNEL_BRANDS[channel] ?? t(`builder.analytics.channel.${channel}` as any);

  /* TR.2 — which tiles this merchant has switched off, and the tone a
     colourable tile earns from THEIR thresholds. `tileTone` returns undefined
     for a count, a money total, or a colourable tile with no thresholds set:
     the four-tier scale never colours a figure it has no benchmark for. */
  const hiddenTiles = new Set<TileKey>(tiles.hidden);
  const shown = (key: TileKey) => !hiddenTiles.has(key);
  const tileTone = (key: TileKey, value: number | null): Record<string, string> | undefined => {
    const dir = COLOURABLE[key];
    if (!dir) return undefined;
    const tone = toneFor(value, tiles.thresholds[key] ?? null, dir.higherIsBetter);
    return tone ? toneVars(tone) : undefined;
  };

  // The analyze control's refusal vocabulary — the AI-surface codes plus this
  // route's own two, each named specifically because each names its fix.
  /* LB.23 — the refresh control's refusal vocabulary. NO_CREDENTIAL is named
     specifically because it is the one refusal with a next action the merchant
     can take; the rest fall back to the generic wording on purpose. */
  const spendErrors = actionErrors(t);
  spendErrors.NO_CREDENTIAL = t("builder.analytics.adSpendNoCredential");

  /* LB.23c — the connect form's words, translated ONCE on the server and
     handed down as props: this console's convention for client write controls,
     so a write control never depends on messages being available client-side. */
  const adAccountLabels = {
    connect: t("builder.analytics.adAccountConnect"),
    accountId: t("builder.analytics.adAccountIdLabel"),
    accountIdHint: t("builder.analytics.adAccountIdHint"),
    name: t("builder.analytics.adAccountNameLabel"),
    currency: t("builder.analytics.adAccountCurrencyLabel"),
    token: t("builder.analytics.adAccountTokenLabel"),
    tokenHint: t("builder.analytics.adAccountTokenHint"),
    save: t("builder.analytics.adAccountSave"),
    saving: t("builder.analytics.adAccountSaving"),
  };

  /* The exit door's words, same convention. The confirm sentence carries the
     cost (credential + pulled history, per the route's cascade) because the
     dialog is the last place to say it before it happens. */
  const disconnectLabels = {
    disconnect: t("builder.analytics.adAccountDisconnect"),
    disconnecting: t("builder.analytics.adAccountDisconnecting"),
    confirm: t("builder.analytics.adAccountDisconnectConfirm"),
  };

  const trackingErrors = actionErrors(t);

  /* TR.2 — the customize panel's refusal vocabulary. INVALID_TILES is named
     because it has a next action (fix the direction of a threshold trio). */
  const tileErrors = actionErrors(t);
  tileErrors.INVALID_TILES = t("builder.analytics.customizeInvalid");

  /* The closed catalogue the customize panel offers, with each colourable
     tile's direction and unit. Labels translated here, on the server, and
     handed down — the console's rule for client write controls. */
  const adCurrency = adSpend.state === "unconfigured" ? "" : adSpend.currency;
  const tileCatalog: TileCatalogEntry[] = [
    { key: "views", label: t("builder.analytics.views"), higherIsBetter: null, unit: "" },
    { key: "visitors", label: t("builder.analytics.visitors"), higherIsBetter: null, unit: "" },
    { key: "orders", label: t("builder.analytics.orders"), higherIsBetter: null, unit: "" },
    { key: "conversion", label: t("builder.analytics.kpiConversion"), higherIsBetter: true, unit: "%" },
    { key: "adSpend", label: t("builder.analytics.adSpendSpent"), higherIsBetter: null, unit: adCurrency },
    { key: "adImpressions", label: t("builder.analytics.adSpendImpressions"), higherIsBetter: null, unit: "" },
    { key: "adCtr", label: t("builder.analytics.adSpendCtr"), higherIsBetter: true, unit: "%" },
    { key: "adCpc", label: t("builder.analytics.adSpendCostPerClick"), higherIsBetter: false, unit: adCurrency },
    { key: "adCpm", label: t("builder.analytics.adSpendCpm"), higherIsBetter: false, unit: adCurrency },
    { key: "adLinkClicks", label: t("builder.analytics.adSpendLinkClicks"), higherIsBetter: null, unit: "" },
    { key: "adOrders", label: t("builder.analytics.adSpendOrders"), higherIsBetter: null, unit: "" },
    { key: "adCostPerOrder", label: t("builder.analytics.adSpendCostPerOrder"), higherIsBetter: false, unit: adCurrency },
  ];
  const insightErrors = actionErrors(t);
  insightErrors.NO_AI_PROVIDER = t("builder.newPage.ai.noProvider");
  insightErrors.AI_UPSTREAM_ERROR = t("builder.newPage.ai.upstreamFailed");
  insightErrors.AI_EMPTY_ANSWER = t("builder.newPage.ai.upstreamFailed");
  insightErrors.AI_INVALID_OUTPUT = t("builder.analytics.insightRefused");
  insightErrors.AI_QUOTA_EXCEEDED = t("builder.newPage.ai.quotaExceeded");
  // INSUFFICIENT_DATA is unmapped on purpose: the button only renders at or
  // above the floor, so the server-side refusal fires only in a prune race —
  // the generic fallback covers it honestly.

  const pageLabel = (row: (typeof data.byPage)[number]) => {
    if (row.landingPageId) return row.title ?? "—";
    return row.pageKind === "home"
      ? t("builder.analytics.storeHome")
      : t("builder.analytics.categoryPages");
  };

  /* TS.2 — conversion as orders per 100 views, in this window and the one
   * before; the delta is POINTS (a rate compares by difference). Null when a
   * window has no views — never a rate over a zero denominator. */
  const conv = conversionRate(data.totals.orders, data.totals.views);
  const prevConv = conversionRate(prev.orders, prev.views);
  const convDelta = conv !== null && prevConv !== null ? conv - prevConv : null;

  /* TS.1 — the landing pages with traffic in the window (views, or orders
   * without a counted view). This is what the behavior and AI sections key
   * off now: "this store has landing traffic" is the honest precondition for
   * both, where "a page already opted into behavior" — the old wrapper — hid
   * the AI feature and its own remedy copy from every merchant who had not
   * found the editor toggle yet. Store-level rows (home, category) stay out:
   * behavior and analysis are landing-page features by design. */
  const landingTraffic = data.byPage.filter(
    (row): row is (typeof data.byPage)[number] & { landingPageId: string } =>
      row.landingPageId !== null,
  );

  /* ---------------------------------------------------------------------------
   * TR.1 — the triage pass.
   *
   * Every number below is one the screen already fetched; nothing here adds a
   * query. It runs BEFORE the render so the page can lead with the answer
   * instead of making the merchant assemble it from five sections.
   * ------------------------------------------------------------------------ */

  const behaviorFor = (pageId: string) =>
    data.behaviorByPage.find((b) => b.landingPageId === pageId) ?? null;

  const alerts = deriveAlerts({
    totals: { views: data.totals.views, orders: data.totals.orders },
    pages: landingTraffic.map((row) => {
      const behavior = behaviorFor(row.landingPageId);
      return {
        landingPageId: row.landingPageId,
        views: row.views,
        orders: row.orders,
        behavior: behavior ? { measured: behavior.measured, sawForm: behavior.sawForm } : null,
        hasInsight: insights.has(row.landingPageId),
      };
    }),
    /* Only a READY account carries spend. In the unconfigured and never-synced
       states there is no spend figure at all, and "spent nothing, sold
       nothing" is not a problem to put in front of anyone. */
    spend:
      adSpend.state === "ready"
        ? { amount: Number(adSpend.spend), orders: adSpend.orders, clicks: adSpend.clicks }
        : null,
    insightMinViews: INSIGHT_MIN_VIEWS,
  });

  /* Three at most. The band is only worth reading if everything in it is worth
     acting on, and a fourth card turns it back into the list this redesign is
     removing. The rest of each finding stays on its own page card. */
  const topAlerts = alerts.slice(0, 3);

  const pageTitleFor = (pageId: string) =>
    landingTraffic.find((r) => r.landingPageId === pageId)?.title ?? "—";

  /* WM.1 — the map's data: counts joined to codes through the reference
     table, Arabic labels on an Arabic console, and the honest buckets (zero
     = off the ramp, unmatched names printed rather than dropped). */
  const wilayaMap = buildWilayaMapData(wilayaGroups, wilayaRef, locale);
  const wilayaTitles = new Map(
    wilayaMap.rows.map((row) => [
      row.code,
      `${row.label} · ${formatNumber(row.count, locale)} ${t("builder.analytics.orders")}`,
    ]),
  );

  /* The store's own verdict, in the header beside the title: the worst page
     verdict in the window, or "selling" when something sold. Store-level rows
     (home, category) are deliberately out — they have no funnel to judge. */
  const storeHealth = pageHealth({
    views: data.totals.views,
    orders: data.totals.orders,
    draftsStarted: Object.values(data.draftsByPage).reduce((n, d) => n + d.started, 0),
    draftsWithPhone: Object.values(data.draftsByPage).reduce((n, d) => n + d.withPhone, 0),
    behavior: (() => {
      const rows = data.behaviorByPage;
      if (rows.length === 0) return null;
      const measured = rows.reduce((n, r) => n + r.measured, 0);
      return measured > 0
        ? { measured, sawForm: rows.reduce((n, r) => n + r.sawForm, 0) }
        : null;
    })(),
    conversion: conv,
  });
  const StoreHealthIcon = HEALTH_ICON[storeHealth.health];

  return (
    <PageBody>
      <PageHeader
        title={t("builder.nav.analytics")}
        /* TR.1 — the verdict travels WITH the title. A merchant who opens this
           screen and closes it again should still have learned the one thing
           it exists to tell them. */
        meta={
          data.totals.views > 0 ? (
            <HealthChip
              id="store"
              testId="traffic-store-health"
              tone={storeHealth.tone}
              icon={<StoreHealthIcon aria-hidden="true" className="size-3.5" />}
              label={t(HEALTH_LABEL_KEY[storeHealth.health] as "builder.analytics.healthSelling")}
            />
          ) : undefined
        }
        /* The counting basis, stated where the numbers are read: browser-side,
           so crawlers and the editor's own preview never count — and the
           merchant's own browsing does. Saying it beats a heuristic that
           half-hides it. It moves into the header's own description slot here
           rather than sitting as a loose paragraph in the body. */
        description={t("builder.analytics.basis")}
      />

      {/* TS.2 — the period, ERP-style: five words as URL-driven links (the
          ERP order list's own vocabulary plus traffic's 3d), and a custom
          from/to as a plain GET form — the range belongs in the URL, so it
          can be bookmarked and read back by the server, and the form needs
          no JavaScript to work. Custom is CLAMPED to the last 30 days: the
          raw rows behind every number here live exactly that long (the
          basis line above says so), and the post-clamp echo in the inputs
          is how a clamp is communicated. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs
          basePath="/console/builder/analytics"
          active={range.period}
          label={t("builder.analytics.rangeLabel")}
          options={ANALYTICS_PERIODS.map((value) => ({
            value,
            label: t(`builder.analytics.range.${value}` as never),
          }))}
        />
        <details
          data-testid="analytics-custom-range"
          className="relative"
          open={range.period === "custom" || undefined}
        >
          <summary
            className={`tap cursor-pointer list-none rounded-md border border-border px-3 py-1.5 text-xs font-medium ${
              range.period === "custom" ? "bg-surface-raised text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("builder.analytics.rangeCustom")}
          </summary>
          <form
            method="get"
            action="/console/builder/analytics"
            className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm sm:absolute sm:end-0 sm:z-10 sm:mt-1 sm:shadow-e1"
          >
            <input type="hidden" name="range" value="custom" />
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("builder.analytics.customFrom")}
              <input
                type="date"
                name="from"
                required
                defaultValue={range.from}
                className="ui-input h-8 text-sm"
                data-testid="analytics-custom-from"
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("builder.analytics.customTo")}
              <input
                type="date"
                name="to"
                required
                defaultValue={range.to}
                className="ui-input h-8 text-sm"
                data-testid="analytics-custom-to"
              />
            </label>
            <button type="submit" className="ui-btn ui-btn-default ui-btn-sm tap">
              {t("builder.analytics.customApply")}
            </button>
          </form>
        </details>
      </div>

      {/* =====================================================================
          TR.1 — WHAT NEEDS A PERSON, FIRST.
          The screen's whole complaint was that every element carried the same
          weight, so a merchant had to read all of it to find out whether
          anything was wrong. This band is the answer to that question and
          nothing else: at most three findings, worst first, each one a
          sentence about a number the page already had, each one linking to the
          card where it gets fixed. It renders only when there IS something —
          an empty alarm bar teaches people to ignore the bar.
          ===================================================================== */}
      {topAlerts.length > 0 && (
        <section className="space-y-2" data-testid="analytics-triage">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <TriangleAlert aria-hidden="true" className="size-4 text-muted-foreground" />
            {t("builder.analytics.triageTitle")}
          </h2>
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {topAlerts.map((alert, i) => {
              const Icon = ALERT_ICON[alert.kind];
              /* A switch over literal keys, not `t(\`…${alert.kind}\`)`: the
                 parity suite cannot see a templated key and an untranslated
                 one ships silently. */
              const text = (() => {
                switch (alert.kind) {
                  case "formUnreached":
                    return {
                      label: t("builder.analytics.alertFormLabel"),
                      hint: t("builder.analytics.alertFormHint", {
                        percent: alert.context.percent ?? 0,
                        measured: alert.context.measured ?? 0,
                      }),
                    };
                  case "spendNoOrders":
                    return {
                      label: t("builder.analytics.alertSpendLabel"),
                      hint: t("builder.analytics.alertSpendHint"),
                    };
                  case "noOrders":
                    return {
                      label: t("builder.analytics.alertNoOrdersLabel"),
                      hint: t("builder.analytics.alertNoOrdersHint"),
                    };
                  case "trackingOff":
                    return {
                      label: t("builder.analytics.alertTrackingLabel"),
                      hint: t("builder.analytics.alertTrackingHint"),
                    };
                  case "analysisReady":
                    return {
                      label: t("builder.analytics.alertAnalysisLabel"),
                      hint: t("builder.analytics.alertAnalysisHint"),
                    };
                }
              })();
              /* Page-scoped findings jump to that page's card; the money one
                 jumps to the spend section. Both are same-page anchors, so
                 the whole band works with no JavaScript. */
              const href = alert.landingPageId
                ? `#page-card-${alert.landingPageId}`
                : alert.kind === "spendNoOrders"
                  ? "#analytics-ad-spend"
                  : "#analytics-page-cards";
              return (
                <AlertCard
                  key={`${alert.kind}-${alert.landingPageId ?? "store"}-${i}`}
                  id={alert.kind}
                  testId={`triage-${alert.kind}`}
                  data-page={alert.landingPageId ?? undefined}
                  count={alert.count}
                  severity={alert.severity}
                  href={href}
                  icon={<Icon aria-hidden="true" className="size-4" />}
                  label={text.label}
                  /* The page's name belongs in the sentence when the finding
                     is about one page — a store with four pages otherwise
                     gets three cards that could each be about any of them. */
                  hint={
                    alert.landingPageId
                      ? `${pageTitleFor(alert.landingPageId)} · ${text.hint}`
                      : text.hint
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      {/* TS.2 — the KPI band, in the console's one analytics language
          (PM.1's KpiTile): each figure with its delta against the
          same-length window before, rates with their denominators.
          TR.1 adds the marks: four figures that were four identical blocks of
          text are now identifiable before they are read. */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="analytics-totals">
        {shown("views") && (
          <KpiTile
            id="traffic-views"
            icon={<Eye aria-hidden="true" className="size-3.5" />}
            label={t("builder.analytics.views")}
            value={formatNumber(data.totals.views, locale)}
            delta={percentDelta(data.totals.views, prev.views)}
            deltaKind="percent"
            riseIsGood
            comparison={t("builder.analytics.vsPrevious")}
            noComparison={t("builder.analytics.noPrevious")}
          />
        )}
        {shown("visitors") && (
          <KpiTile
            id="traffic-visitors"
            icon={<Users aria-hidden="true" className="size-3.5" />}
            label={t("builder.analytics.visitors")}
            value={formatNumber(data.totals.visitors, locale)}
            sub={`${formatNumber(data.totals.newVisitors, locale)} ${t("builder.analytics.newVisitors")} · ${formatNumber(data.totals.returningVisitors, locale)} ${t("builder.analytics.returningVisitors")}`}
            subId="traffic-visitor-split"
            delta={percentDelta(data.totals.visitors, prev.visitors)}
            deltaKind="percent"
            riseIsGood
            comparison={t("builder.analytics.vsPrevious")}
            noComparison={t("builder.analytics.noPrevious")}
          />
        )}
        {shown("orders") && (
          <KpiTile
            id="traffic-orders"
            icon={<ShoppingCart aria-hidden="true" className="size-3.5" />}
            label={t("builder.analytics.orders")}
            value={formatNumber(data.totals.orders, locale)}
            delta={percentDelta(data.totals.orders, prev.orders)}
            deltaKind="percent"
            riseIsGood
            comparison={t("builder.analytics.vsPrevious")}
            noComparison={t("builder.analytics.noPrevious")}
          />
        )}
        {shown("conversion") && (
          <KpiTile
            id="traffic-conversion"
            icon={<Percent aria-hidden="true" className="size-3.5" />}
            label={t("builder.analytics.kpiConversion")}
            value={conv === null ? "—" : conv.toFixed(1)}
            suffix={conv === null ? undefined : "%"}
            sub={`${formatNumber(data.totals.orders, locale)} / ${formatNumber(data.totals.views, locale)}`}
            subId="traffic-conversion-of"
            delta={convDelta}
            deltaKind="points"
            riseIsGood
            comparison={t("builder.analytics.vsPrevious")}
            noComparison={t("builder.analytics.noPrevious")}
            /* Grey until the merchant says what a good rate is for THEIR
               product — no universal COD conversion benchmark exists. */
            tone={tileTone("conversion", conv)}
          />
        )}
      </div>

      {/* TR.2 — the merchant's own layout, for whoever the route admits. */}
      {maySetTiles && (
        <CustomizeTilesPanel
          prefs={tiles}
          catalog={tileCatalog}
          labels={{
            title: t("builder.analytics.customize"),
            hint: t("builder.analytics.customizeHint"),
            show: t("builder.analytics.customizeShow"),
            thresholds: t("builder.analytics.thresholdsTitle"),
            bad: t("builder.analytics.thresholdBad"),
            almostBad: t("builder.analytics.thresholdAlmostBad"),
            almostGood: t("builder.analytics.thresholdAlmostGood"),
            higher: t("builder.analytics.thresholdHigher"),
            lower: t("builder.analytics.thresholdLower"),
            clear: t("builder.analytics.thresholdClear"),
            save: t("builder.analytics.customizeSave"),
            saving: t("builder.analytics.customizeSaving"),
          }}
          errors={tileErrors}
        />
      )}

      {/* LB.23 — real ad spend, pulled from Meta, beside the orders AN.1
          attributed to the same channels. Four distinct states rather than a
          zero for all of them: a screen that renders 0.00 whether nothing is
          connected, nothing is synced or nothing was spent teaches a merchant
          to distrust the figure that IS real.

          The spend is in the AD ACCOUNT's currency (USD) and the store sells
          in DA. Nothing here converts: the profit calculator already owns
          that, with the rate the manager types. The note says so on the
          screen rather than leaving a bare number to be misread. */}
      {/* TS.4 — the console's Section primitive, and the numbers separated
          from the plumbing: reading spend is the everyday act, managing the
          credential is not, so rotate/disconnect live behind one quiet
          "Manage account" disclosure — EXCEPT where a control is the state's
          own remedy (unconfigured keeps the connect form open; never-synced
          keeps Refresh and the token field in the open, because that state's
          commonest cause is exactly a missing token). Permissions unchanged:
          the disclosure renders only for whoever the routes admit. */}
      <Section
        /* TR.1 — an icon-first heading, and a heading id so the money alert in
           the triage band has somewhere to land. */
        headingId="analytics-ad-spend"
        title={
          <span className="flex items-center gap-1.5">
            <Wallet aria-hidden="true" className="size-4 text-muted-foreground" />
            {t("builder.analytics.metaTitle")}
          </span>
        }
        testId="analytics-ad-spend"
      >

        {adSpend.state === "unconfigured" ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("builder.analytics.adSpendUnconfigured")}
            </p>
            {/* The remedy belongs WITH the message. Saying "not connected" and
                offering nothing is a dead end, which is exactly what shipped
                in LB.23b and what the operator found. Open by default here:
                this is the one state where the merchant came to fix it.
                SEC.9: only for whoever the intake route would actually admit. */}
            {mayManageIntegrations && (
              <ConnectAdAccountPanel errors={spendErrors} labels={adAccountLabels} defaultOpen />
            )}
          </>
        ) : adSpend.state === "never-synced" ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("builder.analytics.adSpendNeverSynced").replace("{account}", adSpend.accountName)}
            </p>
            {/* The first pull belongs here: this state IS "connected, nothing
                fetched yet", and the fix for it is the same button. */}
            {mayManageIntegrations && (
              <RefreshSpendButton
                adAccountId={adSpend.adAccountId}
                days={range.days}
                labels={{
                  refresh: t("builder.analytics.adSpendRefresh"),
                  refreshing: t("builder.analytics.adSpendRefreshing"),
                }}
                errors={spendErrors}
              />
            )}
            {/* The commonest real case: the account row exists but its token
                was never pasted, so Refresh answers NO_CREDENTIAL. The field
                to fix that has to be reachable from right here. */}
            {mayManageIntegrations && (
              <ConnectAdAccountPanel
                errors={spendErrors}
                labels={adAccountLabels}
                existing={{
                  accountId: adSpend.accountRef,
                  name: adSpend.accountName,
                  currency: adSpend.currency,
                }}
              />
            )}
            {/* SEC.9's DELETE keeps its door — found button-less by the
                deploy's own verification pass. TS.4 tucks it behind the
                manage disclosure: a token pasted into the wrong account is
                this state's commonest mistake, but disconnecting is still
                the rarer act than pasting the right one. */}
            {mayManageIntegrations && (
              <details data-testid="ad-account-manage" className="pt-1">
                <summary className="tap cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
                  {t("builder.analytics.adSpendManage")}
                </summary>
                <div className="mt-2 space-y-2">
                  <DisconnectAdAccountButton
                    adAccountId={adSpend.adAccountId}
                    labels={disconnectLabels}
                    errors={spendErrors}
                  />
                </div>
              </details>
            )}
          </>
        ) : (
          <>
            {/* =========================================================
                TR.2 — META ADS PERFORMANCE: one tile per figure.

                Icon-labelled, and coloured ONLY where a benchmark exists.
                None ships with one. CTR, CPC, CPM and cost per order are
                colourable, but a universal cut point for any of them would
                be a guess dressed as a verdict. Cost per order in particular
                means nothing without the margin behind it, which this
                platform does not know. So every tile is grey until the
                merchant sets their own thresholds in "Customize tiles",
                and turns colour the moment they do. Spend, impressions,
                clicks and orders are counts and stay grey for good.

                The arithmetic is unchanged from ME.A/ME.B: same sums, nulls
                SKIPPED rather than rendered as 0.00, currency beside every
                money value because it is USD while the store sells in DA.
                ========================================================= */}
            <StatGrid testId="analytics-ad-spend-totals">
              {shown("adSpend") && (
                <Stat
                  id="ad-spend"
                  label={
                    <span className="flex items-center gap-1.5">
                      <Wallet aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendSpent")}
                    </span>
                  }
                  value={`${adSpend.spend} ${adSpend.currency}`}
                  sub={`${adSpend.days} ${t("builder.analytics.adSpendDays")}`}
                />
              )}

              {shown("adImpressions") && (
                <Stat
                  id="ad-impressions"
                  label={
                    <span className="flex items-center gap-1.5">
                      <Eye aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendImpressions")}
                    </span>
                  }
                  value={formatNumber(adSpend.impressions, locale)}
                />
              )}

              {/* One template literal, one text node: a `{v}%` pair SSRs as
                  `2.00<!-- -->%`, which breaks copy-paste and any exact
                  text assertion. */}
              {shown("adCtr") && adSpend.ctr !== null && (
                <Stat
                  id="ad-ctr"
                  testId="analytics-ad-ctr"
                  tone={tileTone("adCtr", Number(adSpend.ctr))}
                  label={
                    <span className="flex items-center gap-1.5">
                      <Percent aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendCtr")}
                    </span>
                  }
                  value={`${adSpend.ctr}%`}
                  sub={`${formatNumber(adSpend.clicks, locale)} ${t("builder.analytics.adSpendClicks")}`}
                />
              )}

              {shown("adCpc") && adSpend.costPerClick !== null && (
                <Stat
                  id="ad-cpc"
                  testId="analytics-ad-cpc"
                  tone={tileTone("adCpc", Number(adSpend.costPerClick))}
                  label={
                    <span className="flex items-center gap-1.5">
                      <Coins aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendCostPerClick")}
                    </span>
                  }
                  value={`${adSpend.costPerClick} ${adSpend.currency}`}
                />
              )}

              {shown("adCpm") && adSpend.cpmPerMille !== null && (
                <Stat
                  id="ad-cpm"
                  testId="analytics-ad-cpm"
                  tone={tileTone("adCpm", Number(adSpend.cpmPerMille))}
                  label={
                    <span className="flex items-center gap-1.5">
                      <Gauge aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendCpm")}
                    </span>
                  }
                  value={`${adSpend.cpmPerMille} ${adSpend.currency}`}
                />
              )}

              {/* ME.B: the clicks that actually leave for the page (the raw
                  clicks figure also counts reactions). Null = the window
                  predates the field; the whole tile is skipped rather than
                  rendered empty. */}
              {shown("adLinkClicks") && adSpend.linkClicks !== null && (
                <Stat
                  id="ad-link-clicks"
                  testId="analytics-ad-link-clicks"
                  label={
                    <span className="flex items-center gap-1.5">
                      <Link2 aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendLinkClicks")}
                    </span>
                  }
                  value={formatNumber(adSpend.linkClicks, locale)}
                  sub={
                    <>
                      {adSpend.linkCtr !== null && <span dir="ltr">{`${adSpend.linkCtr}%`}</span>}
                      {adSpend.linkCtr !== null && adSpend.costPerLinkClick !== null && " · "}
                      {adSpend.costPerLinkClick !== null &&
                        `${adSpend.costPerLinkClick} ${adSpend.currency}`}
                    </>
                  }
                />
              )}

              {shown("adOrders") && (
                <Stat
                  id="ad-orders"
                  label={
                    <span className="flex items-center gap-1.5">
                      <ShoppingCart aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendOrders")}
                    </span>
                  }
                  value={formatNumber(adSpend.orders, locale)}
                />
              )}

              {shown("adCostPerOrder") && (
                <Stat
                  id="ad-cost-per-order"
                  testId="analytics-cost-per-order"
                  tone={tileTone(
                    "adCostPerOrder",
                    adSpend.costPerOrder === null ? null : Number(adSpend.costPerOrder),
                  )}
                  label={
                    <span className="flex items-center gap-1.5">
                      <Banknote aria-hidden="true" className="size-3.5" />
                      {t("builder.analytics.adSpendCostPerOrder")}
                    </span>
                  }
                  value={
                    adSpend.costPerOrder === null
                      ? t("builder.analytics.adSpendNotAnswerable")
                      : `${adSpend.costPerOrder} ${adSpend.currency}`
                  }
                />
              )}
            </StatGrid>
            {/* ME.B — the META-REPORTED line: pixel/CAPI attribution, values
                converted by Meta into the account currency. Labeled as Meta's
                own numbers everywhere they appear (D4) — a merchant must never
                read them as the platform's recorded orders, which live in the
                tables below with their own attribution. */}
            {(adSpend.metaPurchases !== null || adSpend.metaRoas !== null) && (
              <p className="text-xs text-muted-foreground" data-testid="analytics-ad-meta-reported">
                <span className="font-medium text-foreground">
                  {t("builder.analytics.adSpendMetaReported")}:
                </span>{" "}
                {adSpend.metaPurchases !== null &&
                  `${adSpend.metaPurchases} ${t("builder.analytics.adSpendMetaPurchases")}`}
                {adSpend.metaPurchases !== null && adSpend.metaRoas !== null && " · "}
                {adSpend.metaRoas !== null && (
                  <span dir="ltr">{`${t("builder.analytics.adSpendMetaRoas")} ${adSpend.metaRoas}`}</span>
                )}
              </p>
            )}
            {/* ME.B — window-level reach of the LAST refreshed window (D5):
                not additive across days, so it carries its own window length
                rather than pretending to be this view's window. */}
            {adSpend.reach !== null && (
              <p className="text-xs text-muted-foreground" data-testid="analytics-ad-reach">
                {t("builder.analytics.adSpendReach")}:{" "}
                <span className="font-medium text-foreground tabular-nums" dir="ltr">
                  {formatNumber(adSpend.reach.people, locale)}
                </span>{" "}
                · {t("builder.analytics.adSpendFrequency")}:{" "}
                <span className="tabular-nums" dir="ltr">{adSpend.reach.frequency}</span>
                {adSpend.reach.days !== null &&
                  ` (${t("builder.analytics.adSpendReachWindow", { days: adSpend.reach.days })})`}
              </p>
            )}
            {/* ME.C — where the money went, campaign by campaign: spend-side
                only, with Meta's own names. The orders join waits for tagged
                links ({{campaign.name}} in Ads Manager + BH.4's capture) —
                this list answers "where did it go", not "what did it buy". */}
            {adSpend.campaigns.length > 0 && (
              <div className="space-y-1.5" data-testid="analytics-ad-campaigns">
                <p className="text-xs font-medium">{t("builder.analytics.adSpendCampaignsTitle")}</p>
                <RankList
                  testId="analytics-ad-campaigns-rank"
                  emptyLabel=""
                  rows={adSpend.campaigns.map((c, i) => ({
                    key: `${i}-${c.name}`,
                    label: c.name,
                    sub: `${formatNumber(c.clicks, locale)} ${t("builder.analytics.adSpendClicks")}`,
                    value: `${c.spend} ${adSpend.currency}`,
                    share: c.share,
                  }))}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("builder.analytics.adSpendAccount")}: {adSpend.accountName} ·{" "}
              {t("builder.analytics.adSpendSynced")}:{" "}
              {formatDate(adSpend.lastSyncedAt, locale)} · {adSpend.days}{" "}
              {t("builder.analytics.adSpendDays")}
            </p>
            {adSpend.ratioRefusal && (
              <p className="text-xs text-muted-foreground">
                {t("builder.analytics.adSpendCurrencyNote")}
              </p>
            )}
            {/* On demand only — nothing schedules a pull, and the screen should
                not imply otherwise. It refreshes the window being LOOKED AT. */}
            {mayManageIntegrations && (
              <RefreshSpendButton
                adAccountId={adSpend.adAccountId}
                days={range.days}
                labels={{
                  refresh: t("builder.analytics.adSpendRefresh"),
                  refreshing: t("builder.analytics.adSpendRefreshing"),
                }}
                errors={spendErrors}
              />
            )}
            {/* TS.4 — the plumbing behind one door. Nothing here is broken
                in this state, so rotating the token (it expires, it gets
                revoked — must not require database access) and the exit
                beside it live in the manage disclosure: rotate when the
                token changed hands, disconnect when the account did.
                Route-gated to the same permission; confirm says the cascade. */}
            {mayManageIntegrations && (
              <details data-testid="ad-account-manage" className="pt-1">
                <summary className="tap cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
                  {t("builder.analytics.adSpendManage")}
                </summary>
                <div className="mt-2 space-y-2">
                  <ConnectAdAccountPanel
                    errors={spendErrors}
                    labels={adAccountLabels}
                    existing={{
                      accountId: adSpend.accountRef,
                      name: adSpend.accountName,
                      currency: adSpend.currency,
                    }}
                  />
                  <DisconnectAdAccountButton
                    adAccountId={adSpend.adAccountId}
                    labels={disconnectLabels}
                    errors={spendErrors}
                  />
                </div>
              </details>
            )}
          </>
        )}
      </Section>

      {/* =====================================================================
          TS.3 — ONE CARD PER LANDING PAGE, replacing the three stacked tables
          that each repeated the same page names (traffic row, behavior row,
          insight card). A card carries the page's whole story: traffic and
          conversion in the header; when measured, the funnel, the scroll
          drop-off, the engagement chips and the most-opened questions (the
          screen finally shows what the AI's input already contained); when
          tracking is off, the remedy — with D2's enable control for whoever
          holds pages:write, and the editor pointer for whoever does not (a
          control that can only 403 is the dead-control defect). The AI
          recommendations render on the card, exactly as TS.1 wired them.
          ===================================================================== */}
      {landingTraffic.length > 0 && (
        <section
          id="analytics-page-cards"
          className="space-y-4"
          data-testid="analytics-page-cards"
        >
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              <LayoutTemplate aria-hidden="true" className="size-4 text-muted-foreground" />
              {t("builder.analytics.pagesTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("builder.analytics.insightIntro")}
            </p>
          </div>
          {landingTraffic.map((row) => {
            const behavior =
              data.behaviorByPage.find((b) => b.landingPageId === row.landingPageId) ?? null;
            const drafts = data.draftsByPage[row.landingPageId] ?? { started: 0, withPhone: 0 };
            const faqTop = (data.faqOpensByPage[row.landingPageId] ?? []).slice(0, 3);
            const insight = insights.get(row.landingPageId);
            const views = row.views;
            const pageConv = conversionRate(row.orders, row.views);
            const recommendations = (insight?.recommendations ?? []) as InsightRecommendationData[];
            const summaryViews = (insight?.inputSummary as { views?: number } | null)?.views ?? 0;

            /* TR.1 — the funnel is now BUILT by the triage module, which
               carries each step's own denominator and marks the steepest fall.
               The bars stay scaled to views so the five stay comparable; the
               rates are against each step's honest base, which is why the two
               numbers are separate fields rather than one.

               The i18n keys stay here, as literals, because the message
               scanner cannot follow a key built from a step key. */
            const funnelSteps = buildFunnel({
              views,
              orders: row.orders,
              draftsStarted: drafts.started,
              draftsWithPhone: drafts.withPhone,
              behavior: behavior
                ? { measured: behavior.measured, sawForm: behavior.sawForm }
                : null,
            });

            const funnelStepLabel = (key: FunnelStepKey): string => {
              switch (key) {
                case "viewed":
                  return t("builder.analytics.funnelViewed");
                case "sawForm":
                  return t("builder.analytics.funnelSawFormShort");
                case "drafts":
                  return t("builder.analytics.funnelDrafts");
                case "phone":
                  return t("builder.analytics.funnelPhone");
                case "ordered":
                  return t("builder.analytics.funnelOrdered");
              }
            };

            /* "34 of 260 measured" — the denominator printed beside the rate,
               so a percentage is never a figure nobody can sanity-check
               (KpiTile's own rule, applied to the funnel). */
            const funnelRateLabel = (
              step: (typeof funnelSteps)[number],
            ): string | null => {
              /* No rate, no denominator line. A step whose base is zero would
                 otherwise print "of 0 started", which is noise rather than the
                 sanity-check the line exists to provide. */
              if (step.rate === null || step.rateBaseCount === null) return null;
              const n = step.rateBaseCount;
              /* TR.2 — the PREVIOUS stage is the denominator now, so the
                 label names it. Literal keys per stage: the message scanner
                 cannot follow a key built from `step.rateBase`. */
              switch (step.rateBase) {
                case "measured":
                  return t("builder.analytics.funnelOfMeasured", { n });
                case "viewed":
                  return t("builder.analytics.funnelOfViews", { n });
                case "sawForm":
                  return t("builder.analytics.funnelOfSawForm", { n });
                case "drafts":
                  return t("builder.analytics.funnelOfStarted", { n });
                case "phone":
                  return t("builder.analytics.funnelOfPhone", { n });
                default:
                  return null;
              }
            };

            /* "Reached at least": cumulative from the deep end of `furthest`
               (a view that stopped at FAQ also saw everything above it). */
            const landmarkOrder = ["hero", "description", "reviews", "faq", "footer"] as const;
            let cumulative = 0;
            const reached = behavior
              ? [...landmarkOrder].reverse().map((s) => {
                  cumulative += behavior.furthest[s] ?? 0;
                  return { section: s, count: cumulative };
                }).reverse()
              : [];

            /* TR.1 — the card's verdict, from the same rules the triage band
               used, so the badge and the alert above can never disagree. */
            const health = pageHealth({
              views,
              orders: row.orders,
              draftsStarted: drafts.started,
              draftsWithPhone: drafts.withPhone,
              behavior: behavior
                ? { measured: behavior.measured, sawForm: behavior.sawForm }
                : null,
              conversion: pageConv,
            });
            const HealthIcon = HEALTH_ICON[health.health];

            return (
              <div
                key={row.landingPageId}
                /* The anchor the triage band links to. */
                id={`page-card-${row.landingPageId}`}
                data-testid={`page-card-${row.landingPageId}`}
                data-health={health.health}
                className="space-y-4 scroll-mt-4 rounded-lg border border-border bg-surface-raised p-4"
              >
                {/* Header: identity + verdict + traffic + the analyze slot. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.title ?? "—"}</span>
                      <HealthChip
                        id={row.landingPageId}
                        testId={`page-health-${row.landingPageId}`}
                        tone={health.tone}
                        icon={<HealthIcon aria-hidden="true" className="size-3.5" />}
                        label={t(
                          HEALTH_LABEL_KEY[health.health] as "builder.analytics.healthSelling",
                        )}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                      {formatNumber(views, locale)} {t("builder.analytics.views")} ·{" "}
                      {formatNumber(row.orders, locale)} {t("builder.analytics.orders")}
                      {pageConv !== null && ` · ${pageConv.toFixed(1)}%`}
                    </p>
                  </div>
                  {views < INSIGHT_MIN_VIEWS ? (
                    <p className="text-xs text-muted-foreground" data-testid="insight-insufficient">
                      {t("builder.analytics.insightInsufficient", {
                        views,
                        needed: INSIGHT_MIN_VIEWS,
                      })}
                    </p>
                  ) : maySpendOnAi ? (
                    <AnalyzePageButton
                      landingPageId={row.landingPageId}
                      labels={{
                        analyze: t("builder.analytics.insightAnalyze"),
                        analyzing: t("builder.analytics.insightAnalyzing"),
                      }}
                      errors={insightErrors}
                    />
                  ) : null}
                </div>

                {/* TR.1 — THE FUNNEL RENDERS WHETHER OR NOT BEHAVIOUR IS ON.
                    It used to sit inside the `behavior ?` branch, so a page
                    with tracking off showed no funnel at all — even though
                    three of its five stages (viewed, started, left a phone,
                    ordered) come from orders and drafts and need no opt-in.
                    A merchant with tracking off was shown nothing and told to
                    turn something on; now they are shown what IS known, and
                    the one missing stage is simply absent. */}
                <Funnel
                  testId={`funnel-${row.landingPageId}`}
                  cliffLabel={t("builder.analytics.funnelBiggestDrop")}
                  rows={funnelSteps.map((step) => ({
                    key: step.key,
                    label: funnelStepLabel(step.key),
                    count: step.count,
                    display: formatNumber(step.count, locale),
                    barShare: step.barShare,
                    rate: step.rate,
                    rateLabel: funnelRateLabel(step),
                    tone: step.tone,
                    isCliff: step.isCliff,
                  }))}
                />

                {behavior ? (
                  <>
                    {/* Scroll drop-off: how many measured views got AT LEAST
                        this far. Cumulative, so it only ever descends. */}
                    {reached.some((r) => r.count > 0) && (
                      <p className="text-xs text-muted-foreground" dir="ltr" data-testid={`reached-${row.landingPageId}`}>
                        <span className="font-medium text-foreground">{t("builder.analytics.reachedTitle")}:</span>{" "}
                        {reached
                          .map(
                            (r) =>
                              `${t(`builder.analytics.section.${r.section}` as never)} ${Math.round((r.count / behavior.measured) * 100)}%`,
                          )
                          .join(" · ")}{" "}
                        <span className="opacity-70">
                          ({t("builder.analytics.measuredOf", { measured: behavior.measured })})
                        </span>
                      </p>
                    )}

                    {/* Engagement chips + WhatsApp (its own signal, never a
                        conversion — user decision §BH) + average time. */}
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {[
                        behavior.galleryChanges ? `${t("builder.analytics.gallery")} ${behavior.galleryChanges}` : null,
                        behavior.faqOpens ? `FAQ ${behavior.faqOpens}` : null,
                        behavior.variantChanges ? `${t("builder.analytics.variants")} ${behavior.variantChanges}` : null,
                        behavior.stickyBuyClicks ? `${t("builder.analytics.stickyTaps")} ${behavior.stickyBuyClicks}` : null,
                        behavior.whatsappClicks ? `${t("builder.analytics.colWhatsapp")} ${behavior.whatsappClicks}` : null,
                        `${t("builder.analytics.colAvgTime")} ${Math.round(behavior.avgActiveMs / 1000)}s`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>

                    {/* The most-opened questions — the AI's best input signal,
                        finally readable by the merchant directly. */}
                    {faqTop.length > 0 && (
                      <div className="text-xs" data-testid={`faq-opens-${row.landingPageId}`}>
                        <span className="font-medium">{t("builder.analytics.topQuestions")}</span>
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {faqTop.map((q, i) => (
                            <li key={i} className="flex items-baseline justify-between gap-3">
                              <span className="truncate">{q.question}</span>
                              <span className="tabular-nums" dir="ltr">{q.opens}×</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  /* Tracking off: the remedy, on the card, with the control
                     beside it for whoever the route admits (D2). D3 — flipping
                     it on for real pages — stays the merchant's own act. */
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border p-3"
                    data-testid={`behavior-off-${row.landingPageId}`}
                  >
                    <p className="text-xs text-muted-foreground">
                      {t("builder.analytics.trackingOff")}{" "}
                      <span className="opacity-80">{t("builder.analytics.trackingOffHint")}</span>
                    </p>
                    {mayWritePages && (
                      <EnableTrackingButton
                        landingPageId={row.landingPageId}
                        labels={{
                          enable: t("builder.analytics.enableTracking"),
                          enabling: t("builder.analytics.enablingTracking"),
                        }}
                        errors={trackingErrors}
                      />
                    )}
                  </div>
                )}

                {/* =====================================================
                    BH.3's recommendations — TR.1 presentation.

                    This is the most valuable thing on the screen and it was
                    the worst-presented: a flat list at the bottom of the card,
                    in the model's own arbitrary order, whose only emphasis was
                    the section name in an `bg-accent` chip that read as an
                    inline code tag.

                    Three changes, none of which touches how the advice is
                    GENERATED. (1) Ranked by a severity derived here from the
                    grounding number, because the stored order carries no
                    meaning and presenting it as a priority list would be a
                    claim the data does not support. (2) The grounding number
                    is promoted to a figure — it was fetched, validated against
                    the stored summary and then discarded by the renderer, and
                    it is the one part of an AI answer that cannot be wrong.
                    (3) An icon and a severity edge instead of a tag.
                    ===================================================== */}
                <div data-testid={`insight-${row.landingPageId}`} className="space-y-2">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    {insight
                      ? t("builder.analytics.insightMeta", {
                          date: formatDate(insight.createdAt, locale),
                          days: insight.windowDays,
                          views: summaryViews,
                        })
                      : t("builder.analytics.insightNone")}
                  </p>
                  {recommendations.length > 0 && (
                    <ul className="space-y-2">
                      {rankInsights(recommendations, {
                        views: summaryViews,
                        orders: row.orders,
                        /* The analysis's OWN denominator, out of the snapshot
                           it was written from — never today's. Advice written
                           when the page had 120 measured views must be judged
                           against 120. */
                        measured:
                          (insight?.inputSummary as { behavior?: { measured?: number } } | null)
                            ?.behavior?.measured ?? 0,
                      }).map((rec, i) => {
                        /* Read through a fallback: stored rows are cast
                           unvalidated on the way out of the database, so a
                           row written before a future vocabulary change must
                           still render rather than crash the screen. */
                        const SectionIcon = SECTION_ICON[rec.section] ?? LayoutTemplate;
                        const labelKey = metricLabelKey(rec.metric);
                        /* A positional `faq.qN` key resolves to the question
                           TEXT from the insight's own snapshot — never from
                           the live FAQ list, which may have been reordered
                           since, silently re-pointing the metric. */
                        const faqQuestion = rec.metric.startsWith("faq.q")
                          ? (
                              insight?.inputSummary as {
                                faqQuestions?: { key: string; question: string }[];
                              } | null
                            )?.faqQuestions?.find((q) => q.key === rec.metric)?.question ?? null
                          : null;
                        return (
                          <InsightCard
                            key={`${insight?.id ?? row.landingPageId}-${i}`}
                            testId={`insight-rec-${row.landingPageId}-${i}`}
                            severity={rec.severity}
                            sectionIcon={<SectionIcon aria-hidden="true" className="size-4" />}
                            sectionLabel={t(
                              `builder.analytics.section.${rec.section}` as never,
                            )}
                            finding={rec.finding}
                            suggestion={rec.suggestion}
                            value={formatNumber(rec.value, locale)}
                            metricLabel={
                              faqQuestion ??
                              (labelKey ? t(labelKey as "builder.analytics.views") : null)
                            }
                          />
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Store-level traffic (home, category listings): a small plain table —
          these have no behavior, no drafts and no analysis by design. */}
      {data.byPage.some((r) => r.landingPageId === null) && (
        <DataTable
          testId="analytics-pages"
          empty={t("builder.analytics.emptyPages")}
          rows={data.byPage.filter((r) => r.landingPageId === null)}
          rowKey={(row) => `${row.pageKind}:-`}
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
      )}
      {/* A store with NO traffic at all keeps the honest empty line the pages
          table used to carry. */}
      {data.byPage.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="analytics-empty">
          {t("builder.analytics.emptyPages")}
        </p>
      )}

      {/* TS.4 — channels as a RankList: what a source breakdown is read FOR
          is a comparison of magnitudes, not of digits (the PM.1 argument for
          agents, applied to traffic sources). Share is of the LONGEST bar so
          the leader reads full-width; views stay printed for the one time
          somebody needs the exact figure, with orders and the per-channel
          conversion beside them. */}
      <Section
        title={
          <span className="flex items-center gap-1.5">
            <Radio aria-hidden="true" className="size-4 text-muted-foreground" />
            {t("builder.analytics.channelsTitle")}
          </span>
        }
        testId="analytics-channels"
      >
        {/* TR.2 — a donut, not a ranked list. A source breakdown is read for
            SHARE — "how much of my traffic is Facebook" — and a ring says a
            share in one glance where a list of bars says five magnitudes.
            The categorical palette is `--chart-1..5`, defined in the tokens
            with a documented "neighbours stay distinguishable" ordering and,
            until now, used by nothing. Brand channels take it in rank order;
            direct and unattributed traffic stay grey so the ring's colour
            means "a platform", not "a bucket". Orders and conversion per
            channel ride the legend as the quieter second figure — the list
            this replaces printed them, and a redesign must not lose them. */}
        <DonutChart
          testId="analytics-channels-donut"
          total={data.byChannel.reduce((n, c) => n + c.views, 0)}
          totalDisplay={formatNumber(data.byChannel.reduce((n, c) => n + c.views, 0), locale)}
          totalLabel={t("builder.analytics.views")}
          emptyLabel={t("builder.analytics.emptyChannels")}
          segments={(() => {
            const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
            let brand = 0;
            return data.byChannel.map((row) => {
              const grey =
                row.channel === "direct"
                  ? "var(--neutral-fg)"
                  : row.channel === "other" || row.channel === "unattributed"
                    ? "var(--muted-foreground)"
                    : null;
              const channelConv = conversionRate(row.orders, row.views);
              return {
                key: row.channel,
                label: channelLabel(row.channel),
                value: row.views,
                display: formatNumber(row.views, locale),
                sub:
                  row.orders > 0
                    ? `${formatNumber(row.orders, locale)} ${t("builder.analytics.orders")}` +
                      (channelConv === null ? "" : ` · ${channelConv.toFixed(1)}%`)
                    : undefined,
                colour: grey ?? PALETTE[brand++ % PALETTE.length]!,
              };
            });
          })()}
        />
      </Section>

      {/* =====================================================================
          WM.1 — WHERE THE ORDERS GO. Real OpenStreetMap wilaya boundaries
          from a vendored asset, coloured on a single-hue sequential ramp
          (a count is a quantity, not a judgement — deliberately NOT the
          red-to-green scale), with the ranked list beside it carrying the
          same numbers for anyone the shapes don't serve. Zero-order wilayas
          render OFF the ramp so "no data" can never read as "very few".
          ===================================================================== */}
      <Section
        title={
          <span className="flex items-center gap-1.5">
            <MapIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            {t("builder.analytics.wilayaMapTitle")}
          </span>
        }
        description={
          wilayaMap.total > 0
            ? t("builder.analytics.wilayaMapIntro")
            : t("builder.analytics.wilayaMapNone")
        }
        testId="analytics-wilaya-map"
      >
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,19rem)]">
          <WilayaMap
            testId="wilaya-map-svg"
            byCode={wilayaMap.byCode}
            max={wilayaMap.max}
            titles={wilayaTitles}
            legendNone={t("builder.analytics.wilayaMapLegendNone")}
            legendScale={t("builder.analytics.wilayaMapLegendScale")}
          />

          {wilayaMap.rows.length > 0 && (
            <div className="space-y-3">
              <ol className="space-y-1.5 text-sm" data-testid="wilaya-map-rank">
                {wilayaMap.rows.map((row) => (
                  <li key={row.code} className="flex items-center gap-2" data-wilaya-row={row.code}>
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    <span className="tabular-nums text-muted-foreground" dir="ltr">
                      {formatNumber(row.count, locale)}
                    </span>
                    <span className="w-10 text-end font-medium tabular-nums" dir="ltr">
                      {row.sharePercent}%
                    </span>
                  </li>
                ))}
              </ol>

              {/* A name the reference no longer knows — impossible via
                  today's checkout, printed rather than silently dropped if
                  it ever happens. */}
              {wilayaMap.unmatched.length > 0 && (
                <div className="text-xs text-muted-foreground" data-testid="wilaya-map-unmatched">
                  <span className="font-medium">{t("builder.analytics.wilayaMapUnmatched")}:</span>{" "}
                  {wilayaMap.unmatched
                    .map((u) => `${u.wilaya} (${formatNumber(u.count, locale)})`)
                    .join(" · ")}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>
    </PageBody>
  );
}
