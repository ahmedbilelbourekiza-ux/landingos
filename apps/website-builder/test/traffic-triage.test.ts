import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFunnel,
  deriveAlerts,
  insightSeverity,
  pageHealth,
  rankInsights,
  rate,
  FORM_REACH_DANGER,
  TRIAGE_MIN_VIEWS,
} from '../src/lib/builder/traffic-triage.ts';

/* -----------------------------------------------------------------------------
 * TR.1 — the Traffic screen's judgement layer.
 *
 * The screen now says "this page is failing" in a colour, which is a much
 * stronger claim than printing a number was. These tests exist because a
 * WRONG verdict is worse than no verdict: a red badge on a healthy page sends
 * a merchant to rewrite a page that was selling, and a green one on a dead
 * page costs them the ad budget they were about to spend on it.
 *
 * The recurring theme below is the same one the schema keeps: NULL IS NOT
 * ZERO. A page with behaviour tracking off has measured = 0, and every rate
 * over it must refuse rather than answer 0%.
 * -------------------------------------------------------------------------- */

describe('rate', () => {
  test('refuses a zero denominator rather than answering zero', () => {
    assert.equal(rate(0, 0), null);
    assert.equal(rate(5, 0), null);
    assert.equal(rate(1, -3), null);
  });

  test('answers a real proportion', () => {
    assert.equal(rate(34, 260), 34 / 260);
    assert.equal(rate(0, 260), 0);
  });
});

describe('buildFunnel', () => {
  const base = { views: 266, orders: 0, draftsStarted: 1, draftsWithPhone: 1 };

  test('omits the behaviour step entirely when nothing was measured', () => {
    const steps = buildFunnel({ ...base, behavior: null });
    assert.deepEqual(
      steps.map((s) => s.key),
      ['viewed', 'drafts', 'phone', 'ordered'],
      'a zero-height "saw the form" bar would read as "nobody did"',
    );
  });

  test('measures the form step against MEASURED views, not all views', () => {
    const steps = buildFunnel({ ...base, behavior: { measured: 260, sawForm: 34 } });
    const sawForm = steps.find((s) => s.key === 'sawForm')!;
    assert.equal(sawForm.rateBase, 'measured');
    assert.equal(sawForm.rate, 34 / 260);
    // The bar is still scaled to views so the five bars stay comparable.
    assert.equal(Math.round(sawForm.barShare), Math.round((34 / 266) * 100));
  });

  test('the real campaign shape: the cliff is where the rate is worst', () => {
    // 26-27 Aug 2026, page robeelegante, as recorded.
    const steps = buildFunnel({
      views: 266,
      orders: 0,
      draftsStarted: 1,
      draftsWithPhone: 1,
      behavior: { measured: 260, sawForm: 34 },
    });
    const cliff = steps.find((s) => s.isCliff);
    // sawForm keeps 34/260 = 13%; drafts keeps 1/34 = 3%; phone 1/1 = 100%;
    // ordered keeps 0/1 = 0%. Ordered is worst.
    assert.equal(cliff?.key, 'ordered');
    assert.equal(steps.filter((s) => s.isCliff).length, 1, 'exactly one cliff');
  });

  test('the top of the funnel is never coloured — it has nothing to be a share of', () => {
    const steps = buildFunnel({ ...base, behavior: null });
    const viewed = steps[0]!;
    assert.equal(viewed.rate, null);
    assert.equal(viewed.rateBase, null);
    assert.equal(viewed.tone, 'neutral');
    assert.equal(viewed.isCliff, false);
  });

  /* TR.2 — each step is a share of the stage BEFORE it. */
  test('each step divides by the previous stage, and the label knows which', () => {
    const steps = buildFunnel({
      views: 266, orders: 0, draftsStarted: 1, draftsWithPhone: 1,
      behavior: { measured: 260, sawForm: 34 },
    });
    const by = Object.fromEntries(steps.map((s) => [s.key, s]));
    assert.equal(by.sawForm!.rateBase, 'measured');
    assert.equal(by.sawForm!.rateBaseCount, 260);
    assert.equal(by.drafts!.rateBase, 'sawForm');
    assert.equal(by.drafts!.rateBaseCount, 34);
    assert.equal(by.phone!.rateBase, 'drafts');
    assert.equal(by.phone!.rate, 1, '1 of 1 started left a phone');
    assert.equal(by.ordered!.rateBase, 'phone');
    assert.equal(by.ordered!.rate, 0);
  });

  test('an empty previous stage falls back to the nearest non-empty one', () => {
    // 266 views, nobody typed, nobody ordered: "ordered" must be judged
    // against the 266 who arrived, not left grey because nobody started.
    const steps = buildFunnel({ views: 266, orders: 0, draftsStarted: 0, draftsWithPhone: 0, behavior: null });
    const ordered = steps.find((s) => s.key === 'ordered')!;
    assert.equal(ordered.rateBase, 'viewed');
    assert.equal(ordered.rateBaseCount, 266);
    assert.equal(ordered.rate, 0);
    assert.equal(ordered.tone, 'danger');
  });

  test('the fast-typist case: orders can exceed the drafts before them', () => {
    // A submit faster than the 2s draft debounce has no draft behind it.
    const steps = buildFunnel({ views: 100, orders: 3, draftsStarted: 1, draftsWithPhone: 1, behavior: null });
    const ordered = steps.find((s) => s.key === 'ordered')!;
    assert.equal(ordered.rateBase, 'phone');
    assert.equal(ordered.rate, 3, 'raw, so a renderer can clamp and the data stays honest');
    assert.equal(ordered.tone, 'success');
  });

  test('four tiers: a fifth is red, half is orange, four fifths is blue, more is green', () => {
    const at = (orders: number) =>
      buildFunnel({ views: 100, orders, draftsStarted: 0, draftsWithPhone: 0, behavior: null })
        .find((s) => s.key === 'ordered')!.tone;
    assert.equal(at(10), 'danger');
    assert.equal(at(30), 'warning');
    assert.equal(at(60), 'info');
    assert.equal(at(90), 'success');
  });

  test('a page with no views at all does not divide by zero', () => {
    const steps = buildFunnel({
      views: 0,
      orders: 0,
      draftsStarted: 0,
      draftsWithPhone: 0,
      behavior: null,
    });
    assert.equal(steps.every((s) => Number.isFinite(s.barShare)), true);
    assert.equal(steps.find((s) => s.key === 'drafts')!.rate, null);
  });
});

