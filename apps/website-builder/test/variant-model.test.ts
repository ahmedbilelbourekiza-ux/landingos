import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  axesFromLandingVariants,
  matrixFromAxes,
  matrixFromLandingVariants,
  matrixName,
} from '../src/lib/erp/variant-axes.ts';
import {
  canonicalVariantLabel,
  variantLabelFromSnapshot,
  VARIANT_LABEL_SEPARATOR,
} from '../src/lib/erp/variant-label.ts';

/* =============================================================================
 * VAR.1 + INV.2 — the shared option vocabulary, tested without a database.
 *
 * PURE ON PURPOSE, like `calc.ts`'s suite. Everything here is arithmetic over
 * plain objects, so it needs no server, no tenant and no network — which also
 * means it is the one part of this batch that cannot be made to look broken by
 * a flaky database.
 *
 * THE PROPERTY THAT MATTERS MOST is the last describe below: the name the
 * MATRIX generates and the name a CHECKOUT produces must be byte-identical.
 * `applyMovement` finds a variant by name, so if those two ever disagree the
 * stock moves against nothing while every screen looks correct — INV.1's
 * silent failure, one layer up. Two implementations existed before VAR.1 (one
 * in the browser component, none on the server); this suite is what stops a
 * third appearing.
 * ========================================================================== */

const row = (name: string, value: string, displayOrder: number) => ({ name, value, displayOrder });

describe('VAR.1 — the axes a page sells, from its flat variant rows', () => {
  test('rows group into axes, in the merchant’s own order', () => {
    const axes = axesFromLandingVariants([
      row('Size', 'S', 0),
      row('Size', 'M', 1),
      row('Colour', 'Blue', 2),
      row('Colour', 'Red', 3),
    ]);
    assert.deepEqual(axes, [
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Colour', values: ['Blue', 'Red'] },
    ]);
  });

  test('displayOrder decides, not the order rows happen to arrive in', () => {
    // The builder's PUT assigns displayOrder from array position, group by
    // group. A read that returns them shuffled must not reorder the axes,
    // because axis order IS the catalogue name.
    const axes = axesFromLandingVariants([
      row('Colour', 'Red', 3),
      row('Size', 'S', 0),
      row('Colour', 'Blue', 2),
      row('Size', 'M', 1),
    ]);
    assert.deepEqual(axes.map((a) => a.name), ['Size', 'Colour']);
    assert.deepEqual(axes[0].values, ['S', 'M']);
  });

  test('one axis spelled two ways is one axis, and keeps the first spelling', () => {
    // Otherwise "Colour" and "colour" generate a nonsense cross product where
    // every combination appears twice under two names holding separate stock.
    const axes = axesFromLandingVariants([
      row('Colour', 'Blue', 0),
      row('colour', 'Red', 1),
    ]);
    assert.equal(axes.length, 1);
    assert.equal(axes[0].name, 'Colour');
    assert.deepEqual(axes[0].values, ['Blue', 'Red']);
  });

  test('blank names and values describe nothing and are dropped', () => {
    const axes = axesFromLandingVariants([
      row('Size', 'M', 0),
      row('', 'Orphan', 1),
      row('Colour', '  ', 2),
    ]);
    assert.deepEqual(axes, [{ name: 'Size', values: ['M'] }]);
  });

  test('a page with no options has no axes, and therefore no matrix', () => {
    assert.deepEqual(axesFromLandingVariants([]), []);
    assert.deepEqual(matrixFromLandingVariants([]), []);
  });
});

