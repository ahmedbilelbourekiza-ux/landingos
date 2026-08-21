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

import { money, add, div, count, ZERO, toString, type Money } from "../money.ts";

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

  const base = (cfg.apiBase ?? "https://graph.facebook.com").replace(/\/+$/, "");
  const params = new URLSearchParams({
    time_increment: "1",
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    fields: "spend,impressions,clicks,account_currency,date_start,date_stop",
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
    });
  }
  return rows;
}

export interface SpendSummary {
  readonly spend: Money;
  /** Null only when there are no rows — never a guess. */
  readonly currency: string | null;
  readonly impressions: number;
  readonly clicks: number;
  readonly days: number;
}

/**
 * Total a set of days. THROWS on mixed currencies rather than picking one:
 * summing USD and EUR into a single figure is the exact class of silent
 * corruption this module exists to prevent, and one token here reaches nine
 * accounts.
 */
export function summariseSpend(rows: readonly DailySpendRow[]): SpendSummary {
  if (rows.length === 0) {
    return { spend: ZERO, currency: null, impressions: 0, clicks: 0, days: 0 };
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
  return { spend, currency, impressions, clicks, days: rows.length };
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
