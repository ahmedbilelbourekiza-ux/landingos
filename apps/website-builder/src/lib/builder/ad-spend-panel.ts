import {
  summariseSpend,
  costPerOrder,
  crossCurrencyRatio,
  type DailySpendRow,
} from "../ads/spend-math.ts";
import { toString } from "../money.ts";

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
    }
  | {
      readonly state: "ready";
      readonly accountName: string;
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
      /** Set when spend and revenue currencies differ — the honest refusal. */
      readonly ratioRefusal: string | null;
    };

interface SpendClient {
  adAccount: {
    findFirst(args: unknown): Promise<{
      id: string;
      name: string;
      lastSyncedAt: Date | null;
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
      }[]
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
  range: { readonly days: number; readonly since: Date },
  storeCurrency: string,
): Promise<AdSpendPanel> {
  const account = await db.adAccount.findFirst({
    where: { provider: "meta", isActive: true },
    select: { id: true, name: true, lastSyncedAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (!account) return { state: "unconfigured" };
  if (!account.lastSyncedAt) {
    // Distinct from "synced and found nothing" — one is our job to fix, the
    // other is a true fact about the account.
    return { state: "never-synced", accountName: account.name };
  }

  const stored = await db.adSpendDaily.findMany({
    where: { adAccountId: account.id, date: { gte: range.since } },
    select: { date: true, spend: true, currency: true, impressions: true, clicks: true },
    orderBy: { date: "asc" },
  });

  const rows: DailySpendRow[] = stored.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    spend: r.spend.toString(),
    currency: r.currency,
    impressions: r.impressions,
    clicks: r.clicks,
  }));

  const summary = summariseSpend(rows);

  const orders = await db.salesOrder.count({
    where: {
      sourceChannel: { in: [...META_ORDER_CHANNELS] },
      createdAt: { gte: range.since },
    },
  });

  const cpo = costPerOrder(summary, orders);
  const verdict = summary.currency
    ? crossCurrencyRatio(summary.currency, storeCurrency)
    : { ok: true as const };

  return {
    state: "ready",
    accountName: account.name,
    lastSyncedAt: account.lastSyncedAt,
    spend: toString(summary.spend, 2),
    currency: summary.currency ?? storeCurrency,
    days: summary.days,
    impressions: summary.impressions,
    clicks: summary.clicks,
    orders,
    costPerOrder: cpo ? toString(cpo.value, 2) : null,
    ratioRefusal: verdict.ok ? null : verdict.reason,
  };
}