describe('VAR.1 — the matrix generated from those axes', () => {
  test('the cross product is every combination, named in definition order', () => {
    const matrix = matrixFromLandingVariants([
      row('Size', 'S', 0),
      row('Size', 'M', 1),
      row('Colour', 'Blue', 2),
      row('Colour', 'Red', 3),
    ]);
    assert.deepEqual(
      matrix.map((m) => m.name),
      ['S / Blue', 'S / Red', 'M / Blue', 'M / Red'],
    );
    // The options map is what makes "how much Blue, in any size" answerable.
    assert.deepEqual(matrix[0].options, { Size: 'S', Colour: 'Blue' });
  });

  test('three colours by five sizes is fifteen rows, not eight', () => {
    // The whole reason the two models are not one: the builder describes 8
    // choices, the shelf holds 15 things.
    const rows = [
      ...['Red', 'Blue', 'Green'].map((v, i) => row('Colour', v, i)),
      ...['S', 'M', 'L', 'XL', 'XXL'].map((v, i) => row('Size', v, 3 + i)),
    ];
    assert.equal(rows.length, 8);
    assert.equal(matrixFromLandingVariants(rows).length, 15);
  });

  test('a single axis generates one row per value, with no separator', () => {
    const matrix = matrixFromLandingVariants([row('Size', 'M', 0), row('Size', 'L', 1)]);
    assert.deepEqual(matrix.map((m) => m.name), ['M', 'L']);
  });

  test('regenerating after adding a value does not rename what existed', () => {
    /* The stability the naming rule exists for. If adding XL renamed the other
       rows, every existing level would be orphaned from its stock — a silent
       loss with no movement row behind it. */
    const before = matrixFromLandingVariants([
      row('Size', 'S', 0), row('Size', 'M', 1), row('Colour', 'Blue', 2),
    ]).map((m) => m.name);
    const after = matrixFromLandingVariants([
      row('Size', 'S', 0), row('Size', 'M', 1), row('Size', 'XL', 2), row('Colour', 'Blue', 3),
    ]).map((m) => m.name);
    for (const name of before) {
      assert.ok(after.includes(name), `regenerating lost "${name}"`);
    }
  });
});

describe('THE INVARIANT — the matrix and the checkout must name a variant identically', () => {
  /* If these two ever disagree, `applyMovement` finds no variant by that name
     and the stock moves against nothing while every screen looks right. It is
     the exact shape of INV.1's silent failure, one layer up, and it is why the
     join lives in ONE function that both sides call. */

  const axes = [
    { name: 'Size', values: ['S', 'M'] },
    { name: 'Colour', values: ['Blue', 'Red'] },
  ];

  test('every generated combination is reproduced by the checkout label', () => {
    for (const combo of matrixFromAxes(axes)) {
      // What a checkout has: the chosen rows, in definition order.
      const chosen = Object.entries(combo.options).map(([name, value], i) => ({
        name,
        value,
        displayOrder: i,
      }));
      assert.equal(
        canonicalVariantLabel(chosen),
        combo.name,
        `the checkout would call "${combo.name}" something else`,
      );
    }
  });

  test('the checkout label survives being picked in the wrong order', () => {
    // A customer clicks Colour first; the catalogue name must not change.
    const forwards = canonicalVariantLabel([
      { name: 'Size', value: 'M', displayOrder: 0 },
      { name: 'Colour', value: 'Blue', displayOrder: 1 },
    ]);
    const backwards = canonicalVariantLabel([
      { name: 'Colour', value: 'Blue', displayOrder: 1 },
      { name: 'Size', value: 'M', displayOrder: 0 },
    ]);
    assert.equal(forwards, 'M / Blue');
    assert.equal(backwards, 'M / Blue');
  });

  test('a stored snapshot names the same variant as the live selection', () => {
    // `SalesOrder.variants` carries no displayOrder — the checkout stores it
    // ordered instead (INV.2), so array order is the definition order.
    assert.equal(
      variantLabelFromSnapshot([
        { name: 'Size', value: 'M' },
        { name: 'Colour', value: 'Blue' },
      ]),
      matrixName(axes, { Size: 'M', Colour: 'Blue' }),
    );
  });

  test('no variant means the empty name, which is the product’s own level', () => {
    assert.equal(canonicalVariantLabel([]), '');
    assert.equal(variantLabelFromSnapshot(null), '');
    assert.equal(variantLabelFromSnapshot('not an array'), '');
  });

  test('one value per axis — a second value for an axis cannot widen the name', () => {
    // Not reachable from the storefront picker, but a name carrying two sizes
    // matches no catalogue row and would move no stock.
    assert.equal(
      canonicalVariantLabel([
        { name: 'Size', value: 'M', displayOrder: 0 },
        { name: 'Size', value: 'L', displayOrder: 1 },
        { name: 'Colour', value: 'Blue', displayOrder: 2 },
      ]),
      'M / Blue',
    );
  });

  test('both sides use the one separator, so neither can drift alone', () => {
    assert.equal(VARIANT_LABEL_SEPARATOR, ' / ');
    assert.equal(matrixName(axes, { Size: 'M', Colour: 'Blue' }), `M${VARIANT_LABEL_SEPARATOR}Blue`);
  });
});

