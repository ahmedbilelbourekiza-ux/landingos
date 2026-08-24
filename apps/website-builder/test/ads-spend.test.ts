import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInsightsRequest,
  parseInsightsRows,
  summariseSpend,
  costPerOrder,
  crossCurrencyRatio,
  derivedAdMetrics,
  formatSpend,
  META_GRAPH_VERSION,
  metaReportedRoas,
  buildReachRequest,
  parseReachRow,
  type DailySpendRow,
} from '../src/lib/ads/spend-math.ts';
import { toString } from '../src/lib/money.ts';

/* -----------------------------------------------------------------------------
 * LB.23 — the half that decides what a number MEANS.
 *
 * SEC.6's lesson applied before the fact: there, the arithmetic had tests and
 * the identity did not, so a total bypass passed review. Here the arithmetic
 * is trivial and the MEANING is where the money is — which currency a figure
 * is in, whether a day is real, and whether a ratio may be produced at all.
 * -------------------------------------------------------------------------- */

/* ME.B widened DailySpendRow; legacy literals spread this to stay honest
 * about what those windows never reported. */
const NA = { linkClicks: null, metaPurchases: null, metaPurchaseValue: null } as const;
const cfg = { token: 'T0KEN', accountId: '730934849575452' };
const range = { since: '2026-08-01', until: '2026-08-07' };

describe('buildInsightsRequest — the wire shape', () => {
  test('asks for a DAILY breakdown, not one aggregate', () => {
    const { url } = buildInsightsRequest(cfg, range);
    // Without time_increment=1 Meta returns ONE row for the whole window and
    // the sync would file a week of spend under a single arbitrary date.
    assert.ok(url.includes('time_increment=1'), url);
  });

  test('the token rides in the header, NEVER the query string', () => {
    const wire = buildInsightsRequest(cfg, range);
    assert.equal(wire.headers.Authorization, 'Bearer T0KEN');
    assert.ok(!wire.url.includes('T0KEN'), 'token must not reach a URL — URLs reach logs');
    assert.ok(!wire.url.includes('access_token'), wire.url);
  });

  test('pins the graph version and prefixes the account exactly once', () => {
    const { url } = buildInsightsRequest(cfg, range);
    assert.ok(url.includes(`/${META_GRAPH_VERSION}/`), url);
    assert.ok(url.includes('act_730934849575452'), url);
    assert.ok(!url.includes('act_act_'), url);
  });

  test('an accountId that already carries act_ is REFUSED, not silently fixed', () => {
    // Silently stripping it would let two different stored shapes both "work"
    // and the unique key would stop meaning one account.
    assert.throws(
      () => buildInsightsRequest({ ...cfg, accountId: 'act_123' }, range),
      /without the act_ prefix/,
    );
  });

  test('SEC.9 — a non-numeric accountId is REFUSED where the URL is built', () => {
    /* The id is interpolated into the request PATH. The intake route regexes
     * digits, but this builder also serves the PlatformCredential config, so
     * the refusal must live here too — `123/../x` is a different Graph URL,
     * and a query-metacharacter id could rewrite the request. */
    for (const evil of ['123/../me', '123?fields=adsets', '123#x', '123abc', '١٢٣٤٥']) {
      assert.throws(
        () => buildInsightsRequest({ ...cfg, accountId: evil }, range),
        /digits only/,
        evil,
      );
    }
  });

  test('malformed or inverted date bounds are refused', () => {
    assert.throws(() => buildInsightsRequest(cfg, { since: '01-08-2026', until: '2026-08-07' }), /since/);
    assert.throws(() => buildInsightsRequest(cfg, { since: '2026-08-07', until: '2026-08-01' }), /precedes/);
  });

  test('apiBase redirects the call, so the suite never touches Meta', () => {
    const { url } = buildInsightsRequest({ ...cfg, apiBase: 'http://127.0.0.1:9911/' }, range);
    assert.ok(url.startsWith('http://127.0.0.1:9911/v'), url);
    assert.ok(!url.includes('//v'), 'trailing slash on apiBase must not double up');
  });
});

