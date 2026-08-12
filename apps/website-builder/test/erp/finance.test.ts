import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_COOKIE } from '@landingos/auth';

import {
  skip, BASE, uid, makeErpTenant, cleanup,
  contractTest as test,
} from './helpers.ts';

/* =============================================================================
 * test/erp/finance.test.ts — LP.16, the profit-and-loss department end to end.
 *
 * The finance department is one thing and this file is it: the proration rule,
 * the fixed-cost list, saved records and their versions, the roll-up, the
 * history export, and the calculator screen that consumes all of them. It is
 * split out of `catalog`/`screens` because LEGACY_PARITY §7 measured the
 * legacy calculator as a DEPARTMENT — 1,244 lines with seven gaps — and a
 * department's contract belongs in one place.
 *
 * THE THREE DEFECTS THIS SUITE EXISTS TO PIN DOWN, all of which shipped:
 *
 *  1. `fixedCosts` was declared, validated, summed by `prorate-fixed` — and
 *     WRITTEN BY NOTHING. The automation screen excludes array settings by
 *     type (the right rule) and no other screen offered an editor, so the
 *     prorated figure was always `0` for every tenant, and every saved P&L was
 *     missing its rent and salaries. Not absent: zero, which reads as "there
 *     are none".
 *
 *  2. `periodType` was accepted and ECHOED BACK WITHOUT BEING USED. Every
 *     window got the day-count rule, so a week charged 7/30.44 of a month
 *     instead of a quarter — and four saved weeks summed to 92% of the month
 *     `aggregate` builds out of them. The tiling test below is the one that
 *     matters; it fails against the pre-LP.16b build.
 *
 *  3. THE SAVED RECORD DISAGREED WITH THE SCREEN THAT PRODUCED IT. The legacy
 *     calculator subtracts incidents (returns + exchanges + losses) from every
 *     product's profit, shows the result — and does not send it, because
 *     `FinancialRecord` has no incidents column. The stored `netProfit` came
 *     out higher than the banner by exactly the incident total. D-LP.16.1
 *     folds incidents into `productCosts`; `calc-save` asserts the two agree.
 * ========================================================================== */

let acme: Awaited<ReturnType<typeof makeErpTenant>>;

/** A window that no other test's records fall into, so sums are deterministic. */
const YEAR = 2031;
const monthStart = (m: number) => new Date(YEAR, m, 1).getTime();
const monthEnd = (m: number) => new Date(YEAR, m + 1, 1).getTime() - 1;

before(async () => {
  if (skip) return;
  acme = await makeErpTenant('finance');

  // A catalogue, so the calculator opens on a real product block rather than
  // the empty-catalogue case — which is tested separately at the end.
  await acme.manager.api('POST', '/api/erp/products', {
    name: `Calc Widget ${uid()}`, price: 5000, costPrice: 1800, packagingCost: 120,
  });
});

after(async () => {
  if (skip) return;
  await cleanup();
});

const page = (path: string, token?: string, locale = 'en') =>
  fetch(BASE + path, {
    redirect: 'manual',
    headers: {
      cookie: [token ? `${SESSION_COOKIE}=${token}` : '', `locale=${locale}`]
        .filter(Boolean).join('; '),
    },
  });

const html = async (path: string, token?: string) => {
  const res = await page(path, token);
  return { status: res.status, body: await res.text() };
};

const prorate = async (periodType: string, startDate: number, endDate: number) =>
  (await acme.manager.api(
    'GET',
    `/api/erp/financial-records/prorate-fixed?periodType=${periodType}&startDate=${startDate}&endDate=${endDate}`,
  )).body.data;

/* -----------------------------------------------------------------------------
 * P3 — the fixed-cost list, which nothing could write
 * -------------------------------------------------------------------------- */

