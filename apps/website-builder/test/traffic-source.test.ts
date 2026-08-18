import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSource, isSourceChannel, SOURCE_CHANNELS } from '../src/lib/storefront/traffic-source.ts';

/* =============================================================================
 * test/traffic-source.test.ts — AN.1.
 *
 * Pure suite over the ONE derivation both write paths use (the visit beacon
 * and the checkout). Attribution decides which ad account a merchant feeds
 * next month's budget, so a wrong channel here misdirects real money — the
 * calc.ts argument, applied to marketing spend.
 * ========================================================================== */

describe('explicit utm_source wins, and unknown values stay honest', () => {
  test('the aliases platforms actually emit map to their channel', () => {
    for (const [utm, channel] of [
      ['facebook', 'facebook'], ['fb', 'facebook'], ['meta', 'facebook'],
      ['ig', 'instagram'], ['instagram', 'instagram'],
      ['tiktok', 'tiktok'], ['tt', 'tiktok'],
      ['google', 'google'], ['adwords', 'google'],
      ['whatsapp', 'whatsapp'], ['telegram', 'telegram'],
    ] as const) {
      assert.equal(deriveSource({ utmSource: utm }).channel, channel, utm);
    }
  });

  test('case and whitespace do not change the answer', () => {
    assert.equal(deriveSource({ utmSource: ' Facebook ' }).channel, 'facebook');
    assert.equal(deriveSource({ utmSource: 'TikTok' }).channel, 'tiktok');
  });

  test('an unknown utm_source is OTHER with the raw value kept, never guessed', () => {
    const derived = deriveSource({ utmSource: 'newsletter-aug' });
    assert.equal(derived.channel, 'other');
    assert.equal(derived.detail, 'newsletter-aug');
  });

  test('utm_source outranks a click id and the referrer', () => {
    // The merchant's own explicit tag on the link wins over inference: a
    // fbclid can survive into a copied/re-shared URL; the tag cannot.
    const derived = deriveSource({
      utmSource: 'tiktok',
      fbclid: 'IwAR123',
      referrer: 'https://l.facebook.com/l.php?u=x',
    });
    assert.equal(derived.channel, 'tiktok');
  });
});

describe('click ids are platform evidence', () => {
  test('each click id names its platform', () => {
    assert.equal(deriveSource({ fbclid: 'x' }).channel, 'facebook');
    assert.equal(deriveSource({ ttclid: 'x' }).channel, 'tiktok');
    assert.equal(deriveSource({ gclid: 'x' }).channel, 'google');
  });

  test('the detail says WHICH evidence decided, for debugging a dispute', () => {
    assert.equal(deriveSource({ fbclid: 'x' }).detail, 'fbclid');
  });
});

describe('the referrer is the weakest evidence and matched by host', () => {
  test('platform subdomains match without enumeration', () => {
    assert.equal(deriveSource({ referrer: 'https://l.facebook.com/l.php' }).channel, 'facebook');
    assert.equal(deriveSource({ referrer: 'https://m.facebook.com/' }).channel, 'facebook');
    assert.equal(deriveSource({ referrer: 'https://www.tiktok.com/@shop' }).channel, 'tiktok');
    assert.equal(deriveSource({ referrer: 'https://www.google.com/' }).channel, 'google');
    assert.equal(deriveSource({ referrer: 'https://t.me/channel' }).channel, 'telegram');
    assert.equal(deriveSource({ referrer: 'https://l.instagram.com/' }).channel, 'instagram');
  });

  test('a lookalike host must not match', () => {
    // `notfacebook.com` ends with "facebook.com" as a STRING; host matching
    // must be per-label or an attacker's referrer forges a channel.
    assert.equal(deriveSource({ referrer: 'https://notfacebook.com/' }).channel, 'other');
  });

  test('an unknown referrer is OTHER carrying its host', () => {
    const derived = deriveSource({ referrer: 'https://some-blog.dz/review' });
    assert.equal(derived.channel, 'other');
    assert.equal(derived.detail, 'some-blog.dz');
  });

  test('junk referrers derive to DIRECT, not a crash and not OTHER-with-junk', () => {
    for (const junk of ['not a url', 'javascript:alert(1)', '::::']) {
      const derived = deriveSource({ referrer: junk });
      assert.equal(derived.channel, 'direct', junk);
      assert.equal(derived.detail, null);
    }
  });
});

describe('no evidence at all', () => {
  test('is DIRECT with no detail', () => {
    assert.deepEqual(deriveSource({}), { channel: 'direct', detail: null });
    assert.deepEqual(
      deriveSource({ utmSource: null, fbclid: null, referrer: null }),
      { channel: 'direct', detail: null },
    );
  });
});

describe('hostile input is bounded, because this arrives from anonymous clients', () => {
  test('an absurdly long utm_source is truncated, not stored whole', () => {
    const derived = deriveSource({ utmSource: 'x'.repeat(10_000) });
    assert.ok(derived.detail!.length <= 120);
  });

  test('control characters are stripped from the stored detail', () => {
    const derived = deriveSource({ utmSource: 'face\u0000\u001fbook' });
    assert.equal(derived.channel, 'facebook');
    assert.equal(derived.detail, 'facebook');
  });

  test('the vocabulary check admits exactly the vocabulary', () => {
    for (const channel of SOURCE_CHANNELS) assert.ok(isSourceChannel(channel));
    for (const not of ['Facebook', 'unattributed', '', null, 42]) {
      assert.ok(!isSourceChannel(not), String(not));
    }
  });
});