describe('parseInsightsRows — absent is absent, never zero', () => {
  const payload = {
    data: [
      { date_start: '2026-08-01', spend: '12.34', impressions: '1000', clicks: '42', account_currency: 'USD' },
      { date_start: '2026-08-02', spend: '0', impressions: '5', clicks: '0', account_currency: 'USD' },
    ],
  };

  test('reads real days, including a genuine zero-spend day', () => {
    const rows = parseInsightsRows(payload);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      date: '2026-08-01', spend: '12.34', currency: 'USD', impressions: 1000, clicks: 42,
      linkClicks: null, metaPurchases: null, metaPurchaseValue: null,
    });
    // A reported 0 is a real day and must survive: the account was live and
    // spent nothing. That is different from a day Meta never mentioned.
    assert.equal(rows[1]!.spend, '0');
  });

  test('a row with no spend is SKIPPED, not defaulted to zero', () => {
    // Defaulting would add a free day of advertising to the average and drag
    // every cost-per-order figure down.
    const rows = parseInsightsRows({ data: [{ date_start: '2026-08-03', account_currency: 'USD' }] });
    assert.equal(rows.length, 0);
  });

  test('rows with no date, no currency, or junk spend are skipped', () => {
    const rows = parseInsightsRows({
      data: [
        { spend: '1.00', account_currency: 'USD' },
        { date_start: 'yesterday', spend: '1.00', account_currency: 'USD' },
        { date_start: '2026-08-04', spend: '1.00' },
        { date_start: '2026-08-05', spend: 'free', account_currency: 'USD' },
        { date_start: '2026-08-06', spend: '-5.00', account_currency: 'USD' },
      ],
    });
    assert.deepEqual(rows, []);
  });

  test('a non-list, an error body, or null yields no rows rather than throwing', () => {
    for (const bad of [null, undefined, {}, { data: null }, { error: { message: 'nope' } }]) {
      assert.deepEqual(parseInsightsRows(bad), []);
    }
  });
});

describe('summariseSpend — and the currency it refuses to lose', () => {
  const usd = (date: string, spend: string) => ({ date, spend, currency: 'USD', impressions: 10, clicks: 1, ...NA });

  test('totals exactly, in decimal, with no float drift', () => {
    const s = summariseSpend([usd('2026-08-01', '0.10'), usd('2026-08-02', '0.20')]);
    // 0.1 + 0.2 !== 0.3 in float; the Money bigint makes it exact.
    assert.equal(toString(s.spend, 2), '0.30');
    assert.equal(s.currency, 'USD');
    assert.equal(s.days, 2);
    assert.equal(s.impressions, 20);
    assert.equal(s.clicks, 2);
  });

  test('MIXED currencies throw rather than silently adding', () => {
    // One token here reaches nine accounts. Summing across them must never
    // quietly produce a number.
    assert.throws(
      () => summariseSpend([usd('2026-08-01', '1.00'), { ...usd('2026-08-02', '1.00'), currency: 'EUR' }]),
      /mixed currencies/,
    );
  });

  test('an empty window reports currency null, never a guessed default', () => {
    const s = summariseSpend([]);
    assert.equal(s.currency, null);
    assert.equal(s.days, 0);
    assert.equal(toString(s.spend, 2), '0.00');
  });
});

describe('costPerOrder — answerable, or honestly null', () => {
  const summary = summariseSpend([
    { date: '2026-08-01', spend: '100.00', currency: 'USD', impressions: 0, clicks: 0, ...NA },
  ]);

  test('divides in the SPEND currency and says which one', () => {
    const cpo = costPerOrder(summary, 8)!;
    assert.equal(toString(cpo.value, 2), '12.50');
    assert.equal(cpo.currency, 'USD');
    // The currency travels WITH the number so no renderer can print a USD
    // figure under a DA symbol.
    assert.equal(formatSpend(cpo.value, cpo.currency), '12.50 USD');
  });

  test('zero orders is NOT answerable — null, not infinity and not 0.00', () => {
    assert.equal(costPerOrder(summary, 0), null);
    assert.equal(costPerOrder(summary, -3), null);
    assert.equal(costPerOrder(summary, Number.NaN), null);
  });

  test('an empty spend window is not answerable either', () => {
    assert.equal(costPerOrder(summariseSpend([]), 5), null);
  });
});