describe('pageHealth', () => {
  const quiet = { orders: 0, draftsStarted: 0, draftsWithPhone: 0, behavior: null, conversion: null };

  test('a page nobody visited is untested, not failing', () => {
    const v = pageHealth({ ...quiet, views: TRIAGE_MIN_VIEWS - 1 });
    assert.equal(v.health, 'untested');
    assert.equal(v.tone, 'neutral', 'grey, never red — it is not a problem, it is a blank');
  });

  test('selling when orders convert above one percent', () => {
    const v = pageHealth({ ...quiet, views: 400, orders: 8, conversion: 2 });
    assert.equal(v.health, 'selling');
    assert.equal(v.tone, 'success');
  });

  test('orders that barely convert read as thin, not as success', () => {
    const v = pageHealth({ ...quiet, views: 1000, orders: 2, conversion: 0.2 });
    assert.equal(v.health, 'thin');
    assert.equal(v.tone, 'info');
  });

  test('unreached beats stalling: they never got to the form', () => {
    const v = pageHealth({
      views: 266,
      orders: 0,
      draftsStarted: 1,
      draftsWithPhone: 1,
      behavior: { measured: 260, sawForm: 34 },
      conversion: 0,
    });
    assert.equal(v.health, 'unreached', 'the more specific diagnosis wins');
    assert.equal(v.tone, 'danger');
  });

  test('stalling when people start the form and stop', () => {
    const v = pageHealth({
      views: 300,
      orders: 0,
      draftsStarted: 9,
      draftsWithPhone: 4,
      behavior: { measured: 280, sawForm: 200 },
      conversion: 0,
    });
    assert.equal(v.health, 'stalling');
    assert.equal(v.tone, 'warning');
  });

  test('tracking off cannot produce the unreached verdict', () => {
    const v = pageHealth({ ...quiet, views: 300, conversion: 0 });
    assert.equal(v.health, 'noOrders', 'with nothing measured, "they never reached it" is unprovable');
  });
});

