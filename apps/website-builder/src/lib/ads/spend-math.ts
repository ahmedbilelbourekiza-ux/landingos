/* =============================================================================
 * LB.23 — the PURE half of ad-spend attribution: wire shapes and arithmetic.
 *
 * Split from `meta-ads.ts` on the `calc.ts` rule: everything here is a pure
 * function over plain data, so the suite imports it from bare node with no
 * database, no network and no Next build. The half that decides WHAT A NUMBER
 * MEANS is the half worth testing, and SEC.6 is the standing reminder of what
 * happens when only the other half has tests.
 *
 * Relative import of `../money.ts`, not `@/lib/money`: the alias only resolves
 * inside Next's build and this module is imported directly by the suite.
 *
 * ---------------------------------------------------------------------------
 * THE CURRENCY RULE, WHICH IS THE WHOLE REASON THIS MODULE IS CAREFUL
 *
 * Meta bills these accounts in USD. The stores sell in DA. This module NEVER
 * converts between them and never invents a rate. The ERP profit calculator
 * already owns that conversion — `CalcInputs.adsUsd × CalcInputs.rate`, where
 * the rate is typed by the manager because it moves — and its own comment
 * states the rule: "Bought in USD, accounted in DA, at a rate that moves."
 *
 * The consequence is deliberate and must not be "fixed" later by someone who
 * finds it inconvenient: **a true ROAS ratio cannot be produced here.** ROAS
 * is revenue ÷ spend, revenue is DA, spend is USD, and dividing them yields a
 * number with no unit that would look authoritative on a screen. So this
 * module answers the questions that ARE currency-honest — spend in its own
 * currency, orders as a count, and cost-per-order in the spend's currency —
 * and `crossCurrencyRatio` exists only to refuse, in one place, with a reason.
 * ========================================================================== */

import { money, add, div, mul, count, isZero, ZERO, toString, type Money } from "../money.ts";

/** What `PlatformCredential["meta-ads"]` holds, once decrypted. `apiBase` is
 * the render-domains/AiProvider stubbing seam — a test points it at a local
 * server; production leaves it unset and gets Meta. */
export interface MetaAdsConfig {
  readonly token: string;
  /** Meta's numeric account id, WITHOUT the `act_` prefix. */
  readonly accountId: string;
  readonly apiBase?: string;
}

export interface DateRange {
  /** `YYYY-MM-DD`, inclusive. */
  readonly since: string;
  readonly until: string;
}

/** One day of spend, exactly as the provider reported it. */
export interface DailySpendRow {
  readonly date: string;
  readonly spend: string;
  readonly currency: string;
  readonly impressions: number;
  readonly clicks: number;
  /* ME.B — null means "not reported for this row", never zero: rows pulled
   * before these fields existed were never asked the question, and a null
   * entering an average as 0 would fabricate a free day. `linkClicks` is
   * inline_link_clicks — the clicks that actually leave for the page (Meta's
   * `clicks` also counts reactions and profile taps). The meta* pair is
   * META-ATTRIBUTED (pixel/CAPI, Meta's own attribution windows, value in the
   * account currency by Meta's own conversion) — labeled "Meta-reported"
   * wherever shown, never merged with the platform's recorded orders. */
  readonly linkClicks: number | null;
  readonly metaPurchases: number | null;
  readonly metaPurchaseValue: string | null;
}

export interface WireRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Pinned rather than floating: a version bump is a decision with a changelog
 * entry, not something that happens because a default moved under us. */