describe('crossCurrencyRatio — the refusal, in one place', () => {
  test('USD spend against DA revenue is refused, with a reason naming the rate', () => {
    const verdict = crossCurrencyRatio('USD', 'DZD');
    assert.equal(verdict.ok, false);
    assert.match((verdict as { reason: string }).reason, /no rate is stored here/);
    // The reason must point at the mechanism that DOES own the conversion,
    // so the next reader does not build a second one.
    assert.match((verdict as { reason: string }).reason, /adsUsd x rate/);
  });

  test('same currency on both sides is allowed', () => {
    assert.equal(crossCurrencyRatio('USD', 'USD').ok, true);
  });
});

describe('ME.A — derivedAdMetrics: three ratios from stored sums, or honestly null', () => {
  test('CTR, CPC and CPM from a known window, exact to the cent', () => {
    const summary = summariseSpend([
      { date: '2026-08-01', spend: '12.00', currency: 'USD', impressions: 4000, clicks: 80, ...NA },
    ]);
    const d = derivedAdMetrics(summary);
    assert.equal(toString(d.ctr!, 2), '2.00'); // 80 of 4000
    assert.equal(toString(d.costPerClick!, 2), '0.15'); // 12 / 80
    assert.equal(toString(d.cpmPerMille!, 2), '3.00'); // 12 / 4 thousand
  });

  test('impressions with zero clicks is a REAL 0% CTR — only CPC is unanswerable', () => {
    const summary = summariseSpend([
      { date: '2026-08-01', spend: '5.00', currency: 'USD', impressions: 1000, clicks: 0, ...NA },
    ]);
    const d = derivedAdMetrics(summary);
    assert.equal(toString(d.ctr!, 2), '0.00');
    assert.equal(d.costPerClick, null);
    assert.equal(toString(d.cpmPerMille!, 2), '5.00');
  });

  test('zero impressions answers nothing that divides by them', () => {
    const summary = summariseSpend([
      { date: '2026-08-01', spend: '5.00', currency: 'USD', impressions: 0, clicks: 0, ...NA },
    ]);
    const d = derivedAdMetrics(summary);
    assert.equal(d.ctr, null);
    assert.equal(d.costPerClick, null);
    assert.equal(d.cpmPerMille, null);
  });

  test('an empty window (no currency) derives nothing at all', () => {
    const d = derivedAdMetrics(summariseSpend([]));
    assert.deepEqual(d, { ctr: null, costPerClick: null, cpmPerMille: null, linkCtr: null, costPerLinkClick: null });
  });
});

describe('ME.B — the wire asks for the link and attribution fields', () => {
  test('the daily request names inline_link_clicks, actions and action_values', () => {
    const wire = buildInsightsRequest({ token: 't', accountId: '123' }, { since: '2026-08-01', until: '2026-08-07' });
    for (const f of ['inline_link_clicks', 'actions', 'action_values']) {
      assert.ok(decodeURIComponent(wire.url).includes(f), `${f} must be requested`);
    }
  });

  test('the reach request is UN-incremented — reach cannot be summed from days', () => {
    const wire = buildReachRequest({ token: 't', accountId: '123' }, { since: '2026-08-01', until: '2026-08-07' });
    assert.ok(!wire.url.includes('time_increment'), 'no daily breakdown on the reach call');
    assert.ok(decodeURIComponent(wire.url).includes('reach,frequency'));
    assert.ok(wire.headers.Authorization.startsWith('Bearer '), 'token in the header, never the URL');
    assert.ok(!wire.url.includes('t='), 'token never rides the query string');
    assert.throws(() => buildReachRequest({ token: 't', accountId: '12/../x' }, { since: '2026-08-01', until: '2026-08-02' }));
  });
});