/* -----------------------------------------------------------------------------
 * VAR.2 — reconciling a matrix, and the availability rule
 * -------------------------------------------------------------------------- */

describe('VAR.2 — a re-send reconciles the matrix, it never replaces it', () => {
  const combo = (name: string, options: Record<string, string>) => ({ name, options });

  test('existing combinations keep their stock, SKU and photograph', async () => {
    const { reconcileMatrix } = await import('../src/lib/erp/variant-axes.ts');
    const { next } = reconcileMatrix(
      [{ name: 'M / Blue', stock: 12, sku: 'SKU-MB', image: 'blue.png', threshold: 3 }],
      [combo('M / Blue', { Size: 'M', Colour: 'Blue' })],
    );
    assert.equal(next.length, 1);
    assert.equal(next[0].stock, 12, 'a re-publish zeroed a level — the D-LP.18.2 loss');
    assert.equal(next[0].sku, 'SKU-MB');
    assert.equal(next[0].image, 'blue.png');
    assert.equal(next[0].threshold, 3);
  });

  test('new combinations arrive at zero, never at an invented level', async () => {
    const { reconcileMatrix } = await import('../src/lib/erp/variant-axes.ts');
    const { next, outcome } = reconcileMatrix(
      [{ name: 'M / Blue', stock: 12 }],
      [combo('M / Blue', { Size: 'M', Colour: 'Blue' }), combo('M / Red', { Size: 'M', Colour: 'Red' })],
    );
    assert.equal(outcome.added, 1);
    // INV.3's rule: opening stock arrives as a movement, not as a number some
    // other function decided.
    assert.equal(next.find((v) => v.name === 'M / Red')!.stock, 0);
  });

  test('a combination the page dropped is removed ONLY when it is empty', async () => {
    const { reconcileMatrix } = await import('../src/lib/erp/variant-axes.ts');
    // The page now sells only Red: Blue is dropped (empty, so it may go) and
    // Green is dropped BUT holds seven units, so it must survive.
    const { next, outcome } = reconcileMatrix(
      [{ name: 'M / Blue', stock: 0 }, { name: 'M / Green', stock: 7 }],
      [combo('M / Red', { Size: 'M', Colour: 'Red' })],
    );
    assert.equal(outcome.removed, 1, 'the empty one should go');
    assert.deepEqual(outcome.keptHoldingStock, ['M / Green']);
    // THE RULE: renaming a colour in the builder must not delete stock.
    const green = next.find((v) => v.name === 'M / Green');
    assert.ok(green, 'a variant holding 7 units was deleted by a re-publish');
    assert.equal(green!.stock, 7);
  });

  test('nothing is lost when the page and the catalogue already agree', async () => {
    const { reconcileMatrix } = await import('../src/lib/erp/variant-axes.ts');
    const { outcome } = reconcileMatrix(
      [{ name: 'M', stock: 4 }],
      [combo('M', { Size: 'M' })],
    );
    assert.deepEqual(outcome, { added: 0, removed: 0, keptHoldingStock: [] });
  });
});

