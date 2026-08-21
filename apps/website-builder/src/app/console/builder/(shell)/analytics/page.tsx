import Link from "next/link";

import { can } from "@landingos/auth";
import { withTenant } from "@landingos/db";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { analyticsRange, storefrontAnalytics } from "@/lib/builder/analytics";
import { adSpendPanel } from "@/lib/builder/ad-spend-panel";
import { pruneExpiredVisits } from "@/lib/storefront/visit-retention";
import { INSIGHT_MIN_VIEWS, type InsightRecommendationData } from "@/lib/landing/ai-insight";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { AnalyzePageButton } from "@/components/console/builder/analyze-page-button";
import { RefreshSpendButton } from "@/components/console/builder/refresh-spend-button";
import { ConnectAdAccountPanel } from "@/components/console/builder/connect-ad-account";

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
  const { session, locale: rawLocale, t } = await requireProduct(
    "website-builder",
    "/console/builder/analytics",
  );
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const range = analyticsRange((await searchParams).days);

  // SEC.8 — the analyze button bills the tenant's AI key, which is its own
  // permission now. Without it the button is not rendered at all: this screen
  // is reachable on orders:read, and a control that can only answer 403 is
  // the reachability defect in reverse.
  const maySpendOnAi = can(session.auth!, "website-builder:ai:spend");

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
  const { data, insights, spend: adSpend } = await withTenant(session.auth!.tenantId, async (db) => {
    await pruneExpiredVisits(db);
    const analytics = await storefrontAnalytics(db, range);
    /* BH.3 — the newest stored analysis per measured page. DISTINCT ON is
     * what this wants; Prisma's shape for it is one ordered findMany kept
     * first-per-page here (the list is bounded by the behavior table). */
    const insightRows = analytics.behaviorByPage.length
      ? await (db as any).landingInsight.findMany({
          where: { landingPageId: { in: analytics.behaviorByPage.map((r) => r.landingPageId) } },
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
    return { data: analytics, insights: newestPerPage, spend };
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

      {/* LB.23 — real ad spend, pulled from Meta, beside the orders AN.1
          attributed to the same channels. Four distinct states rather than a
          zero for all of them: a screen that renders 0.00 whether nothing is
          connected, nothing is synced or nothing was spent teaches a merchant
          to distrust the figure that IS real.

          The spend is in the AD ACCOUNT's currency (USD) and the store sells
          in DA. Nothing here converts: the profit calculator already owns
          that, with the rate the manager types. The note says so on the
          screen rather than leaving a bare number to be misread. */}
      <section className="space-y-2" data-testid="analytics-ad-spend">
        <h2 className="text-sm font-semibold">{t("builder.analytics.adSpendTitle")}</h2>

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
            {/* Collapsed here: nothing is broken, but a token expires or gets
                revoked, and rotating it must not require database access. */}
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
          </>
        )}
      </section>

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

      {/* BH.2 — behavior, over MEASURED views only (pages that opted in via
          the editor's Display section AND whose visitors' exit flush landed).
          Rates render with their denominator so a 100% from three views
          cannot masquerade as knowledge. */}
      {data.behaviorByPage.length > 0 && (
        <DataTable
          testId="analytics-behavior"
          empty={t("builder.analytics.behaviorEmpty")}
          rows={data.behaviorByPage}
          rowKey={(row) => row.landingPageId}
          columns={[
            { id: "page", header: t("builder.analytics.colPage"), cell: (row) => row.title ?? "—" },
            {
              id: "measured",
              header: t("builder.analytics.colMeasured"),
              align: "end",
              numeric: true,
              cell: (row) => row.measured,
            },
            {
              id: "sawForm",
              header: t("builder.analytics.colSawForm"),
              align: "end",
              numeric: true,
              cell: (row) =>
                `${row.sawForm} (${Math.round((row.sawForm / row.measured) * 100)}%)`,
            },
            {
              id: "reached",
              header: t("builder.analytics.colReached"),
              cell: (row) => (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {["hero", "description", "reviews", "faq", "footer"]
                    .filter((s) => row.furthest[s])
                    .map((s) => `${t(`builder.analytics.section.${s}` as never)} ${row.furthest[s]}`)
                    .join(" · ") || "—"}
                </span>
              ),
            },
            {
              id: "engagement",
              header: t("builder.analytics.colEngagement"),
              cell: (row) => (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {[
                    row.galleryChanges ? `${t("builder.analytics.gallery")} ${row.galleryChanges}` : null,
                    row.faqOpens ? `FAQ ${row.faqOpens}` : null,
                    row.variantChanges ? `${t("builder.analytics.variants")} ${row.variantChanges}` : null,
                    row.stickyBuyClicks ? `${t("builder.analytics.stickyTaps")} ${row.stickyBuyClicks}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              ),
            },
            {
              id: "whatsapp",
              // NOT folded into orders/conversion (user decision §BH): a
              // WhatsApp sale never touches the checkout, so it stays its
              // own honestly-labelled column.
              header: t("builder.analytics.colWhatsapp"),
              align: "end",
              numeric: true,
              cell: (row) => row.whatsappClicks,
            },
            {
              id: "time",
              header: t("builder.analytics.colAvgTime"),
              align: "end",
              numeric: true,
              cell: (row) => `${Math.round(row.avgActiveMs / 1000)}s`,
            },
          ]}
        />
      )}

      {/* BH.3 — AI recommendations, per measured page: on-demand, cooldown
          re-shown, quota-gated (AQ.1), aggregates-only by construction. The
          stored insight renders beside the button that made it; each claim
          carries the number it rests on, because claims without numbers were
          refused before storage. */}
      {data.behaviorByPage.length > 0 && (
        <section className="space-y-4" data-testid="analytics-insights">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              {t("builder.analytics.insightHeading")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("builder.analytics.insightIntro")}
            </p>
          </div>
          {data.behaviorByPage.map((row) => {
            const insight = insights.get(row.landingPageId);
            const views =
              data.byPage.find((p) => p.landingPageId === row.landingPageId)?.views ?? 0;
            const recommendations = (insight?.recommendations ?? []) as InsightRecommendationData[];
            const summaryViews = (insight?.inputSummary as { views?: number } | null)?.views ?? 0;
            return (
              <div
                key={row.landingPageId}
                data-testid={`insight-${row.landingPageId}`}
                className="rounded-lg border border-border bg-surface-raised p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-medium">{row.title ?? "—"}</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {insight
                        ? t("builder.analytics.insightMeta", {
                            date: formatDate(insight.createdAt, locale),
                            days: insight.windowDays,
                            views: summaryViews,
                          })
                        : t("builder.analytics.insightNone")}
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
                {recommendations.length > 0 && (
                  <ul className="mt-3 space-y-3">
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
            );
          })}
        </section>
      )}

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