describe('deriveAlerts', () => {
  const page = {
    landingPageId: 'p1',
    views: 266,
    orders: 0,
    behavior: { measured: 260, sawForm: 34 },
    hasInsight: true,
  };

  test('names the form problem with the page it is on', () => {
    const alerts = deriveAlerts({
      totals: { views: 279, orders: 0 },
      pages: [page],
      spend: null,
      insightMinViews: 100,
    });
    const form = alerts.find((a) => a.kind === 'formUnreached');
    assert.ok(form, 'the form alert must fire at 13% reach');
    assert.equal(form.severity, 'danger');
    assert.equal(form.landingPageId, 'p1');
    assert.equal(form.count, 34);
    assert.equal(form.context.measured, 260);
    assert.equal(form.context.percent, 13);
  });

  test('worst first', () => {
    const alerts = deriveAlerts({
      totals: { views: 279, orders: 0 },
      pages: [{ ...page, hasInsight: false }],
      spend: { amount: 11.16, orders: 0, clicks: 314 },
      insightMinViews: 100,
    });
    const ranks = alerts.map((a) => a.severity);
    assert.deepEqual(
      [...ranks].sort((a, b) => ranks.indexOf(a) - ranks.indexOf(b)),
      ranks,
      'already sorted',
    );
    assert.equal(alerts[0]!.severity, 'danger');
    assert.ok(alerts.every((a, i) => i === 0 || a.severity !== 'danger' || alerts[i - 1]!.severity === 'danger'));
  });

  test('does not say "no orders" twice when the spend alert already said it', () => {
    const alerts = deriveAlerts({
      totals: { views: 279, orders: 0 },
      pages: [page],
      spend: { amount: 11.16, orders: 0, clicks: 314 },
      insightMinViews: 100,
    });
    assert.ok(alerts.some((a) => a.kind === 'spendNoOrders'));
    assert.equal(alerts.filter((a) => a.kind === 'noOrders').length, 0);
  });

  test('spend with orders raises no money alert', () => {
    const alerts = deriveAlerts({
      totals: { views: 279, orders: 4 },
      pages: [page],
      spend: { amount: 11.16, orders: 4, clicks: 314 },
      insightMinViews: 100,
    });
    assert.equal(alerts.filter((a) => a.kind === 'spendNoOrders').length, 0);
  });

  test('a quiet page raises nothing at all', () => {
    const alerts = deriveAlerts({
      totals: { views: 4, orders: 0 },
      pages: [{ landingPageId: 'p1', views: 4, orders: 0, behavior: null, hasInsight: false }],
      spend: null,
      insightMinViews: 100,
    });
    assert.deepEqual(alerts, [], 'four views is not a problem to solve');
  });

  test('offers an analysis only above the floor and only when none exists', () => {
    const shared = { totals: { views: 300, orders: 0 }, spend: null, insightMinViews: 100 };
    const withInsight = deriveAlerts({
      ...shared,
      pages: [{ landingPageId: 'p1', views: 300, orders: 0, behavior: null, hasInsight: true }],
    });
    assert.equal(withInsight.filter((a) => a.kind === 'analysisReady').length, 0);

    const without = deriveAlerts({
      ...shared,
      pages: [{ landingPageId: 'p1', views: 300, orders: 0, behavior: null, hasInsight: false }],
    });
    assert.equal(without.filter((a) => a.kind === 'analysisReady').length, 1);
  });
});

describe('insightSeverity', () => {
  const ctx = { views: 266, orders: 0, measured: 260 };

  test('the form-reach claim inherits the funnel floors', () => {
    assert.equal(insightSeverity({ metric: 'behavior.sawForm', value: 34, section: 'form' }, ctx), 'danger');
    assert.equal(insightSeverity({ metric: 'behavior.sawForm', value: 100, section: 'form' }, ctx), 'warning');
    assert.equal(insightSeverity({ metric: 'behavior.sawForm', value: 200, section: 'form' }, ctx), 'info');
    assert.ok(34 / 260 < FORM_REACH_DANGER);
  });

  test('stopping at the top is bad; stopping deep in the page is not', () => {
    assert.equal(insightSeverity({ metric: 'furthest.hero', value: 227, section: 'hero' }, ctx), 'danger');
    assert.equal(insightSeverity({ metric: 'furthest.faq', value: 6, section: 'faq' }, ctx), 'info');
  });

  test('a dead interaction is a warning, a live one is not', () => {
    assert.equal(insightSeverity({ metric: 'behavior.variantChanges', value: 0, section: 'form' }, ctx), 'warning');
    assert.equal(insightSeverity({ metric: 'behavior.variantChanges', value: 5, section: 'form' }, ctx), 'info');
  });

  test('an unmeasured page cannot produce a severe verdict', () => {
    const blind = { views: 266, orders: 0, measured: 0 };
    assert.equal(insightSeverity({ metric: 'behavior.sawForm', value: 0, section: 'form' }, blind), 'info');
    assert.equal(insightSeverity({ metric: 'furthest.hero', value: 0, section: 'hero' }, blind), 'info');
  });

  test('an unknown metric falls through to info rather than being dropped', () => {
    assert.equal(insightSeverity({ metric: 'faq.q3', value: 14, section: 'faq' }, ctx), 'info');
    assert.equal(insightSeverity({ metric: 'something.newer', value: 1, section: 'general' }, ctx), 'info');
  });
});

describe('rankInsights', () => {
  const ctx = { views: 266, orders: 0, measured: 260 };

  test('worst first, and the model order kept inside a severity', () => {
    const ranked = rankInsights(
      [
        { metric: 'faq.q1', value: 1, section: 'faq' },
        { metric: 'behavior.sawForm', value: 34, section: 'form' },
        { metric: 'faq.q2', value: 2, section: 'faq' },
        { metric: 'behavior.variantChanges', value: 0, section: 'form' },
      ],
      ctx,
    );
    assert.deepEqual(
      ranked.map((r) => r.metric),
      ['behavior.sawForm', 'behavior.variantChanges', 'faq.q1', 'faq.q2'],
    );
    assert.equal(ranked[0]!.severity, 'danger');
  });

  test('carries every original field through untouched', () => {
    const ranked = rankInsights(
      [{ metric: 'orders', value: 0, section: 'general', finding: 'x', suggestion: 'y' }],
      ctx,
    );
    assert.equal(ranked[0]!.finding, 'x');
    assert.equal(ranked[0]!.suggestion, 'y');
    assert.equal(ranked[0]!.severity, 'danger');
  });

  test('an empty list stays empty', () => {
    assert.deepEqual(rankInsights([], ctx), []);
  });
});
