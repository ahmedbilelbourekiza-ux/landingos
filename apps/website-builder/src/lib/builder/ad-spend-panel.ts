import {
  summariseSpend,
  costPerOrder,
  crossCurrencyRatio,
  derivedAdMetrics,
  metaReportedRoas,
  type DailySpendRow,
} from "../ads/spend-math.ts";
import { toString, add, money, ZERO, type Money } from "../money.ts";

/* =============================================================================
 * LB.23 read side — what the Traffic screen shows about ad spend.
 *
 * Shaped for a SCREEN, so every "cannot answer" is a distinct state rather
 * than a zero: no account connected, connected but never synced, synced with
 * nothing to report, and answerable. A screen that renders 0.00 for all four
 * teaches a merchant to distrust the number that is real.
 *
 * ⚠ NO CONVERSION HAPPENS HERE. Spend is USD, the store sells in DA, and this
 * module reports each in its own currency and says so. See spend-math.ts for
 * why, and the ERP calculator (`adsUsd x rate`) for where conversion lives.
 * ========================================================================== */

/** Meta bills Facebook AND Instagram placements to one ad account, while AN.1
 * records them as two channels — so the order side must count both or the
 * cost-per-order is wrong on each. */
export const META_ORDER_CHANNELS = ["facebook", "instagram"] as const;

export type AdSpendPanel =
  | { readonly state: "unconfigured" }
  | {
      readonly state: "never-synced";
      readonly accountName: string;
      /** So the screen can offer the FIRST pull from here — this state is
       *  exactly where a refresh is the merchant's next action. */
      readonly adAccountId: string;
      /** LB.23c — enough to PRE-FILL the connect form, so pasting a token into
       *  an account that already exists is an edit and not a re-entry. */
      readonly accountRef: string;
      readonly currency: string;
    }
  | {
      readonly state: "ready";
      readonly accountName: string;
      readonly adAccountId: string;
      readonly accountRef: string;
      readonly lastSyncedAt: Date;
      /** Formatted to 2dp; the currency is carried separately, never merged. */
      readonly spend: string;
      readonly currency: string;
      readonly days: number;
      readonly impressions: number;
      readonly clicks: number;
      readonly orders: number;
      /** Null when unanswerable (no spend rows, or zero orders). */
      readonly costPerOrder: string | null;
      /* ME.A — derived from the same stored sums (spend/impressions/clicks);
       * formatted here so the screen never does arithmetic. CTR is a
       * percentage; the two costs are in `currency`. Null = not answerable
       * (zero denominator), and the screen SKIPS a null rather than
       * rendering 0.00 for it. */
      readonly ctr: string | null;
      readonly costPerClick: string | null;
      readonly cpmPerMille: string | null;
      /* ME.B — the link pair (inline_link_clicks) and the META-REPORTED pair
       * (pixel/CAPI attribution, values converted by Meta into the account
       * currency). Null = not reported for this window, and every surface
       * labels the meta* figures "Meta-reported" — they are Meta's numbers
       * about Meta's attribution, never the platform's own orders. */
      readonly linkClicks: number | null;
      readonly linkCtr: string | null;
      readonly costPerLinkClick: string | null;
      readonly metaPurchases: number | null;
      readonly metaRoas: string | null;
      /* ME.C — top campaigns by spend in the window, aggregated from the
       * campaign table (spend-side only; the orders join waits for tagged
       * links). Share is of the LARGEST campaign, for the screen's bars.
       * Empty when the campaign call has never landed rows. */
      readonly campaigns: readonly {
        readonly name: string;
        readonly spend: string;
        readonly clicks: number;
        readonly share: number;
      }[];
      /** Window-level reach of the LAST refreshed window, with its own days. */
      readonly reach: { readonly people: number; readonly frequency: string; readonly days: number | null } | null;
      /** Set when spend and revenue currencies differ — the honest refusal. */
      readonly ratioRefusal: string | null;
    };

interface SpendClient {
  adAccount: {
    findFirst(args: unknown): Promise<{
      id: string;
      name: string;
      accountId: string;
      currency: string;
      lastSyncedAt: Date | null;
      reach: number | null;
      frequency: { toString(): string } | null;
      reachDays: number | null;
    } | null>;
  };
  adSpendDaily: {
    findMany(args: unknown): Promise<
      {
        date: Date;
        spend: { toString(): string };
        currency: string;
        impressions: number;
        clicks: number;
        linkClicks: number | null;
        metaPurchases: number | null;
        metaPurchaseValue: { toString(): string } | null;
      }[]
    >;
  };
  adSpendCampaignDaily: {
    findMany(args: unknown): Promise<
      { campaignId: string; campaignName: string; spend: { toString(): string }; clicks: number }[]
    >;
  };
  salesOrder: { count(args: unknown): Promise<number> };
}

/**
 * @param storeCurrency the tenant's own selling currency (DZD here). Passed in
 *   rather than assumed, so the refusal message names the real pair.
 */
