import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { tierFor, toneFor, validThresholds, TIER_TONE, TIERS } from '../src/lib/console/benchmark.ts';

/* -----------------------------------------------------------------------------
 * TR.2 — the four-tier scale.
 *
 * The property worth defending: NO BENCHMARK, NO COLOUR. A figure handed null
 * thresholds must come back null — neutral — never "good" by default and
 * never "bad" by default. Everything else here is arithmetic.
 * -------------------------------------------------------------------------- */

const UP = { bad: 0.2, almostBad: 0.5, almostGood: 0.8 };   // higher is better
const DOWN = { bad: 1500, almostBad: 1200, almostGood: 900 }; // lower is better (a cost)

describe('tierFor — higher is better', () => {
  test('four bands, closed at the bottom, open at the top', () => {
    assert.equal(tierFor(0.0, UP, true), 'bad');
    assert.equal(tierFor(0.19, UP, true), 'bad');
    assert.equal(tierFor(0.2, UP, true), 'almostBad');
    assert.equal(tierFor(0.49, UP, true), 'almostBad');
    assert.equal(tierFor(0.5, UP, true), 'almostGood');
    assert.equal(tierFor(0.79, UP, true), 'almostGood');
    assert.equal(tierFor(0.8, UP, true), 'good');
    assert.equal(tierFor(3, UP, true), 'good', 'a rate over 100% is still simply good');
  });
});

describe('tierFor — lower is better', () => {
  test('the same three numbers read as floors and the comparison flips', () => {
    assert.equal(tierFor(1600, DOWN, false), 'bad');
    assert.equal(tierFor(1500, DOWN, false), 'almostBad', 'exactly on the line is the better band');
    assert.equal(tierFor(1300, DOWN, false), 'almostBad');
    assert.equal(tierFor(1000, DOWN, false), 'almostGood');
    assert.equal(tierFor(900, DOWN, false), 'good');
    assert.equal(tierFor(0, DOWN, false), 'good');
  });
});

describe('no benchmark, no colour', () => {
  test('null thresholds is null, in both directions', () => {
    assert.equal(tierFor(0.9, null, true), null);
    assert.equal(tierFor(50, null, false), null);
    assert.equal(toneFor(0.9, null, true), null);
  });

  test('an unmeasurable value is null even with a benchmark', () => {
    assert.equal(tierFor(null, UP, true), null);
    assert.equal(tierFor(Number.NaN, UP, true), null);
    assert.equal(tierFor(Number.POSITIVE_INFINITY, DOWN, false), null);
  });
});

describe('toneFor', () => {
  test('maps every tier onto one of the four semantic tones', () => {
    assert.deepEqual(TIERS, ['bad', 'almostBad', 'almostGood', 'good']);
    assert.deepEqual(TIER_TONE, {
      bad: 'danger', almostBad: 'warning', almostGood: 'info', good: 'success',
    });
    assert.equal(toneFor(0.1, UP, true), 'danger');
    assert.equal(toneFor(0.3, UP, true), 'warning');
    assert.equal(toneFor(0.6, UP, true), 'info');
    assert.equal(toneFor(0.9, UP, true), 'success');
  });
});

describe('validThresholds', () => {
  test('strictly monotonic in the stated direction', () => {
    assert.equal(validThresholds(UP, true), true);
    assert.equal(validThresholds(DOWN, false), true);
    // The right numbers in the wrong direction describe no bands at all.
    assert.equal(validThresholds(UP, false), false);
    assert.equal(validThresholds(DOWN, true), false);
  });

  test('equal cut points are refused — a band that can never happen is a lie', () => {
    assert.equal(validThresholds({ bad: 900, almostBad: 900, almostGood: 900 }, false), false);
    assert.equal(validThresholds({ bad: 0.2, almostBad: 0.2, almostGood: 0.8 }, true), false);
  });

  test('non-numbers are refused', () => {
    assert.equal(validThresholds({ bad: Number.NaN, almostBad: 1, almostGood: 2 }, true), false);
    assert.equal(validThresholds({ bad: 'a' as unknown as number, almostBad: 1, almostGood: 2 }, true), false);
  });
});
