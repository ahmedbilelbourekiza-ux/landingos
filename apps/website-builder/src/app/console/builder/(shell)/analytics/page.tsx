import { can } from "@landingos/auth";
import { withTenant } from "@landingos/db";
import { formatDate, formatNumber, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

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
} from "@/lib/builder/analytics";
import { adSpendPanel } from "@/lib/builder/ad-spend-panel";
import { pruneExpiredVisits } from "@/lib/storefront/visit-retention";
import { INSIGHT_MIN_VIEWS, type InsightRecommendationData } from "@/lib/landing/ai-insight";
import { PageHeader, PageBody, Section } from "@/components/console/ui/primitives";
/* TS.2 — the console's ONE analytics language (PM.1's dashboard-parts):
 * KpiTile with its previous-window delta, PeriodTabs as URL-driven links.
 * Imported across the erp/ boundary deliberately — these are pure renders
 * over props with no ERP semantics, and a second copy for the builder is how
 * two dashboards drift apart. */
import { KpiTile, PeriodTabs, RankList } from "@/components/console/erp/dashboard-parts";
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

  /* `withTenant`, not `forTenant`: the uniques aggregate is raw SQL and needs
   * the one bound transaction connection (the proxy cannot carry it). The
   * prune runs FIRST, in the same transaction — AN.2's read-path retention:
   * whoever looks at analytics sweeps their own expired rows, so this screen
   * never reports over data the retention rule says should be gone. */
  const { data, insights, spend: adSpend, prev } = await withTenant(session.auth!.tenantId, async (db) => {
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
    return { data: analytics, insights: newestPerPage, spend, prev: comparison };
  });

  const channelLabel = (channel: string) =>
    CHANNEL_BRANDS[channel] ?? t(`builder.analytics.channel.${channel}` as any);

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

  return (
    <PageBody>
      <PageHeader title={t("builder.nav.analytics")} />

      {/* The counting basis, stated where the numbers are read: browser-side,
          so crawlers and the editor's own preview never count — and the
          merchant's own browsing does. Saying it beats a heuristic that
          half-hides it. */}
      <p className="text-sm text-muted-foreground">{t("builder.analytics.basis")}</p>

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

      {/* TS.2 — the KPI band, in the console's one analytics language
          (PM.1's KpiTile): each figure with its delta against the
          same-length window before, rates with their denominators. */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="analytics-totals">
        <KpiTile
          id="traffic-views"
          label={t("builder.analytics.views")}
          value={formatNumber(data.totals.views, locale)}
          delta={percentDelta(data.totals.views, prev.views)}
          deltaKind="percent"
          riseIsGood
          comparison={t("builder.analytics.vsPrevious")}
          noComparison={t("builder.analytics.noPrevious")}
        />
        <KpiTile
          id="traffic-visitors"
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
        <KpiTile
          id="traffic-orders"
          label={t("builder.analytics.orders")}
          value={formatNumber(data.totals.orders, locale)}
          delta={percentDelta(data.totals.orders, prev.orders)}
          deltaKind="percent"
          riseIsGood
          comparison={t("builder.analytics.vsPrevious")}
          noComparison={t("builder.analytics.noPrevious")}
        />
        <KpiTile
          id="traffic-conversion"
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
        />
      </div>

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
      <Section title={t("builder.analytics.adSpendTitle")} testId="analytics-ad-spend">

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
            <div className="flex flex-wrap gap-4 text-sm" data-testid="analytics-ad-spend-totals">
              <span>
                {/* Currency beside the number, always — it is USD while every
                    other figure on this screen is DA. */}
                <span className="font-semibold tabular-nums">{adSpend.spend}</span>{" "}
                <span className="text-muted-foreground">{adSpend.currency}</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums">{adSpend.impressions}</span>{" "}
                <span className="text-muted-foreground">
                  {t("builder.analytics.adSpendImpressions")}
                </span>
              </span>
              <span>
                <span className="font-semibold tabular-nums">{adSpend.clicks}</span>{" "}
                <span className="text-muted-foreground">
                  {t("builder.analytics.adSpendClicks")}
                </span>
              </span>
              {/* ME.A — the derived trio, from the SAME stored sums (no new
                  fetch): CTR as a percentage, CPC/CPM in the spend's own
                  currency like every money figure here. A null is SKIPPED —
                  an unanswerable ratio must not render as 0.00. */}
              {adSpend.ctr !== null && (
                <span data-testid="analytics-ad-ctr">
                  {/* One template literal, one text node: `{v}%` SSRs as
                      `2.00<!-- -->%`, which breaks copy-paste and any exact
                      text assertion. */}
                  <span className="font-semibold tabular-nums" dir="ltr">{`${adSpend.ctr}%`}</span>{" "}
                  <span className="text-muted-foreground">{t("builder.analytics.adSpendCtr")}</span>
                </span>
              )}
              {adSpend.costPerClick !== null && (
                <span data-testid="analytics-ad-cpc">
                  <span className="font-semibold tabular-nums">{adSpend.costPerClick}</span>{" "}
                  <span className="text-muted-foreground">
                    {adSpend.currency} {t("builder.analytics.adSpendCostPerClick")}
                  </span>
                </span>
              )}
              {adSpend.cpmPerMille !== null && (
                <span data-testid="analytics-ad-cpm">
                  <span className="font-semibold tabular-nums">{adSpend.cpmPerMille}</span>{" "}
                  <span className="text-muted-foreground">
                    {adSpend.currency} {t("builder.analytics.adSpendCpm")}
                  </span>
                </span>
              )}
              <span>
                <span className="font-semibold tabular-nums">{adSpend.orders}</span>{" "}
                <span className="text-muted-foreground">
                  {t("builder.analytics.adSpendOrders")}
                </span>
              </span>
              <span data-testid="analytics-cost-per-order">
                {adSpend.costPerOrder === null ? (
                  <span className="text-muted-foreground">
                    {t("builder.analytics.adSpendNotAnswerable")}
                  </span>
                ) : (
                  <>
                    <span className="font-semibold tabular-nums">{adSpend.costPerOrder}</span>{" "}
                    <span className="text-muted-foreground">
                      {adSpend.currency} {t("builder.analytics.adSpendCostPerOrder")}
                    </span>
                  </>
                )}
              </span>
            </div>
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
        <section className="space-y-4" data-testid="analytics-page-cards">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
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

            /* The funnel, bars scaled to VIEWS. Denominators differ mid-funnel
               (sawForm counts measured views only) and the row labels say so
               rather than pretending one basis. */
            const funnel: { key: string; label: string; count: number }[] = [
              { key: "viewed", label: t("builder.analytics.funnelViewed"), count: views },
              ...(behavior
                ? [{
                    key: "sawForm",
                    label: t("builder.analytics.funnelSawForm", { measured: behavior.measured }),
                    count: behavior.sawForm,
                  }]
                : []),
              { key: "drafts", label: t("builder.analytics.funnelDrafts"), count: drafts.started },
              { key: "phone", label: t("builder.analytics.funnelPhone"), count: drafts.withPhone },
              { key: "ordered", label: t("builder.analytics.funnelOrdered"), count: row.orders },
            ];
            const funnelMax = Math.max(views, 1);

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

            return (
              <div
                key={row.landingPageId}
                data-testid={`page-card-${row.landingPageId}`}
                className="space-y-4 rounded-lg border border-border bg-surface-raised p-4"
              >
                {/* Header: identity + traffic + the analyze slot. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-medium">{row.title ?? "—"}</span>
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

                {behavior ? (
                  <>
                    {/* The funnel. Bars are server-rendered divs (the PM.1
                        no-chart-library rule); the exact counts stay printed. */}
                    <div className="space-y-1.5" data-testid={`funnel-${row.landingPageId}`}>
                      {funnel.map((step) => (
                        <div
                          key={step.key}
                          className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-2 text-xs"
                        >
                          <span className="truncate text-muted-foreground">{step.label}</span>
                          <span className="h-3 overflow-hidden rounded-sm bg-surface-subtle" aria-hidden="true">
                            <span
                              className="block h-full rounded-sm"
                              style={{
                                inlineSize: `${Math.min(100, Math.max(step.count > 0 ? 2 : 0, (step.count / funnelMax) * 100))}%`,
                                backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
                              }}
                            />
                          </span>
                          <span className="tabular-nums text-muted-foreground" dir="ltr">
                            {formatNumber(step.count, locale)}
                          </span>
                        </div>
                      ))}
                    </div>

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

                {/* BH.3 — the stored recommendations, exactly as TS.1 wired
                    them: newest analysis, each claim with its section chip. */}
                <div data-testid={`insight-${row.landingPageId}`}>
                  <p className="text-xs text-muted-foreground">
                    {insight
                      ? t("builder.analytics.insightMeta", {
                          date: formatDate(insight.createdAt, locale),
                          days: insight.windowDays,
                          views: summaryViews,
                        })
                      : t("builder.analytics.insightNone")}
                  </p>
                  {recommendations.length > 0 && (
                    <ul className="mt-2 space-y-3">
                      {recommendations.map((rec, i) => (
                        <li key={i} className="rounded-md border border-border p-3 text-sm">
                          <span className="me-2 rounded bg-accent px-1.5 py-0.5 text-xs font-medium">
                            {t(`builder.analytics.section.${rec.section}` as never)}
                          </span>
                          <span>{rec.finding}</span>
                          <p className="mt-1 text-muted-foreground">{rec.suggestion}</p>
                        </li>
                      ))}
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
        title={t("builder.analytics.channelsTitle")}
        testId="analytics-channels"
      >
        <RankList
          testId="analytics-channels-rank"
          emptyLabel={t("builder.analytics.emptyChannels")}
          rows={(() => {
            const maxViews = Math.max(...data.byChannel.map((c) => c.views), 1);
            return data.byChannel.map((row) => {
              const channelConv = conversionRate(row.orders, row.views);
              return {
                key: row.channel,
                label: channelLabel(row.channel),
                sub:
                  `${formatNumber(row.orders, locale)} ${t("builder.analytics.orders")}` +
                  (channelConv === null ? "" : ` · ${channelConv.toFixed(1)}%`),
                value: formatNumber(row.views, locale),
                share: (row.views / maxViews) * 100,
              };
            });
          })()}
        />
      </Section>
    </PageBody>
  );
}
