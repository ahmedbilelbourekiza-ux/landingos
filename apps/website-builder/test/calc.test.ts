import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  money, count, add, sub, mul, div, percent, breakEven, toString as str, ZERO,
} from '../src/lib/money.ts';
import {
  computeBlock, totalsOf, recordLines, netProfitOf, grandTotal, type CalcInputs,
} from '../src/lib/erp/calc.ts';

/* =============================================================================
 * test/calc.test.ts — LP.16d.
 *
 * The one PURE suite in this app: no server, no database, no fixture. It exists
 * because the profit calculator's arithmetic is the highest-consequence code on
 * any screen here — the figure it produces is POSTed and stored as a company's
 * permanent record of a month — and because the legacy version of it is
 * `+(el.value)` end to end, 1,244 lines of binary floating point.
 *
 * The arithmetic was deliberately moved OUT of the `.tsx` component into
 * `lib/erp/calc.ts` so it could be run here. A component-only implementation
 * could be checked by scraping rendered HTML and no other way, which is how a
 * rounding error survives review.
 * ========================================================================== */

describe('money is exact, which a JS number is not', () => {
  test('the case that names the problem', () => {
    // `0.1 + 0.2 === 0.30000000000000004` in the language this console is
    // written in, and the legacy calculator adds costs exactly like that.
    assert.equal(str(add(money('0.1'), money('0.2')), 2), '0.30');
    assert.notEqual(0.1 + 0.2, 0.3);
  });

  test('a shipping cost times a real order count does not drift', () => {
    // 260 parcels at 412.35 DA. The float answer is 107,210.99999999999.
    assert.equal(str(mul(money('412.35'), count(260)), 2), '107211.00');
  });

  test('a garbage keystroke is zero, not NaN, so the sheet stays computable', () => {
    for (const bad of ['', '-', 'abc', null, undefined, {}]) {
      assert.equal(money(bad), ZERO, `${String(bad)} must parse to zero`);
    }
    // And a plausible half-typed number still parses.
    assert.equal(str(money('12.'), 2), '12.00');
    assert.equal(str(money('-4.5'), 2), '-4.50');
  });

  test('division rounds half away from zero and never throws on zero', () => {
    assert.equal(str(div(money('10'), money('4')), 2), '2.50');
    assert.equal(div(money('10'), ZERO), ZERO, 'no Infinity reaches a text box');
    assert.equal(str(div(money('1'), money('3')), 2), '0.33');
  });

  test('a percentage of nothing is zero rather than a division by zero', () => {
    assert.equal(percent(money('50'), ZERO), ZERO);
    assert.equal(str(percent(money('25'), money('200')), 1), '12.5');
  });

  test('break-even is a whole number of units, and null when there is none', () => {
    // 1000 of costs, 300 of contribution: 3.33 units, so four.
    assert.equal(breakEven(money('1000'), money('300')), 4);
    assert.equal(breakEven(money('1000'), money('250')), 4, 'exactly four is four');
    // The answer that ends a product line: the unit does not cover itself, so
    // no volume fixes it. A very large number here would suggest the problem is
    // volume when it is price.
    assert.equal(breakEven(money('1000'), money('0')), null);
    assert.equal(breakEven(money('1000'), money('-5')), null);
  });
});

/* -----------------------------------------------------------------------------
 * One product, A–G
 * -------------------------------------------------------------------------- */

/** The legacy calculator's own opening defaults, so the numbers are checkable
 *  against the file this was ported from. */
const SHEET: CalcInputs = {
  sellPrice: '2000',
  buyPrice: '800',
  rate: '250',
  adsUsd: '15',
  packCost: '150',
  shipCost: '200',
  unitsSold: '26',
  retCost: '200',
  retCount: '2',
  exchanges: [{ cost: '700' }],
  lossCost: '800',
  lossCount: '0',
  realCa: '77675',
};