export async function adSpendPanel(
  db: SpendClient,
  range: { readonly days: number; readonly since: Date; readonly until: Date },
  storeCurrency: string,
): Promise<AdSpendPanel> {
  const account = await db.adAccount.findFirst({
    where: { provider: "meta", isActive: true },
    select: { id: true, name: true, accountId: true, currency: true, lastSyncedAt: true, reach: true, frequency: true, reachDays: true },
    orderBy: { createdAt: "asc" },
  });
  if (!account) return { state: "unconfigured" };
  if (!account.lastSyncedAt) {
    // Distinct from "synced and found nothing" — one is our job to fix, the
    // other is a true fact about the account.
    return {
      state: "never-synced",
      accountName: account.name,
      adAccountId: account.id,
      accountRef: account.accountId,
      currency: account.currency,
    };
  }

  const stored = await db.adSpendDaily.findMany({
    where: { adAccountId: account.id, date: { gte: range.since, lt: range.until } },
    select: { date: true, spend: true, currency: true, impressions: true, clicks: true, linkClicks: true, metaPurchases: true, metaPurchaseValue: true },
    orderBy: { date: "asc" },
  });

  const rows: DailySpendRow[] = stored.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    spend: r.spend.toString(),
    currency: r.currency,
    impressions: r.impressions,
    clicks: r.clicks,
    linkClicks: r.linkClicks ?? null,
    metaPurchases: r.metaPurchases ?? null,
    metaPurchaseValue: r.metaPurchaseValue?.toString() ?? null,
  }));

  const summary = summariseSpend(rows);

  const orders = await db.salesOrder.count({
    where: {
      sourceChannel: { in: [...META_ORDER_CHANNELS] },
      createdAt: { gte: range.since, lt: range.until },
    },
  });

  /* An EMPTY window has no currency of its own, so the fallback must be the
   * AD ACCOUNT's currency — never the store's. Falling back to the store's
   * printed "0.00 DZD" for a USD account: a spend figure under the wrong
   * label, which is the one failure this module exists to prevent. Caught on
   * the live screen, not by a test, because no test had an empty window on a
   * foreign-currency account. */
  const currency = summary.currency ?? account.currency;

  const cpo = costPerOrder(summary, orders);
  const derived = derivedAdMetrics(summary);
  const roas = metaReportedRoas(summary);

  /* ME.C — the window's campaigns, aggregated by ID (the identity; the name
   * is whatever the latest row called it) and ranked by spend. Bounded to
   * the top six — a screen list, not an export. Number() here is for the
   * share RATIO only; every displayed figure keeps the exact string. */
  const campaignStored = await db.adSpendCampaignDaily.findMany({
    where: { adAccountId: account.id, date: { gte: range.since, lt: range.until } },
    select: { campaignId: true, campaignName: true, spend: true, clicks: true },
  });
  const byCampaign = new Map<string, { name: string; spend: Money; clicks: number }>();
  for (const row of campaignStored) {
    const entry = byCampaign.get(row.campaignId) ?? { name: row.campaignName, spend: ZERO, clicks: 0 };
    entry.name = row.campaignName;
    entry.spend = add(entry.spend, money(row.spend.toString()));
    entry.clicks += row.clicks;
    byCampaign.set(row.campaignId, entry);
  }
  const ranked = [...byCampaign.values()].sort((a, b) => (a.spend < b.spend ? 1 : a.spend > b.spend ? -1 : 0)).slice(0, 6);
  const maxSpend = ranked[0] ? Number(toString(ranked[0].spend, 2)) : 0;
  const campaigns = ranked.map((c) => ({
    name: c.name,
    spend: toString(c.spend, 2),
    clicks: c.clicks,
    share: maxSpend > 0 ? (Number(toString(c.spend, 2)) / maxSpend) * 100 : 0,
  }));
  /* Fakes in the suite may omit the reach columns entirely; undefined and
   * null both read as "no reach stored". */
  const reachPeople = account.reach ?? null;
  const verdict = crossCurrencyRatio(currency, storeCurrency);

  return {
    state: "ready",
    accountName: account.name,
    adAccountId: account.id,
    accountRef: account.accountId,
    lastSyncedAt: account.lastSyncedAt,
    spend: toString(summary.spend, 2),
    currency,
    days: summary.days,
    impressions: summary.impressions,
    clicks: summary.clicks,
    orders,
    costPerOrder: cpo ? toString(cpo.value, 2) : null,
    ctr: derived.ctr === null ? null : toString(derived.ctr, 2),
    costPerClick: derived.costPerClick === null ? null : toString(derived.costPerClick, 2),
    cpmPerMille: derived.cpmPerMille === null ? null : toString(derived.cpmPerMille, 2),
    linkClicks: summary.linkClicks,
    linkCtr: derived.linkCtr === null ? null : toString(derived.linkCtr, 2),
    costPerLinkClick:
      derived.costPerLinkClick === null ? null : toString(derived.costPerLinkClick, 2),
    metaPurchases: summary.metaPurchases,
    metaRoas: roas === null ? null : toString(roas, 2),
    campaigns,
    reach: reachPeople === null
      ? null
      : {
          people: reachPeople,
          frequency: account.frequency?.toString() ?? "0",
          days: account.reachDays ?? null,
        },
    ratioRefusal: verdict.ok ? null : verdict.reason,
  };
}