describe('fixed costs can finally be entered', () => {
  test('a tenant starts with none, and the prorated figure says zero rather than nothing', async () => {
    const d = await prorate('month', monthStart(0), monthEnd(0));
    assert.equal(String(d.monthlyTotal), '0');
    assert.equal(Number(d.prorated), 0, 'this is the state EVERY tenant was in');
  });

  test('the settings route stores a list of them', async () => {
    const r = await acme.manager.api('PUT', '/api/erp/settings', {
      fixedCosts: [
        { id: 'rent', label: 'Rent', amount: '80000' },
        { id: 'salaries', label: 'Salaries', amount: '40000' },
      ],
    });
    assert.equal(r.status, 200);

    const stored = (await acme.manager.api('GET', '/api/erp/settings')).body.data;
    assert.equal(stored.fixedCosts.length, 2);

    const d = await prorate('month', monthStart(0), monthEnd(0));
    assert.equal(Number(d.monthlyTotal), 120000, 'the sum the whole department depends on');
  });

  test('a malformed amount is skipped rather than making the total unreadable', async () => {
    // Rows written through the API before the editor existed are reachable, and
    // one bad amount must not make a company's rent read as an error.
    await acme.manager.api('PUT', '/api/erp/settings', {
      fixedCosts: [
        { id: 'rent', label: 'Rent', amount: '80000' },
        { id: 'typo', label: 'Typo', amount: '12OO' },
        { id: 'salaries', label: 'Salaries', amount: '40000' },
      ],
    });
    const d = await prorate('month', monthStart(0), monthEnd(0));
    assert.equal(Number(d.monthlyTotal), 120000);

    // Restore the clean list for the arithmetic below.
    await acme.manager.api('PUT', '/api/erp/settings', {
      fixedCosts: [
        { id: 'rent', label: 'Rent', amount: '80000' },
        { id: 'salaries', label: 'Salaries', amount: '40000' },
      ],
    });
  });

  test('a non-array is refused, so the setting cannot become a scratchpad', async () => {
    const r = await acme.manager.api('PUT', '/api/erp/settings', { fixedCosts: { rent: 1 } });
    assert.equal(r.status, 422);
  });
});

/* -----------------------------------------------------------------------------
 * P4 — proration, and the tiling property that is the whole reason for ÷4
 * -------------------------------------------------------------------------- */

