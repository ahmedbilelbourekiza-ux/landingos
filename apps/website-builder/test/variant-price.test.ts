import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasOwnPrice,
  ownPriceOption,
  axesWithOwnPrice,
  unitPriceNumber,
} from '../src/lib/landing/variant-price.ts';

/* =============================================================================
 * VP.1 — a variant option's own price, tested without a database.
 *
 * The browser's order summary and the checkout's charge are computed by two
 * callers in two arithmetics (numbers on the page, Decimal on the server), so
 * the RULE they share is pinned here once. If the two ever disagreed, the
 * customer would be shown one price and charged another.
 * ========================================================================== */

const opt = (name: string, price: number | null, extraPrice = 0) => ({ name, price, extraPrice });

describe('VP.1 — what counts as an own price', () => {
  test('null, undefined and empty mean "use the product price"', () => {
    assert.equal(hasOwnPrice(null), false);
    assert.equal(hasOwnPrice(undefined), false);
    assert.equal(hasOwnPrice(''), false);
  });

  test('zero IS a price — a free variant is a decision, not an absence', () => {
    assert.equal(hasOwnPrice(0), true);
    assert.equal(hasOwnPrice('0'), true);
    assert.equal(hasOwnPrice(2500), true);
  });
});

describe('VP.1 — the unit price a selection costs', () => {
  test('no own price anywhere: product price plus extras, exactly as before', () => {
    assert.equal(unitPriceNumber(2000, []), 2000);
    assert.equal(unitPriceNumber(2000, [opt('Size', null, 300), opt('Colour', null, 200)]), 2500);
  });

  test('an own price REPLACES the product price', () => {
    assert.equal(unitPriceNumber(2000, [opt('Size', 2800)]), 2800);
  });

  test('an own price can be LOWER than the product price', () => {
    assert.equal(unitPriceNumber(2000, [opt('Size', 1500)]), 1500);
  });

  test('extras on the other axis still add on top of the own price', () => {
    assert.equal(unitPriceNumber(2000, [opt('Size', 2800), opt('Colour', null, 200)]), 3000);
  });

  test('two own prices (data the editor refuses): the first in display order wins', () => {
    assert.equal(unitPriceNumber(2000, [opt('Size', 2800), opt('Colour', 9999)]), 2800);
    assert.equal(ownPriceOption([opt('Size', null), opt('Colour', 3100)])?.name, 'Colour');
  });
});

describe('VP.1 — own prices live on one axis only', () => {
  test('reports each axis carrying an own price, folded', () => {
    assert.deepEqual(
      axesWithOwnPrice([
        { name: 'Size', price: 2500 },
        { name: 'size ', price: 2800 },
        { name: 'Colour', price: null },
      ]),
      ['size'],
    );
  });

  test('a second priced axis is visible to the validator', () => {
    assert.deepEqual(
      axesWithOwnPrice([
        { name: 'Size', price: 2500 },
        { name: 'Colour', price: 0 },
      ]),
      ['size', 'colour'],
    );
  });
});
