import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { adSpendPanel, META_ORDER_CHANNELS } from '../src/lib/builder/ad-spend-panel.ts';

/* -----------------------------------------------------------------------------
 * LB.23 read side — the four states, and why they must stay four.
 *
 * "No account connected", "connected but never synced", "synced and the
 * account spent nothing", and a real figure are FOUR different facts. A screen
 * that renders 0.00 for all of them teaches a merchant to distrust the one
 * number that is real, so each is asserted separately here.
 *
 * The loader takes its database client as an interface precisely so this can
 * run with a stub — no database, no network.
 * -------------------------------------------------------------------------- */

const RANGE = { days: 7, since: new Date('2026-08-14T00:00:00.000Z') };

function client(opts: {
  account?: { id: string; name: string; lastSyncedAt: Date | null } | null;
  spend?: { date: string; spend: string; currency: string; impressions: number; clicks: number }[];
  orders?: number;
}) {
  const captured: { orderWhere?: any } = {};
  return {
    captured,
    db: {
      adAccount: { findFirst: async () => opts.account ?? null },
      adSpendDaily: {
        findMany: async () =>
          (opts.spend ?? []).map((r) => ({
            date: new Date(`${r.date}T00:00:00.000Z`),
            spend: { toString: () => r.spend },
            currency: r.currency,
            impressions: r.impressions,
            clicks: r.clicks,
          })),
      },
      salesOrder: {
        count: async (args: any) => {
          captured.orderWhere = args?.where;
          return opts.orders ?? 0;
        },
      },
    },
  };
}

const day = (date: string, spend: string) => ({
  date, spend, currency: 'USD', impressions: 100, clicks: 5,
});

describe('adSpendPanel — four states, never one zero', () => {
  test('no account connected', async () => {
    const { db } = client({ account: null });
    const panel = await adSpendPanel(db as never, RANGE, 'DZD');
    assert.equal(panel.state, 'unconfigured');
  });

  test('connected but NEVER synced is its own state, not zero spend', async () => {
    // One is our job to fix; the other is a true fact about the account.
    const { db } = client({ account: { id: 'a1', name: 'Atlas Accounts 6', lastSyncedAt: null } });
    const panel = await adSpendPanel(db as never, RANGE, 'DZD');
    assert.equal(panel.state, 'never-synced');
    assert.equal((panel as { accountName: string }).accountName, 'Atlas Accounts 6');
  });

  test('synced with nothing to report is READY with a real zero', async () => {
    const { db } = client({
      account: { id: 'a1', name: 'Atlas Accounts 6', lastSyncedAt: new Date('2026-08-20T09:00:00Z') },
      spend: [],
      orders: 0,
    });
    const panel = await adSpendPanel(db as never, RANGE, 'DZD') as any;
    assert.equal(panel.state, 'ready');
    assert.equal(panel.spend, '0.00');
    assert.equal(panel.days, 0);
    // Unanswerable, not "0.00 per order".
    assert.equal(panel.costPerOrder, null);
  });

  test('a real window reports spend, cost per order, and the SPEND currency', async () => {
    const { db } = client({
      account: { id: 'a1', name: 'Atlas Accounts 6', lastSyncedAt: new Date('2026-08-20T09:00:00Z') },
      spend: [day('2026-08-15', '10.00'), day('2026-08-16', '30.00')],
      orders: 8,
    });
    const panel = await adSpendPanel(db as never, RANGE, 'DZD') as any;
    assert.equal(panel.spend, '40.00');
    assert.equal(panel.currency, 'USD', 'the AD ACCOUNT currency, not the store currency');
    assert.equal(panel.days, 2);
    assert.equal(panel.impressions, 200);
    assert.equal(panel.clicks, 10);
    assert.equal(panel.orders, 8);
    assert.equal(panel.costPerOrder, '5.00');
  });
});

describe('the currency boundary the screen must not cross', () => {
  test('USD spend against a DZD store yields a refusal, never a ratio', async () => {
    const { db } = client({
      account: { id: 'a1', name: 'A6', lastSyncedAt: new Date() },
      spend: [day('2026-08-15', '10.00')],
      orders: 2,
    });
    const panel = await adSpendPanel(db as never, RANGE, 'DZD') as any;
    assert.ok(panel.ratioRefusal, 'a refusal must be present for the screen to show');
    assert.match(panel.ratioRefusal, /no rate is stored here/);
    // And the cost-per-order that IS produced is in USD, not DZD.
    assert.equal(panel.currency, 'USD');
  });

  test('a USD store needs no refusal', async () => {
    const { db } = client({
      account: { id: 'a1', name: 'A6', lastSyncedAt: new Date() },
      spend: [day('2026-08-15', '10.00')],
      orders: 2,
    });
    const panel = await adSpendPanel(db as never, RANGE, 'USD') as any;
    assert.equal(panel.ratioRefusal, null);
  });
});

describe('the order side counts BOTH Meta placements', () => {
  test('facebook AND instagram, because one ad account bills for both', async () => {
    // Counting only `facebook` against an account that also bought Instagram
    // placements overstates cost-per-order on one and invents a free channel
    // on the other.
    assert.deepEqual([...META_ORDER_CHANNELS], ['facebook', 'instagram']);

    const c = client({
      account: { id: 'a1', name: 'A6', lastSyncedAt: new Date() },
      spend: [day('2026-08-15', '10.00')],
      orders: 3,
    });
    await adSpendPanel(c.db as never, RANGE, 'DZD');
    assert.deepEqual(c.captured.orderWhere.sourceChannel, { in: ['facebook', 'instagram'] });
    // And the window must match the spend window, or the ratio compares
    // different periods.
    assert.deepEqual(c.captured.orderWhere.createdAt, { gte: RANGE.since });
  });
});