describe('a monthly figure is scaled by the period, not by the day count', () => {
  test('a month is the amount, unchanged', async () => {
    const d = await prorate('month', monthStart(1), monthEnd(1));
    assert.equal(Number(d.prorated), 120000);
  });

  test('a week is a QUARTER of it — not 7/30.44', async () => {
    const d = await prorate('week', monthStart(1), monthStart(1) + 7 * 86_400_000 - 1);
    assert.equal(Number(d.prorated), 30000, '120000 / 4');
    // The number the pre-LP.16b route returned, stated so the difference is
    // visible rather than merely asserted away.
    assert.notEqual(Math.round(Number(d.prorated)), Math.round(120000 / 30.44 * 7));
  });

  test('FOUR WEEKS TILE INTO EXACTLY ONE MONTH — the reason the rule exists', async () => {
    // `aggregate` builds a month by SUMMING four saved weekly records rather
    // than recomputing one. Day-counting the weeks gives 0.92 × month: an 8%
    // under-charge of fixed costs on every aggregated month, compounding to a
    // full month's rent missing per year, and invisible because every
    // individual number looks plausible.
    const week = Number((await prorate('week', monthStart(2), monthStart(2) + 7 * 86_400_000 - 1)).prorated);
    const month = Number((await prorate('month', monthStart(2), monthEnd(2))).prorated);
    assert.equal(week * 4, month);
  });

  test('a quarter is ×3 and a year is ×12', async () => {
    assert.equal(Number((await prorate('quarter', monthStart(0), monthEnd(2))).prorated), 360000);
    assert.equal(Number((await prorate('year', monthStart(0), monthEnd(11))).prorated), 1440000);
  });

  test('a day is divided by the real length of ITS month', async () => {
    // February, deliberately: a day in a 28-day month is a bigger share of the
    // rent than a day in a 31-day one, and an average would hide that.
    const feb = await prorate('day', new Date(YEAR, 1, 10).getTime(), new Date(YEAR, 1, 10).getTime() + 86_399_999);
    const jan = await prorate('day', new Date(YEAR, 0, 10).getTime(), new Date(YEAR, 0, 10).getTime() + 86_399_999);
    assert.equal(Math.round(Number(feb.prorated)), Math.round(120000 / 28));
    assert.equal(Math.round(Number(jan.prorated)), Math.round(120000 / 31));
    assert.ok(Number(feb.prorated) > Number(jan.prorated));
  });

  test('an unaligned window still gets the day count, which is the right answer for it', async () => {
    const start = new Date(YEAR, 3, 3).getTime();
    const end = new Date(YEAR, 3, 19).getTime();
    const d = await prorate('custom', start, end);
    assert.equal(Math.round(Number(d.prorated)), Math.round(120000 / 30.44 * 16));
  });

  test('the caller’s own parameter names are read — startDate/endDate, not only since/until', async () => {
    // The calculator sends `startDate`/`endDate`. The route read `since`/`until`
    // and DEFAULTED TO THE LAST 30 DAYS when they were absent, so it answered
    // confidently about a window nobody asked about.
    const d = await prorate('custom', new Date(YEAR, 5, 1).getTime(), new Date(YEAR, 5, 11).getTime());
    assert.equal(d.startDate, new Date(YEAR, 5, 1).getTime());
    assert.equal(d.endDate, new Date(YEAR, 5, 11).getTime());
  });

  test('the same rule scales a salary, so a rent and a wage cannot disagree', async () => {
    await acme.manager.api('PATCH', `/api/erp/agents/${acme.agent.userId}`, {
      baseSalaryMonthly: 60000, payPerConfirmedOrder: 0, payPerDeliveredOrder: 0,
    });
    const week = await acme.manager.api(
      'GET',
      `/api/erp/agents/${acme.agent.userId}/payroll?since=${monthStart(1)}&until=${monthStart(1) + 7 * 86_400_000 - 1}&periodType=week`,
    );
    assert.equal(Number(week.body.data.salaryPay), 15000, '60000 / 4');
    assert.equal(week.body.data.periodType, 'week');

    // And with no periodType it stays the day-count answer it always gave.
    const custom = await acme.manager.api(
      'GET',
      `/api/erp/agents/${acme.agent.userId}/payroll?since=${monthStart(1)}&until=${monthStart(1) + 7 * 86_400_000 - 1}`,
    );
    assert.notEqual(Number(custom.body.data.salaryPay), 15000);
  });
});

/* -----------------------------------------------------------------------------
 * P5 — every version of one period
 * -------------------------------------------------------------------------- */

describe('a correction never overwrites what was said before', () => {
  const start = monthStart(6);
  const end = monthEnd(6);

  test('saving the same period twice keeps both, newest first', async () => {
    const save = (revenue: number, notes: string) =>
      acme.manager.api('POST', '/api/erp/financial-records', {
        periodType: 'month', startDate: start, endDate: end,
        revenue, productCosts: 100, notes,
      });

    assert.equal((await save(1000, 'first pass')).status, 201);
    assert.equal((await save(900, 'a parcel came back')).status, 201);

    const r = await acme.manager.api(
      'GET',
      `/api/erp/financial-records/versions?periodType=month&startDate=${start}&endDate=${end}`,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data.items.length, 2);
    assert.equal(String(r.body.data.items[0].revenue), '900', 'newest first');
    assert.equal(r.body.data.items[0].notes, 'a parcel came back');
    assert.equal(String(r.body.data.items[1].revenue), '1000', 'and the original survives');
  });

  test('the window is required — a version list of "whatever" is not a version list', async () => {
    const r = await acme.manager.api('GET', '/api/erp/financial-records/versions?periodType=month');
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
  });

  test('an agent cannot read them — the books are SENSITIVE (D-05.1)', async () => {
    const r = await acme.agent.api(
      'GET',
      `/api/erp/financial-records/versions?periodType=month&startDate=${start}&endDate=${end}`,
    );
    assert.equal(r.status, 403);
  });
});

/* -----------------------------------------------------------------------------
 * P6 — the roll-up the requirement asks for by name
 * -------------------------------------------------------------------------- */

