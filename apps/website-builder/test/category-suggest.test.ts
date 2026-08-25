import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCategoryMessages,
  parseCategorySuggestions,
  resolveSuggestions,
  CategoryParseError,
  MAX_CATEGORY_SUGGESTIONS,
} from '../src/lib/landing/ai-category.ts';

/* =============================================================================
 * CAT.1 — the category suggestion's contract, without a model.
 *
 * Pure, like `calc.ts`'s suite and `variant-model`'s: prompt text in, parsed
 * answer out. The route owns the network, the quota and the database, so
 * everything that decides whether this feature is USEFUL can be checked here —
 * and checked deterministically, which a test that actually calls a model
 * never can be.
 * ========================================================================== */

describe('CAT.1 — what the model is asked', () => {
  test('the shop’s own categories go into the prompt', () => {
    const [, user] = buildCategoryMessages({
      productName: 'Montre Élégante',
      description: 'Une montre pour homme',
      existing: ['Montres', 'Parfums'],
    });
    assert.match(user.content, /Montre Élégante/);
    assert.match(user.content, /- Montres/);
    assert.match(user.content, /- Parfums/);
  });

  test('a shop with no categories says so, rather than sending an empty list', () => {
    // An empty bullet list reads to a model as "there are none of these",
    // which is right — but silence reads as a missing field.
    const [, user] = buildCategoryMessages({
      productName: 'Widget', description: null, existing: [],
    });
    assert.match(user.content, /no categories yet/i);
  });

  test('the instruction to PREFER an existing category is explicit', () => {
    /* The whole value of asking a model rather than a dictionary. Without it a
       shop grows "Montres", "Watches" and "Horlogerie" as three siblings with
       three URLs and three nav entries — the duplication LB.19 exists to stop
       one layer down. */
    const [system] = buildCategoryMessages({
      productName: 'x', description: null, existing: ['A'],
    });
    assert.match(system.content, /STRONGLY prefer an existing category/);
  });

  test('nothing but the product and the category names is sent', () => {
    // What is not in the input cannot travel to a provider by accident —
    // `buildInsightMessages`' rule, applied here.
    const [system, user] = buildCategoryMessages({
      productName: 'Widget', description: 'A thing', existing: ['Tools'],
    });
    for (const forbidden of ['price', 'phone', 'order', 'customer', 'DZD']) {
      assert.ok(
        !user.content.toLowerCase().includes(forbidden),
        `"${forbidden}" reached the prompt`,
      );
    }
    assert.ok(system.content.length > 0);
  });
});

describe('CAT.1 — reading the answer back', () => {
  test('plain JSON parses', () => {
    const answer = parseCategorySuggestions('{"suggestions":[{"name":"Montres","reason":"a watch"}]}');
    assert.equal(answer.suggestions[0].name, 'Montres');
    assert.equal(answer.suggestions[0].reason, 'a watch');
  });

  test('a fenced code block parses too', () => {
    // Models wrap JSON in ``` often enough that refusing would cost a call the
    // tenant has already been billed for — `parseGeneratedCopy`'s leniency.
    const answer = parseCategorySuggestions('```json\n{"suggestions":[{"name":"Parfums"}]}\n```');
    assert.equal(answer.suggestions[0].name, 'Parfums');
  });

  test('prose instead of JSON is refused by name', () => {
    assert.throws(
      () => parseCategorySuggestions('I think this is a watch.'),
      CategoryParseError,
    );
  });

  test('more than the cap is refused rather than silently truncated', () => {
    const many = JSON.stringify({
      suggestions: Array.from({ length: MAX_CATEGORY_SUGGESTIONS + 1 }, (_, i) => ({
        name: `C${i}`,
      })),
    });
    assert.throws(() => parseCategorySuggestions(many), CategoryParseError);
  });
});

describe('CAT.1 — matching a suggestion back to a real category', () => {
  const existing = [
    { id: 'cat-1', name: 'Montres' },
    { id: 'cat-2', name: 'Parfums' },
  ];

  test('an existing category is recognised and carries its id', () => {
    const [first] = resolveSuggestions(
      { suggestions: [{ name: 'Montres' }] }, existing,
    );
    assert.equal(first.existingId, 'cat-1');
  });

  test('case and spacing do not create a duplicate category', () => {
    /* The failure this feature exists to prevent: a second "montres" with its
       own URL and its own nav entry, differing only in case. */
    const [first] = resolveSuggestions(
      { suggestions: [{ name: '  montres ' }] }, existing,
    );
    assert.equal(first.existingId, 'cat-1');
    assert.equal(first.name, 'Montres', 'the SHOP’s spelling must win');
  });

  test('a genuinely new name is offered as new, with no id', () => {
    const [first] = resolveSuggestions({ suggestions: [{ name: 'Sacs' }] }, existing);
    assert.equal(first.existingId, null);
    assert.equal(first.name, 'Sacs');
  });

  test('the model repeating itself is one suggestion, not three', () => {
    const resolved = resolveSuggestions(
      { suggestions: [{ name: 'Sacs' }, { name: 'sacs' }, { name: 'SACS' }] },
      existing,
    );
    assert.equal(resolved.length, 1);
  });

  test('a shop with no categories gets every suggestion as new', () => {
    const resolved = resolveSuggestions(
      { suggestions: [{ name: 'Montres' }, { name: 'Parfums' }] }, [],
    );
    assert.deepEqual(resolved.map((r) => r.existingId), [null, null]);
  });
});