export const META_GRAPH_VERSION = "v23.0";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` or throw. A malformed bound would silently widen the window
 * Meta bills against, and a silently wrong window is a silently wrong cost. */
function assertDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The daily-breakdown insights call. `time_increment=1` is what makes the
 * response one row per day rather than one aggregate — without it the sync
 * would store a single blob against whichever date it happened to pick.
 *
 * The token rides in the Authorization header, never the query string: a URL
 * reaches logs, proxies and error reports, and a bearer token in a query
 * string is a credential in all three.
 */
export function buildInsightsRequest(cfg: MetaAdsConfig, range: DateRange): WireRequest {
  assertDate(range.since, "since");
  assertDate(range.until, "until");
  if (range.until < range.since) {
    throw new Error(`until (${range.until}) precedes since (${range.since})`);
  }
  if (!cfg.accountId || /^act_/.test(cfg.accountId)) {
    throw new Error(
      `accountId must be the bare numeric id without the act_ prefix, got ${JSON.stringify(cfg.accountId)}`,
    );
  }
  /* SEC.9 (LB.23 review) — digits ONLY, enforced where the URL is built. The
   * intake route already regexes `^\d{5,25}$`, but this builder also takes
   * config from the PlatformCredential row (an attended script writes it),
   * and an id is interpolated into the request PATH — `123/../something`
   * must be a thrown refusal here, not a different Graph URL. */
  if (!/^\d+$/.test(cfg.accountId)) {
    throw new Error(
      `accountId must be digits only, got ${JSON.stringify(cfg.accountId)}`,
    );
  }

  const base = (cfg.apiBase ?? "https://graph.facebook.com").replace(/\/+$/, "");
  const params = new URLSearchParams({
    time_increment: "1",
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    /* ME.B — inline_link_clicks for real traffic clicks; actions +
     * action_values for the Meta-attributed purchase pair. All parsed
     * defensively: an account with no pixel simply lacks them. */
    fields: "spend,impressions,clicks,inline_link_clicks,actions,action_values,account_currency,date_start,date_stop",
    limit: "500",
  });

  return {
    url: `${base}/${META_GRAPH_VERSION}/act_${cfg.accountId}/insights?${params.toString()}`,
    headers: { Authorization: `Bearer ${cfg.token}` },
  };
}

function asCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/**
 * Insights JSON → rows, dropping anything that is not a usable day.
 *
 * A row without a `date_start` or without a parseable `spend` is SKIPPED, not
 * defaulted to zero: a zero would enter the average as a real day of free
 * advertising and drag every cost-per-order down. Absent is absent.
 */
export function parseInsightsRows(payload: unknown): DailySpendRow[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];

  const rows: DailySpendRow[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    const date = typeof r.date_start === "string" ? r.date_start : null;
    if (!date || !DATE_RE.test(date)) continue;

    const spendRaw = r.spend;
    if (spendRaw === undefined || spendRaw === null || spendRaw === "") continue;
    const spend = String(spendRaw);
    if (!/^\d+(\.\d+)?$/.test(spend)) continue;

    const currency = typeof r.account_currency === "string" ? r.account_currency : "";
    if (!currency) continue;

    rows.push({
      date,
      spend,
      currency,
      impressions: asCount(r.impressions),
      clicks: asCount(r.clicks),
      linkClicks: asNullableCount(r.inline_link_clicks),
      metaPurchases: readAction(r.actions, asNullableCount),
      metaPurchaseValue: readAction(r.action_values, asMoneyString),
    });
  }
  return rows;
}

/** Absent stays null (never zero — see DailySpendRow). */
function asNullableCount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function asMoneyString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value);
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

/**
 * ME.B — one entry from Meta's `actions` / `action_values` array shape:
 * `[{ action_type, value }, …]`. We read `purchase` EXACTLY — the aggregated
 * pixel/CAPI purchase Meta reports for the account's configured attribution —
 * and nothing else; a malformed or absent array is null, not zero.
 */
function readAction<T>(
  list: unknown,
  read: (value: unknown) => T | null,
  actionType = "purchase",
): T | null {
  if (!Array.isArray(list)) return null;
  const entry = list.find(
    (a) => (a as { action_type?: unknown } | null)?.action_type === actionType,
  ) as { value?: unknown } | undefined;
  return entry === undefined ? null : read(entry.value);
}

export interface SpendSummary {
  readonly spend: Money;
  /** Null only when there are no rows — never a guess. */
  readonly currency: string | null;
  readonly impressions: number;
  readonly clicks: number;
  readonly days: number;
  /* ME.B — null when NO row in the window reported the field (a pre-ME.B
   * window, or an account without a pixel); a partial window sums what was
   * reported. Null and 0 stay distinct all the way to the screen. */
  readonly linkClicks: number | null;
  readonly metaPurchases: number | null;
  readonly metaPurchaseValue: Money | null;
}

/**
 * Total a set of days. THROWS on mixed currencies rather than picking one:
 * summing USD and EUR into a single figure is the exact class of silent
 * corruption this module exists to prevent, and one token here reaches nine
 * accounts.
 */
export function summariseSpend(rows: readonly DailySpendRow[]): SpendSummary {
  if (rows.length === 0) {
    return {
      spend: ZERO, currency: null, impressions: 0, clicks: 0, days: 0,
      linkClicks: null, metaPurchases: null, metaPurchaseValue: null,
    };
  }
  const currency = rows[0]!.currency;
  let spend = ZERO;
  let impressions = 0;
  let clicks = 0;

  for (const r of rows) {
    if (r.currency !== currency) {
      throw new Error(
        `mixed currencies in one summary (${currency} and ${r.currency}) — refusing to add them`,
      );
    }
    spend = add(spend, money(r.spend));
    impressions += r.impressions;
    clicks += r.clicks;
  }

  /* ME.B — sum what was reported; a window where NOTHING reported the field
   * answers null, not zero. */
  let linkClicks: number | null = null;
  let metaPurchases: number | null = null;
  let metaPurchaseValue: Money | null = null;
  for (const r of rows) {
    if (r.linkClicks !== null) linkClicks = (linkClicks ?? 0) + r.linkClicks;
    if (r.metaPurchases !== null) metaPurchases = (metaPurchases ?? 0) + r.metaPurchases;
    if (r.metaPurchaseValue !== null) {
      metaPurchaseValue = add(metaPurchaseValue ?? ZERO, money(r.metaPurchaseValue));
    }
  }

  return {
    spend, currency, impressions, clicks, days: rows.length,
    linkClicks, metaPurchases, metaPurchaseValue,
  };
}

export interface CostPerOrder {
  readonly value: Money;
  /** Carried so a renderer cannot print a USD figure under a DA symbol. */
  readonly currency: string;
}

/**
 * Spend ÷ orders, in the SPEND's currency. Null when there is nothing to
 * divide — zero orders is not "infinite cost", it is "not yet answerable",
 * and a screen must say so rather than render ∞ or 0.00.
 */
export function costPerOrder(summary: SpendSummary, orders: number): CostPerOrder | null {
  if (!summary.currency) return null;
  if (!Number.isFinite(orders) || orders <= 0) return null;
  return { value: div(summary.spend, count(orders)), currency: summary.currency };
}

/* -----------------------------------------------------------------------------
 * ME.A — the three ratios every ad buyer reads, derived from sums already
 * stored. NO new fetch, NO new columns: CTR, CPC and CPM are ratios of the
 * window's totals, so they equal what Meta itself reports for the same range
 * (Meta computes them from the same sums). Each is null when its denominator
 * is zero — "not answerable", never 0.00 or ∞ — with one deliberate
 * exception: impressions with zero clicks IS a real 0% CTR, not an unknown.
 *
 * Units, stated because the numbers sit side by side: CTR is unit-less (a
 * percentage of impressions); CPC and CPM are in the SPEND's currency, which
 * the caller already carries next to every other money figure. `cpmPerMille`
 * is cost per THOUSAND impressions, the industry's own definition.
 * -------------------------------------------------------------------------- */
export interface DerivedAdMetrics {
  /** Clicks per 100 impressions. Null only when there are no impressions. */
  readonly ctr: Money | null;
  /** Spend per click, in the spend's currency. Null when there are no clicks. */
  readonly costPerClick: Money | null;
  /** Spend per 1000 impressions, in the spend's currency. */
  readonly cpmPerMille: Money | null;
  /* ME.B — the LINK pair, from inline_link_clicks: the truer traffic
   * numbers. Null whenever the window reported no link clicks at all
   * (pre-ME.B rows); a reported 0 with impressions is a real 0% link CTR. */
  readonly linkCtr: Money | null;
  readonly costPerLinkClick: Money | null;
}

export function derivedAdMetrics(summary: SpendSummary): DerivedAdMetrics {
  // No rows → no currency → nothing derivable (the summary's own rule).
  if (!summary.currency) {
    return { ctr: null, costPerClick: null, cpmPerMille: null, linkCtr: null, costPerLinkClick: null };
  }
  const impressions = count(summary.impressions);
  const clicks = count(summary.clicks);
  const link = summary.linkClicks;
  return {
    ctr: summary.impressions > 0 ? div(mul(clicks, count(100)), impressions) : null,
    costPerClick: summary.clicks > 0 ? div(summary.spend, clicks) : null,
    cpmPerMille:
      summary.impressions > 0 ? div(mul(summary.spend, count(1000)), impressions) : null,
    linkCtr:
      link !== null && summary.impressions > 0
        ? div(mul(count(link), count(100)), impressions)
        : null,
    costPerLinkClick: link !== null && link > 0 ? div(summary.spend, count(link)) : null,
  };
}

/**
 * ME.B — Meta-reported ROAS: Meta's own attributed purchase value over the
 * spend, BOTH in the account currency by Meta's own conversion — so the ratio
 * is currency-honest in a way the platform's DA revenue never can be against
 * USD spend (`crossCurrencyRatio` still refuses that one). It is Meta's
 * number about Meta's attribution, and every surface that shows it says
 * "Meta-reported". Null when there is no attributed value or no spend.
 */
export function metaReportedRoas(summary: SpendSummary): Money | null {
  if (!summary.currency || summary.metaPurchaseValue === null) return null;
  if (isZero(summary.spend)) return null;
  return div(summary.metaPurchaseValue, summary.spend);
}

/* -----------------------------------------------------------------------------
 * ME.B — WINDOW-level reach: the second, un-incremented insights call.
 *
 * Reach is NOT additive across days (one person seen on three days is one
 * person), so it cannot be summed from the daily rows — it must be asked for
 * the window as a whole. Same endpoint, same auth, NO time_increment.
 * -------------------------------------------------------------------------- */
export function buildReachRequest(cfg: MetaAdsConfig, range: DateRange): WireRequest {
  assertDate(range.since, "since");
  assertDate(range.until, "until");
  if (range.until < range.since) {
    throw new Error(`until (${range.until}) precedes since (${range.since})`);
  }
  if (!/^\d+$/.test(cfg.accountId)) {
    throw new Error(`accountId must be digits only, got ${JSON.stringify(cfg.accountId)}`);
  }
  const base = (cfg.apiBase ?? "https://graph.facebook.com").replace(/\/+$/, "");
  const params = new URLSearchParams({
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    fields: "reach,frequency",
  });
  return {
    url: `${base}/${META_GRAPH_VERSION}/act_${cfg.accountId}/insights?${params.toString()}`,
    headers: { Authorization: `Bearer ${cfg.token}` },
  };
}

/** The single aggregate row → {reach, frequency}, or null when unusable. */
export function parseReachRow(payload: unknown): { reach: number; frequency: string } | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as Record<string, unknown>;
  const reach = asNullableCount(r.reach);
  if (reach === null) return null;
  const frequency = asMoneyString(r.frequency) ?? "0";
  return { reach, frequency };
}

/**
 * The refusal, in one named place.
 *
 * Callers reaching for "ROAS" land here and get a reason instead of a number.
 * Returning null rather than throwing is deliberate: a screen should render
 * "needs the exchange rate" beside the honest figures, not fail to load.
 */
export function crossCurrencyRatio(
  spendCurrency: string,
  revenueCurrency: string,
): { readonly ok: false; readonly reason: string } | { readonly ok: true } {
  if (spendCurrency === revenueCurrency) return { ok: true };
  return {
    ok: false,
    reason:
      `spend is ${spendCurrency} and revenue is ${revenueCurrency}; no rate is stored here. ` +
      `The ERP calculator converts with the rate the manager types (adsUsd x rate).`,
  };
}

/** Formatting helper so callers do not each re-derive 2dp from Money. */
export function formatSpend(value: Money, currency: string): string {
  return `${toString(value, 2)} ${currency}`;
}

/* -----------------------------------------------------------------------------
 * ME.C — CAMPAIGN-level spend: the same daily insights call at
 * `level=campaign`, so a day answers one row PER CAMPAIGN with Meta's own id
 * and name. Spend-side only, deliberately: joining ORDERS to campaigns needs
 * the ad links tagged with {{campaign.name}} first (BH.4 captures
 * utm_campaign when they are), and this table honestly answers "where did
 * the money go" without pretending to answer "what did it buy".
 * -------------------------------------------------------------------------- */
export interface CampaignSpendRow extends DailySpendRow {
  readonly campaignId: string;
  readonly campaignName: string;
}

export function buildCampaignInsightsRequest(cfg: MetaAdsConfig, range: DateRange): WireRequest {
  const base = buildInsightsRequest(cfg, range);
  const url = new URL(base.url);
  url.searchParams.set("level", "campaign");
  url.searchParams.set(
    "fields",
    "campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,account_currency,date_start,date_stop",
  );
  return { url: url.toString(), headers: base.headers };
}

/** Campaign rows: the daily parser's rules plus a REQUIRED campaign identity —
 * a row that cannot say which campaign it is belongs to no campaign, not to a
 * made-up one. */
export function parseCampaignRows(payload: unknown): CampaignSpendRow[] {
  const days = parseInsightsRows(payload);
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: CampaignSpendRow[] = [];
  // parseInsightsRows drops unusable rows, so re-walk the raw list pairing
  // each SURVIVING day with its campaign identity by original position.
  let cursor = 0;
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    const date = typeof r.date_start === "string" ? r.date_start : null;
    const spend = r.spend;
    const currency = typeof r.account_currency === "string" ? r.account_currency : "";
    const usable =
      date && DATE_RE.test(date) &&
      spend !== undefined && spend !== null && spend !== "" &&
      /^\d+(\.\d+)?$/.test(String(spend)) && currency;
    if (!usable) continue;
    const day = days[cursor++];
    if (!day) break;
    const campaignId = typeof r.campaign_id === "string" && r.campaign_id ? r.campaign_id : null;
    const campaignName =
      typeof r.campaign_name === "string" && r.campaign_name ? r.campaign_name : null;
    if (!campaignId || !campaignName) continue;
    out.push({ ...day, campaignId, campaignName });
  }
  return out;
}