describe('a month is built out of the weeks somebody already stated', () => {
  // A month in a year no other test writes into, so the sums are exact.
  const mStart = new Date(YEAR, 8, 1).getTime();
  const mEnd = new Date(YEAR, 9, 1).getTime() - 1;
  const weekStart = (i: number) => mStart + i * 7 * 86_400_000;

  const aggregate = async (periodType: string, startDate: number, endDate: number) =>
    (await acme.manager.api(
      'GET',
      `/api/erp/financial-records/aggregate?periodType=${periodType}&startDate=${startDate}&endDate=${endDate}`,
    )).body.data;

  test('with nothing saved it says which sub-period is missing, not zero', async () => {
    const d = await aggregate('month', mStart, mEnd);
    assert.equal(d.covered, false);
    assert.equal(d.reason, 'no_saved_sub_records');
    assert.equal(d.subPeriodType, 'week', 'and names what it was looking for');
  });

  test('nothing is smaller than a week, and that is said by name', async () => {
    const d = await aggregate('week', weekStart(0), weekStart(1) - 1);
    assert.equal(d.covered, false);
    assert.equal(d.reason, 'no_smaller_unit');
    // "There is nothing smaller to add up" is a different fact from "the weeks
    // made no money", and a caller told the second goes looking for orders.
    assert.notEqual(d.reason, 'no_saved_sub_records');
  });

  test('four saved weeks roll up into the month, and the arithmetic is the server’s', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await acme.manager.api('POST', '/api/erp/financial-records', {
        periodType: 'week',
        startDate: weekStart(i),
        endDate: weekStart(i + 1) - 1,
        revenue: 10000, productCosts: 3000, shippingCosts: 500,
        advertisingCosts: 1000, fixedExpenses: 30000, unexpectedExpenses: 0,
      });
      assert.equal(r.status, 201);
    }

    const d = await aggregate('month', mStart, mEnd);
    assert.equal(d.covered, true);
    assert.equal(d.subRecordsUsed, 4);
    assert.equal(d.subPeriodType, 'week');
    assert.equal(Number(d.revenue), 40000);
    assert.equal(Number(d.productCosts), 12000);
    // THE TILING, end to end: four weekly fixed-cost shares are exactly one
    // month's, because the week rule is ÷4. Under the day-count rule this is
    // 110,760 and a month's rent is quietly 8% short.
    assert.equal(Number(d.fixedExpenses), 120000);
    assert.equal(Number(d.netProfit), 40000 - 12000 - 2000 - 4000 - 120000);
    assert.equal(d.covers.length, 4, 'and it names which weeks went in');
  });

  test('re-saving a corrected week does not charge that week twice', async () => {
    // Records are insert-only, so a correction leaves TWO rows for one week.
    // Summing both is the defect; only the newest save of each distinct period
    // counts, which is also the only reading consistent with "the current
    // record is whichever row is newest".
    const before = await aggregate('month', mStart, mEnd);
    assert.equal(before.subRecordsUsed, 4);

    const r = await acme.manager.api('POST', '/api/erp/financial-records', {
      periodType: 'week',
      startDate: weekStart(0),
      endDate: weekStart(1) - 1,
      revenue: 8000, productCosts: 3000, shippingCosts: 500,
      advertisingCosts: 1000, fixedExpenses: 30000, unexpectedExpenses: 0,
    });
    assert.equal(r.status, 201);

    const after = await aggregate('month', mStart, mEnd);
    assert.equal(after.subRecordsUsed, 4, 'still four weeks, not five');
    assert.equal(Number(after.revenue), 38000, 'and the corrected figure replaced the original');
  });

  test('a roll-up is computed, never saved — a GET does not write the books', async () => {
    const listed = await acme.manager.api(
      'GET', '/api/erp/financial-records?periodType=month&pageSize=100',
    );
    const rolled = (listed.body.data.items as { startDate: string; source: string }[])
      .filter((rec) => new Date(rec.startDate).getTime() === mStart);
    assert.equal(rolled.length, 0, 'aggregating did not persist anything');
  });

  test('and saving it back is an explicit act, marked as rolled up', async () => {
    const d = await aggregate('month', mStart, mEnd);
    const saved = await acme.manager.api('POST', '/api/erp/financial-records', {
      periodType: 'month', startDate: mStart, endDate: mEnd,
      revenue: d.revenue, productCosts: d.productCosts, shippingCosts: d.shippingCosts,
      advertisingCosts: d.advertisingCosts, fixedExpenses: d.fixedExpenses,
      unexpectedExpenses: d.unexpectedExpenses,
      source: 'aggregated', notes: 'rolled up from 4 weeks',
    });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.data.source, 'aggregated');
    // Derived by the route, not taken from the roll-up — so the two agree
    // because they compute the same way, not because one trusted the other.
    assert.equal(String(saved.body.data.netProfit), String(d.netProfit));
  });
});