describe('one product’s block', () => {
  const c = computeBlock(SHEET);

  test('advertising crosses from USD into DA at the recorded rate', () => {
    assert.equal(str(c.adsDa, 2), '3750.00', '15 USD at 250');
    assert.equal(str(c.adsPerUnit, 2), '144.23', 'over 26 units');
  });

  test('the unit cost is buy + packaging + shipping + this unit’s share of ads', () => {
    assert.equal(str(c.totalUnitCost, 2), '1294.23');
    assert.equal(str(c.grossMargin, 2), '1200.00', 'sell − buy, before anything else');
  });

  test('incidents are a count × a cost, EXCEPT exchanges, which are a list', () => {
    // 200×2 returns + one 700 exchange + 0 losses. The exchange is a list
    // because each one costs what it costs — a different courier, a different
    // distance — and averaging them hides the expensive one.
    assert.equal(str(c.incidents, 2), '1100.00');
  });

  test('the theoretical revenue is the sale less the incidents', () => {
    assert.equal(str(c.caTheoretical, 2), '50900.00', '2000 × 26 − 1100');
  });

  test('all costs, and the profit against what the carrier actually paid', () => {
    // 20800 buy + 3900 packaging + 5200 shipping + 3750 ads + 1100 incidents.
    assert.equal(str(c.allCosts, 2), '34750.00');
    assert.equal(str(c.profit, 2), '42925.00', '77675 received − 34750 spent');
  });

  test('the revenue gap is the number the whole tool exists for', () => {
    // Negative here: the carrier paid MORE than the theoretical figure, which
    // usually means the theoretical one is missing sales. Either way it is the
    // difference somebody has to explain.
    assert.equal(str(c.caGap, 2), '-26775.00');
  });

  test('the six KPIs', () => {
    assert.equal(str(c.roi, 1), '123.5');
    assert.equal(str(c.profitPerUnit, 2), '1650.96');
    assert.equal(c.breakEvenUnits, 50, 'ceil(34750 / (2000 − 1294.23))');
    // 2 returns out of 26 delivered + 2 returned + 1 exchanged.
    assert.equal(str(c.returnRate, 1), '6.9');
    assert.equal(str(c.adsPerUnit, 2), '144.23');
    assert.equal(str(c.netMargin, 1), '55.3');
  });

  test('a product that cannot cover its own unit cost has no break-even', () => {
    const underwater = computeBlock({ ...SHEET, sellPrice: '900' });
    assert.equal(underwater.breakEvenUnits, null);
  });

  test('an empty sheet computes zeroes rather than throwing', () => {
    const blank = computeBlock({
      sellPrice: '', buyPrice: '', rate: '', adsUsd: '', packCost: '', shipCost: '',
      unitsSold: '', retCost: '', retCount: '', exchanges: [], lossCost: '',
      lossCount: '', realCa: '',
    });
    assert.equal(blank.profit, ZERO);
    assert.equal(blank.breakEvenUnits, null);
    assert.equal(str(blank.roi, 1), '0.0');
  });
});

/* -----------------------------------------------------------------------------
 * The business aggregate, and the record it becomes
 * -------------------------------------------------------------------------- */

describe('fixed and unexpected costs are charged exactly once', () => {
  const one = computeBlock(SHEET);
  const fixed = money('30000');
  const unexpected = money('5000');

  test('adding a second product does not charge the rent twice', () => {
    // The property the legacy source states twice, and the reason proration
    // never happens inside a product block.
    const oneProduct = grandTotal(totalsOf([one]), fixed, unexpected);
    const twoProducts = grandTotal(totalsOf([one, one]), fixed, unexpected);
    assert.equal(str(sub(twoProducts, oneProduct), 2), str(one.profit, 2));
  });

  test('the banner is every product’s profit, less the period costs', () => {
    assert.equal(str(grandTotal(totalsOf([one]), fixed, unexpected), 2), '7925.00');
  });
});

describe('D-LP.16.1 — the saved record agrees with the screen that produced it', () => {
  const one = computeBlock(SHEET);
  const totals = totalsOf([one]);
  const fixed = money('30000');
  const unexpected = money('5000');

  test('the six cost lines carry the incidents, which the legacy dropped', () => {
    const lines = recordLines(totals, fixed, unexpected);
    // 20800 buy + 3900 packaging + 1100 incidents.
    assert.equal(str(lines.productCosts, 2), '25800.00');
    assert.equal(str(lines.revenue, 2), '77675.00');
    assert.equal(str(lines.shippingCosts, 2), '5200.00');
    assert.equal(str(lines.advertisingCosts, 2), '3750.00');
  });

  test('and the net profit the ROUTE derives equals the banner', () => {
    // This is the whole point. The route computes revenue minus the five cost
    // lines and ignores anything the request claims; the legacy sent lines that
    // omitted incidents, so its stored net profit came out 1,100 HIGHER than
    // the number on the manager's screen. One period, two answers, and the
    // permanent one was the optimistic one.
    const lines = recordLines(totals, fixed, unexpected);
    assert.equal(
      str(netProfitOf(lines), 2),
      str(grandTotal(totals, fixed, unexpected), 2),
    );
  });

  test('the legacy’s omission is reproduced, so the difference is not a claim', () => {
    const lines = recordLines(totals, fixed, unexpected);
    const asTheLegacySentIt = { ...lines, productCosts: sub(lines.productCosts, one.incidents) };
    assert.equal(
      str(sub(netProfitOf(asTheLegacySentIt), netProfitOf(lines)), 2),
      str(one.incidents, 2),
      'exactly the incident total, overstated',
    );
  });
});