describe('ME.B — parsing: absent is null, never zero; purchase means purchase', () => {
  const base = { date_start: '2026-08-01', spend: '10.00', account_currency: 'USD', impressions: '1000', clicks: '50' };

  test('a row with the new fields carries them; a legacy row answers null', () => {
    const rows = parseInsightsRows({
      data: [
        {
          ...base,
          inline_link_clicks: '40',
          actions: [{ action_type: 'lead', value: '9' }, { action_type: 'purchase', value: '3' }],
          action_values: [{ action_type: 'purchase', value: '45.00' }],
        },
        { ...base, date_start: '2026-08-02' },
      ],
    });
    assert.equal(rows[0].linkClicks, 40);
    assert.equal(rows[0].metaPurchases, 3, 'the lead action must not leak into purchases');
    assert.equal(rows[0].metaPurchaseValue, '45.00');
    assert.equal(rows[1].linkClicks, null, 'a pre-ME.B row was never asked — null, not zero');
    assert.equal(rows[1].metaPurchases, null);
    assert.equal(rows[1].metaPurchaseValue, null);
  });

  test('malformed actions answer null rather than inventing attribution', () => {
    const rows = parseInsightsRows({
      data: [{ ...base, actions: 'junk', action_values: [{ action_type: 'purchase', value: 'NaNish' }] }],
    });
    assert.equal(rows[0].metaPurchases, null);
    assert.equal(rows[0].metaPurchaseValue, null);
  });

  test('the reach row parses, and an empty answer is null', () => {
    assert.deepEqual(parseReachRow({ data: [{ reach: '812', frequency: '1.58' }] }), { reach: 812, frequency: '1.58' });
    assert.equal(parseReachRow({ data: [] }), null);
    assert.equal(parseReachRow(null), null);
    assert.equal(parseReachRow({ data: [{ frequency: '2' }] }), null, 'no reach figure, no row');
  });
});

describe('ME.B — sums, the link pair, and the Meta-reported ROAS', () => {
  const day = (over: Partial<DailySpendRow> = {}): DailySpendRow => ({
    date: '2026-08-01', spend: '10.00', currency: 'USD', impressions: 1000, clicks: 50,
    linkClicks: null, metaPurchases: null, metaPurchaseValue: null, ...over,
  });

  test('a window where nothing reported the field answers null, a partial window sums what was reported', () => {
    const none = summariseSpend([day(), day({ date: '2026-08-02' })]);
    assert.equal(none.linkClicks, null);
    assert.equal(none.metaPurchases, null);
    assert.equal(none.metaPurchaseValue, null);

    const partial = summariseSpend([
      day({ linkClicks: 40, metaPurchases: 2, metaPurchaseValue: '30.00' }),
      day({ date: '2026-08-02' }),
    ]);
    assert.equal(partial.linkClicks, 40);
    assert.equal(partial.metaPurchases, 2);
    assert.equal(toString(partial.metaPurchaseValue!, 2), '30.00');
  });

  test('link CTR and cost per link click, exact; null without link data', () => {
    const s = summariseSpend([day({ spend: '12.00', impressions: 4000, clicks: 80, linkClicks: 60 })]);
    const d = derivedAdMetrics(s);
    assert.equal(toString(d.linkCtr!, 2), '1.50'); // 60 of 4000
    assert.equal(toString(d.costPerLinkClick!, 2), '0.20'); // 12 / 60
    const bare = derivedAdMetrics(summariseSpend([day()]));
    assert.equal(bare.linkCtr, null);
    assert.equal(bare.costPerLinkClick, null);
  });

  test('Meta-reported ROAS divides Meta\'s own converted value by the spend — same currency by construction', () => {
    const s = summariseSpend([day({ spend: '10.00', metaPurchaseValue: '45.00' })]);
    assert.equal(toString(metaReportedRoas(s)!, 2), '4.50');
    assert.equal(metaReportedRoas(summariseSpend([day()])), null, 'no attributed value, no ratio');
    assert.equal(metaReportedRoas(summariseSpend([day({ spend: '0', metaPurchaseValue: '45.00' })])), null, 'zero spend is not infinite return');
    // And the platform's own cross-currency refusal is untouched: DA revenue
    // against USD spend still has no ratio here.
    assert.equal(crossCurrencyRatio('USD', 'DZD').ok, false);
  });
});