/* -----------------------------------------------------------------------------
 * The per-product snapshot, and the history as a file
 * -------------------------------------------------------------------------- */

describe('a saved record carries what each product contributed', () => {
  test('productBreakdown is stored as strings, so no figure becomes a float', async () => {
    const start = monthStart(10);
    const r = await acme.manager.api('POST', '/api/erp/financial-records', {
      periodType: 'month', startDate: start, endDate: monthEnd(10),
      revenue: 5000, productCosts: 1000,
      productBreakdown: [
        { name: 'Widget', profit: '3999.99', revenue: '5000' },
        { name: 'Gadget', profit: 1, revenue: 0 },
      ],
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.productBreakdown.length, 2);
    assert.equal(r.body.data.productBreakdown[0].profit, '3999.99', 'digit for digit');
    assert.equal(r.body.data.productBreakdown[1].profit, '1');
  });
});

describe('the saved history leaves the building', () => {
  test('as CSV, with the legacy’s thirteen columns and a BOM', async () => {
    const res = await fetch(`${BASE}/api/erp/financial-records/export?periodType=month`, {
      headers: { cookie: `${SESSION_COOKIE}=${acme.manager.token}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', /Historique_Financier_month/);

    // BYTES, not text: `Response.text()` strips a leading BOM by specification,
    // so the obvious assertion cannot fail — the same trap LP.6 documented.
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'without it Excel mojibakes');

    const body = new TextDecoder().decode(bytes);
    const header = body.replace(/^﻿/, '').split('\r\n')[0];
    assert.equal(header.split(',').length, 13);
    assert.match(header, /^Début période,Fin période,Type,Revenu/);
    assert.ok(Number(res.headers.get('x-export-rows')) > 0);
  });

  test('an agent cannot download the company’s P&L', async () => {
    const res = await fetch(`${BASE}/api/erp/financial-records/export`, {
      headers: { cookie: `${SESSION_COOKIE}=${acme.agent.token}` },
    });
    assert.equal(res.status, 403);
  });
});

/* -----------------------------------------------------------------------------
 * The screens
 * -------------------------------------------------------------------------- */

describe('the calculator is a screen, and it is gated like the books', () => {
  test('a manager gets it', async () => {
    const r = await html('/console/erp/calculator', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-calculator"/);
  });

  test('an agent gets a 404, not a redirect and not a partial page', async () => {
    // The legacy served this as a standalone HTML file with NO authorization on
    // the page at all — the whole company's margins behind a URL.
    const r = await html('/console/erp/calculator', acme.agent.token);
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.body, /erp-calculator/);
  });

  test('it offers the aligned period presets, in the URL', async () => {
    const r = await html('/console/erp/calculator', acme.manager.token);
    for (const p of ['day', 'week', 'month', 'quarter', 'year']) {
      assert.match(r.body, new RegExp(`data-period="${p}"`), `no ${p} preset`);
    }
    // A period is a link, so a calculation is shareable and survives a refresh.
    assert.match(r.body, /href="\/console\/erp\/calculator\?periodType=month"/);
  });

  test('the six KPIs are all rendered, including the one that ends a product line', async () => {
    const r = await html('/console/erp/calculator', acme.manager.token);
    const kpis = [...r.body.matchAll(/data-testid="calc-kpi"/g)];
    assert.ok(kpis.length >= 6, `expected six KPIs per product, found ${kpis.length}`);
    // Break-even is the one a manager acts on: "how many more before this stops
    // losing money", and "never" when the unit does not cover itself.
    assert.match(r.body, /Break-even/);
  });

  test('the exchange list is a LIST, because each exchange costs what it costs', async () => {
    const r = await html('/console/erp/calculator', acme.manager.token);
    assert.match(r.body, /data-testid="calc-exchanges"/);
    assert.match(r.body, /data-testid="calc-add-exchange"/);
  });

  test('and it says that incidents are saved inside product costs', async () => {
    // D-LP.16.1, stated on the page: the legacy dropped incidents from the POST
    // and its stored net profit came out higher than the banner it was read off.
    const r = await html('/console/erp/calculator', acme.manager.token);
    assert.match(r.body, /data-testid="calc-save"/);
    assert.match(r.body, /product costs/i);
  });

  test('a custom range is warned about rather than refused', async () => {
    const r = await html('/console/erp/calculator?periodType=custom', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="calc-custom-warning"/);
  });

  test('the roll-up control is offered only where something smaller exists', async () => {
    // The whole `<button …>` tag, because React emits `disabled` BEFORE the
    // spread `data-testid` and a one-sided regex would pass for the wrong
    // reason in one direction and fail for the wrong reason in the other.
    const tagOf = (body: string) =>
      body.match(/<button[^>]*data-testid="calc-aggregate-run"[^>]*>/)?.[0] ?? '';

    // The ATTRIBUTE, not the substring: the button's class list contains
    // `disabled:opacity-50`, so a bare /disabled/ passes on an enabled button.
    const DISABLED = /\sdisabled(=|>|\s)/;

    const month = await html('/console/erp/calculator?periodType=month', acme.manager.token);
    const monthTag = tagOf(month.body);
    assert.ok(monthTag, 'the roll-up control must exist on a month');
    assert.doesNotMatch(monthTag, DISABLED);

    const week = await html('/console/erp/calculator?periodType=week', acme.manager.token);
    const weekTag = tagOf(week.body);
    assert.ok(weekTag, 'and must still be rendered on a week, not hidden');
    assert.match(weekTag, DISABLED, 'nothing is smaller than a week');
  });
});

describe('the two structured settings finally have controls', () => {
  test('the automation screen offers a fixed-cost list and a channel-carrier map', async () => {
    const r = await html('/console/erp/automation', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-fixed-costs"/);
    assert.match(r.body, /data-testid="erp-channel-carriers"/);
  });

  test('it still excludes them from the plain form, by TYPE', async () => {
    // The filter that hid them is the RIGHT rule and was chosen deliberately, so
    // a structured setting added later cannot render as a checkbox. The fix was
    // the missing editors, not a change to the filter — and this asserts the
    // filter survived the fix.
    const r = await html('/console/erp/automation', acme.manager.token);
    assert.doesNotMatch(r.body, /data-setting="fixedCosts"/);
    assert.doesNotMatch(r.body, /data-setting="defaultCarrierByChannel"/);
  });

  test('the stored rows are rendered, so a saved cost is visible next time', async () => {
    const r = await html('/console/erp/automation', acme.manager.token);
    assert.match(r.body, /data-testid="fixed-cost-label"/);
    assert.match(r.body, /value="Rent"/);
  });

  test('the calculator carries the same editor, where its effect is visible', async () => {
    const r = await html('/console/erp/calculator', acme.manager.token);
    assert.match(r.body, /data-testid="erp-fixed-costs"/);
  });
});

describe('the finance screen still works, and links nothing it cannot serve', () => {
  test('it renders for a manager', async () => {
    const r = await html('/console/erp/finance', acme.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="erp-finance-table"/);
  });

  test('a fresh tenant’s calculator does not crash on an empty catalogue', async () => {
    // The state a company is in on day one, and the one most likely to throw:
    // no products, no charges, no records, and a fixed-cost list that is `[]`.
    const empty = await makeErpTenant(`finance-empty-${uid()}`);
    const r = await html('/console/erp/calculator', empty.manager.token);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-testid="calc-grand"/);
  });
});

/* =============================================================================
 * LB.18 — the finance module can be switched off, and switching it off is not
 * a matter of hiding a link.
 *
 * A merchant who does not run books asked to remove the module. Three things
 * have to be true for "removed" to mean anything, and only the first is
 * visible: the nav loses Finance AND the Calculator, the screens 404 when the
 * URL is typed, and the ROUTES refuse. Without the third, a module the company
 * switched off still accepts writes from anything holding a session.
 *
 * The fourth assertion is the one that makes the switch safe to use: nothing is
 * deleted. `FinancialRecord` is append-only by design — "a saved P&L is a
 * statement somebody made" — so a control that erased it would be the only
 * irreversible action on this platform. Turning it back on must return the
 * history intact.
 * ========================================================================== */
describe('the finance module can be switched off (LB.18)', () => {
  let off: Awaited<ReturnType<typeof makeErpTenant>>;

  before(async () => {
    if (skip) return;
    off = await makeErpTenant(`finance-off-${uid()}`);
    // A record to switch off AROUND, so the reversibility claim is about real
    // data rather than an empty table.
    await off.manager.api('POST', '/api/erp/financial-records', {
      periodType: 'month',
      startDate: monthStart(0),
      endDate: monthEnd(0),
      revenue: '1000',
    });
  });

  test('it is on by default, so no existing tenant is affected', async () => {
    const r = await off.manager.api('GET', '/api/erp/settings');
    assert.equal(r.body.data.financeEnabled, true);
  });

  test('switching it off removes both nav items, and only those', async () => {
    await off.manager.api('PUT', '/api/erp/settings', { financeEnabled: false });
    const r = await html('/console/erp/orders', off.manager.token);
    assert.equal(r.status, 200);
    assert.ok(!r.body.includes('/console/erp/finance"'), 'finance is still in the nav');
    assert.ok(!r.body.includes('/console/erp/calculator"'), 'calculator is still in the nav');
    // The neighbour in the same group stays, so this is a module and not a group.
    assert.ok(r.body.includes('/console/erp/analytics"'), 'analytics went with them');
  });

  test('and the screens 404 when the URL is typed', async () => {
    for (const path of ['/console/erp/finance', '/console/erp/calculator']) {
      const r = await html(path, off.manager.token);
      assert.equal(r.status, 404, `${path} still rendered`);
    }
  });

  test('and every finance route refuses, reads and writes alike', async () => {
    const reads = [
      '/api/erp/financial-records',
      '/api/erp/financial-records/versions',
      '/api/erp/financial-records/aggregate',
      '/api/erp/unexpected-charges',
    ];
    for (const path of reads) {
      const r = await off.manager.api('GET', path);
      assert.equal(r.status, 404, `${path} still answered`);
      assert.equal(r.body.error?.code, 'FINANCE_DISABLED');
    }
    // The write matters most: hiding a link stops nobody from posting.
    const w = await off.manager.api('POST', '/api/erp/unexpected-charges', {
      label: 'Van repair', amount: '4000', date: new Date().toISOString(),
    });
    assert.equal(w.status, 404);
    assert.equal(w.body.error?.code, 'FINANCE_DISABLED');
  });

  test('a NON-finance route is untouched, so the switch is not a blanket', async () => {
    const r = await off.manager.api('GET', '/api/erp/orders');
    assert.equal(r.status, 200);
  });

  test('switching it back on returns the module AND its history', async () => {
    await off.manager.api('PUT', '/api/erp/settings', { financeEnabled: true });

    const screen = await html('/console/erp/finance', off.manager.token);
    assert.equal(screen.status, 200);

    const r = await off.manager.api('GET', '/api/erp/financial-records');
    assert.equal(r.status, 200);
    // The record saved before the module was switched off is still there.
    assert.ok(
      r.body.data.items.length >= 1,
      'the saved P&L did not survive being switched off',
    );
  });
});