describe('VAR.2 — what the storefront may still offer', () => {
  const axes = [
    { name: 'Size', values: ['S', 'M'] },
    { name: 'Colour', values: ['Blue', 'Red'] },
  ];

  test('with enforcement off, everything is available', async () => {
    const { isCombinationAvailable } = await import('../src/lib/erp/variant-axes.ts');
    assert.equal(isCombinationAvailable(axes, {}, null, 'Colour', 'Blue'), true);
  });

  test('an option is unavailable only for the combination that is empty', async () => {
    const { isCombinationAvailable } = await import('../src/lib/erp/variant-axes.ts');
    const stock = { 'S / Blue': 0, 'S / Red': 5, 'M / Blue': 2, 'M / Red': 0 };

    // Having chosen S, Blue cannot be bought — but Red can.
    const selected = { Size: 'S' };
    assert.equal(isCombinationAvailable(axes, selected, stock, 'Colour', 'Blue'), false);
    assert.equal(isCombinationAvailable(axes, selected, stock, 'Colour', 'Red'), true);

    // The SAME colour is fine once the size changes — which is the whole
    // reason this is per combination and not per value.
    assert.equal(
      isCombinationAvailable(axes, { Size: 'M' }, stock, 'Colour', 'Blue'),
      true,
      'Blue was greyed out globally instead of per combination',
    );
  });

  test('an untouched axis falls back to its first value, as the form submits', async () => {
    const { isCombinationAvailable } = await import('../src/lib/erp/variant-axes.ts');
    // Nothing chosen: Size falls back to "S", so Blue is judged as "S / Blue".
    assert.equal(isCombinationAvailable(axes, {}, { 'S / Blue': 0 }, 'Colour', 'Blue'), false);
  });

  test('a combination the catalogue has never heard of stays available', async () => {
    const { isCombinationAvailable } = await import('../src/lib/erp/variant-axes.ts');
    // Axes changed since the last send. Refusing here would take a working
    // product off sale over a bookkeeping gap the customer cannot fix.
    assert.equal(isCombinationAvailable(axes, { Size: 'M' }, { 'S / Blue': 0 }, 'Colour', 'Blue'), true);
  });

  test('the gate refuses exactly what the storefront greys out', async () => {
    const { refuseIfOutOfStock } = await import('../src/lib/erp/variant-axes.ts');
    const levels = { stock: { 'S / Blue': 0, 'S / Red': 5 }, enforced: true };
    const chosen = (colour: string) => [
      { name: 'Size', value: 'S', displayOrder: 0 },
      { name: 'Colour', value: colour, displayOrder: 1 },
    ];
    assert.equal(refuseIfOutOfStock(levels, chosen('Blue')), 'S / Blue');
    assert.equal(refuseIfOutOfStock(levels, chosen('Red')), null);
    // Off means off, whatever the levels say.
    assert.equal(refuseIfOutOfStock({ stock: { 'S / Blue': 0 }, enforced: false }, chosen('Blue')), null);
  });
});

/* -----------------------------------------------------------------------------
 * VAR.1 (fuller scope) — the ERP as the ONGOING source of truth
 *
 * The first cut moved variants one way: the page's axes generated the matrix
 * at send. That left a manager's later edit invisible to customers. These pin
 * the reversal: once a page is LINKED, the Manager's matrix decides what the
 * shop offers — and the page keeps deciding what it is called and what it
 * costs, because the ERP has nowhere to put either.
 * -------------------------------------------------------------------------- */

describe('VAR.1b — the axes the Manager’s matrix describes', () => {
  const row = (name: string, options: Record<string, string>, stock = 0) => ({ name, options, stock });

  test('axes are rebuilt from each combination’s option map', async () => {
    const { axesFromMatrix } = await import('../src/lib/erp/variant-axes.ts');
    const axes = axesFromMatrix([
      row('M / Blue', { Size: 'M', Colour: 'Blue' }),
      row('L / Red', { Size: 'L', Colour: 'Red' }),
    ]);
    assert.deepEqual(axes, [
      { name: 'Size', values: ['M', 'L'] },
      { name: 'Colour', values: ['Blue', 'Red'] },
    ]);
  });

  test('optionDefs decides the axis order, because that is what it was built from', async () => {
    const { axesFromMatrix } = await import('../src/lib/erp/variant-axes.ts');
    const axes = axesFromMatrix(
      [row('Blue / M', { Colour: 'Blue', Size: 'M' })],
      [{ name: 'Colour' }, { name: 'Size' }],
    );
    assert.deepEqual(axes.map((a) => a.name), ['Colour', 'Size']);
  });

  test('a hand-typed variant with no option map contributes no axes', async () => {
    /* Its name is a label, not a decomposition. Splitting "Blue / Large gift
       box" on the separator would invent an axis nobody defined. */
    const { axesFromMatrix } = await import('../src/lib/erp/variant-axes.ts');
    assert.deepEqual(axesFromMatrix([{ name: 'Blue / Large gift box', stock: 3 }]), []);
  });
});

