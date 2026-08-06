import {
  money, count, add, sub, mul, div, percent, breakEven, ZERO, type Money,
// The `.ts` extension is required by Node's native type stripping, which is
// what lets `test/calc.test.ts` import this module with no build step at all —
// the same reason the workspace packages re-export that way. `tsconfig` has
// `allowImportingTsExtensions` on for exactly this.
} from "../money.ts";

/* =============================================================================
 * The profit calculator's arithmetic — LP.16d.
 *
 * NO DIRECTIVE, deliberately, and no `@/` import: the screen is a client
 * component and this is the part of it that has to be TESTABLE. A `.tsx` module
 * cannot be imported by `node --test` (there is no JSX transform in the type
 * stripper), so leaving these functions inside the component would mean the one
 * thing on the screen that must be exactly right — the maths a company files as
 * its permanent record of a month — could only be checked by scraping rendered
 * HTML. It follows this console's existing rule that anything both sides need
 * lives in a directive-free module.
 *
 * FIXED AND UNEXPECTED COSTS ARE NOT IN `computeBlock`, and the legacy source
 * says so twice for the same reason: they are subtracted exactly ONCE, at the
 * business aggregate. Computing them per product charges the rent again for
 * every product added.
 * ========================================================================== */

/** One product's inputs, as typed. Strings because they come out of text boxes
 *  and are parsed as exact decimals, never as JS numbers. */
export interface CalcInputs {
  readonly sellPrice: string;
  readonly buyPrice: string;
  readonly rate: string;
  readonly adsUsd: string;
  readonly packCost: string;
  readonly shipCost: string;
  readonly unitsSold: string;
  readonly retCost: string;
  readonly retCount: string;
  readonly exchanges: readonly { readonly cost: string }[];
  readonly lossCost: string;
  readonly lossCount: string;
  readonly realCa: string;
}

export interface Computed {
  readonly adsDa: Money;
  readonly adsPerUnit: Money;
  readonly totalUnitCost: Money;
  readonly grossMargin: Money;
  readonly buyTotal: Money;
  readonly packTotal: Money;
  readonly shipTotal: Money;
  readonly incidents: Money;
  readonly caTheoretical: Money;
  readonly allCosts: Money;
  readonly caGap: Money;
  readonly profit: Money;
  readonly realCa: Money;
  readonly roi: Money;
  readonly profitPerUnit: Money;
  readonly profitPerUnitTheoretical: Money;
  readonly returnRate: Money;
  readonly netMargin: Money;
  readonly breakEvenUnits: number | null;
}

export function computeBlock(b: CalcInputs): Computed {
  const sell = money(b.sellPrice);
  const buy = money(b.buyPrice);
  const pack = money(b.packCost);
  const ship = money(b.shipCost);
  const units = count(b.unitsSold);
  const realCa = money(b.realCa);

  // Bought in USD, accounted in DA, at a rate that moves. Recording the rate is
  // what makes last month's advertising figure reproducible.
  const adsDa = mul(money(b.adsUsd), money(b.rate));
  const adsPerUnit = div(adsDa, units);
  const totalUnitCost = add(add(add(buy, pack), ship), adsPerUnit);

  const buyTotal = mul(buy, units);
  const packTotal = mul(pack, units);
  const shipTotal = mul(ship, units);

  const retTotal = mul(money(b.retCost), count(b.retCount));
  // An exchange is a LIST and not a count × a cost, because each one costs what
  // it costs — a different courier, a different distance, a different item.
  const exchTotal = b.exchanges.reduce<Money>((sum, e) => add(sum, money(e.cost)), ZERO);
  const lossTotal = mul(money(b.lossCost), count(b.lossCount));
  const incidents = add(add(retTotal, exchTotal), lossTotal);

  const caTheoretical = sub(mul(sell, units), incidents);
  const allCosts = add(add(add(add(buyTotal, packTotal), shipTotal), adsDa), incidents);
  const profit = sub(realCa, allCosts);

  const totalOrders = add(add(units, count(b.retCount)), count(b.exchanges.length));

  return {
    adsDa, adsPerUnit, totalUnitCost,
    grossMargin: sub(sell, buy),
    buyTotal, packTotal, shipTotal, incidents, caTheoretical, allCosts,
    // Theoretical MINUS real: what the carrier was expected to hand over, less
    // what it actually did. This gap is the whole reason the tool exists.
    caGap: sub(caTheoretical, realCa),
    profit, realCa,
    roi: percent(profit, allCosts),
    profitPerUnit: div(profit, units),
    // The theoretical per-unit figure, deliberately a different number from
    // `profitPerUnit` — it is what a unit earns before the carrier's shortfall.
    profitPerUnitTheoretical: div(sub(caTheoretical, allCosts), units),
    returnRate: percent(count(b.retCount), totalOrders),
    netMargin: percent(profit, realCa),
    breakEvenUnits: breakEven(allCosts, sub(sell, totalUnitCost)),
  };
}

export interface Totals {
  readonly sumProfit: Money;
  readonly revenue: Money;
  readonly buy: Money;
  readonly packaging: Money;
  readonly shipping: Money;
  readonly advertising: Money;
  readonly incidents: Money;
}

/** Every product's figures, summed. Nothing period-level is applied here. */
export function totalsOf(rows: readonly Computed[]): Totals {
  const sum = (pick: (c: Computed) => Money) =>
    rows.reduce<Money>((acc, c) => add(acc, pick(c)), ZERO);
  return {
    sumProfit: sum((c) => c.profit),
    revenue: sum((c) => c.realCa),
    buy: sum((c) => c.buyTotal),
    packaging: sum((c) => c.packTotal),
    shipping: sum((c) => c.shipTotal),
    advertising: sum((c) => c.adsDa),
    incidents: sum((c) => c.incidents),
  };
}

/**
 * The six cost lines a `FinancialRecord` stores, from the sheet's totals.
 *
 * D-LP.16.1 — INCIDENTS GO INTO `productCosts`, AND THE LEGACY DROPPED THEM.
 *
 * The legacy subtracts incidents from every product's profit, shows the result
 * in its banner, and then does not send it: `FinancialRecord` has no incidents
 * column, so the saved `netProfit` — derived server-side as revenue minus the
 * five cost lines — comes out HIGHER than the number the manager was looking at
 * when they pressed save, by exactly the incident total. Two figures, one
 * period, and the permanent one is the optimistic one.
 *
 * A returned or destroyed unit's cost is a cost of goods, so it belongs here.
 * `netProfitOf` below is the same arithmetic the POST route performs, and the
 * test asserts the two agree — which is what makes the record and the screen
 * one answer instead of two.
 */
export function recordLines(totals: Totals, proratedFixed: Money, unexpected: Money) {
  return {
    revenue: totals.revenue,
    productCosts: add(add(totals.buy, totals.packaging), totals.incidents),
    shippingCosts: totals.shipping,
    advertisingCosts: totals.advertising,
    fixedExpenses: proratedFixed,
    unexpectedExpenses: unexpected,
  };
}

/** What `POST /api/erp/financial-records` will derive from those six lines. */
export function netProfitOf(lines: ReturnType<typeof recordLines>): Money {
  return [
    lines.productCosts, lines.shippingCosts, lines.advertisingCosts,
    lines.fixedExpenses, lines.unexpectedExpenses,
  ].reduce((acc, c) => sub(acc, c), lines.revenue);
}

/** The banner: every product's profit, less the period costs, charged once. */
export function grandTotal(totals: Totals, proratedFixed: Money, unexpected: Money): Money {
  return sub(totals.sumProfit, add(proratedFixed, unexpected));
}