describe('VAR.1b — what the storefront offers once a page is linked', () => {
  const levels = (rows: { name: string; options: Record<string, string>; stock?: number }[], enforced = false) => ({
    stock: Object.fromEntries(rows.map((r) => [r.name, r.stock ?? 0])),
    enforced,
    combinations: new Set(rows.map((r) => r.name)),
    axes: [] as any[],
  });

  test('a value the manager ADDED is offered, even though the page never had it', async () => {
    const { offeredAxes, axesFromMatrix } = await import('../src/lib/erp/variant-axes.ts');
    const rows = [
      { name: 'S', options: { Size: 'S' } },
      { name: 'M', options: { Size: 'M' } },
      { name: 'XL', options: { Size: 'XL' } }, // added in the Manager
    ];
    const l = { ...levels(rows), axes: axesFromMatrix(rows) };
    const offered = offeredAxes([{ name: 'Size', values: ['S', 'M'] }], l);
    assert.deepEqual(offered, [{ name: 'Size', values: ['S', 'M', 'XL'] }]);
  });

  test('a value the manager DELETED stops being offered', async () => {
    const { offeredAxes, axesFromMatrix } = await import('../src/lib/erp/variant-axes.ts');
    const rows = [{ name: 'S', options: { Size: 'S' } }]; // M deleted in the Manager
    const l = { ...levels(rows), axes: axesFromMatrix(rows) };
    const offered = offeredAxes([{ name: 'Size', values: ['S', 'M'] }], l);
    assert.deepEqual(offered, [{ name: 'Size', values: ['S'] }]);
  });

  test('the page keeps its own wording and order where the two agree', async () => {
    const { offeredAxes, axesFromMatrix } = await import('../src/lib/erp/variant-axes.ts');
    // The Manager stores the axis lower-cased and the values reversed.
    const rows = [
      { name: 'M', options: { size: 'M' } },
      { name: 'S', options: { size: 'S' } },
    ];
    const l = { ...levels(rows), axes: axesFromMatrix(rows) };
    const offered = offeredAxes([{ name: 'Size', values: ['S', 'M'] }], l);
    assert.equal(offered[0].name, 'Size', 'the PAGE names the axis');
    assert.deepEqual(offered[0].values, ['S', 'M'], 'the PAGE orders the values');
  });

  test('an unlinked page offers exactly its own axes, unchanged', async () => {
    const { offeredAxes } = await import('../src/lib/erp/variant-axes.ts');
    const pageAxes = [{ name: 'Size', values: ['S', 'M'] }];
    assert.deepEqual(offeredAxes(pageAxes, null), pageAxes);
    assert.deepEqual(offeredAxes(pageAxes, { stock: {}, enforced: false }), pageAxes);
  });
});

describe('VAR.1b — the two refusals are different rules', () => {
  const linked = (combos: Record<string, number>, enforced: boolean) => ({
    stock: combos,
    enforced,
    combinations: new Set(Object.keys(combos)),
    axes: [{ name: 'Size', values: Object.keys(combos) }],
  });
  const chose = (value: string) => [{ name: 'Size', value, displayOrder: 0 }];

  test('a DELETED combination is refused even with enforcement OFF', async () => {
    /* Deleting a variant is an editorial act — the company stopped making it —
       and no toggle should let a storefront keep selling it. */
    const { refuseIfOutOfStock } = await import('../src/lib/erp/variant-axes.ts');
    const levels = linked({ S: 5 }, false);
    assert.equal(refuseIfOutOfStock(levels, chose('M')), 'M', 'a deleted combination was still sold');
    assert.equal(refuseIfOutOfStock(levels, chose('S')), null);
  });

  test('an EMPTY combination is refused only with enforcement ON', async () => {
    // VAR.2's toggle, unchanged: a new product is tested before stock exists.
    const { refuseIfOutOfStock } = await import('../src/lib/erp/variant-axes.ts');
    assert.equal(refuseIfOutOfStock(linked({ S: 0 }, false), chose('S')), null);
    assert.equal(refuseIfOutOfStock(linked({ S: 0 }, true), chose('S')), 'S');
  });

  test('an unlinked page refuses nothing at all', async () => {
    const { refuseIfOutOfStock } = await import('../src/lib/erp/variant-axes.ts');
    assert.equal(refuseIfOutOfStock({ stock: {}, enforced: false }, chose('anything')), null);
  });

  test('the storefront greys out exactly what the checkout refuses', async () => {
    /* One rule, two surfaces. If these ever diverge a customer is offered
       something the checkout then rejects — the worst of both. */
    const { refuseIfOutOfStock, offerableCombination } = await import('../src/lib/erp/variant-axes.ts');
    for (const enforced of [false, true]) {
      const levels = linked({ S: 5, M: 0 }, enforced);
      for (const value of ['S', 'M', 'XL']) {
        const refused = refuseIfOutOfStock(levels, chose(value)) !== null;
        const offerable = offerableCombination(levels, value);
        assert.equal(refused, !offerable, `"${value}" (enforced=${enforced}) disagrees between the two surfaces`);
      }
    }
  });
});
