import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.AUTH_SECRET ||= randomBytes(32).toString('base64url');

const { isEncryptedSecret, readAccountToken, sealAccountToken } =
  await import('../src/lib/ads/meta-ads.ts');
const { encryptToken, revealStoredSecret } = await import('../src/lib/meta/crypto.ts');

/* -----------------------------------------------------------------------------
 * LB.23 — the advertising credential at rest.
 *
 * The whole point of this file is the SECOND describe block: `revealStoredSecret`
 * deliberately returns its input unchanged when the input is not encrypted, so
 * a plaintext token in the database would silently "work". For an ads token
 * that is a trap, and the reader must refuse it rather than use it.
 * -------------------------------------------------------------------------- */

const TOKEN = 'EAAf' + 'x'.repeat(180);

describe('sealing and reading the token', () => {
  test('sealing produces the iv:tag:ciphertext form, not the token', () => {
    const sealed = sealAccountToken(TOKEN);
    assert.ok(!sealed.includes(TOKEN), 'the plaintext token must not survive in the stored value');
    assert.match(sealed, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
  });

  test('a sealed token reads back exactly', () => {
    assert.equal(readAccountToken(sealAccountToken(TOKEN)), TOKEN);
  });

  test('sealing twice yields different ciphertext (random IV) but the same plaintext', () => {
    const a = sealAccountToken(TOKEN);
    const b = sealAccountToken(TOKEN);
    assert.notEqual(a, b, 'a fixed IV would leak that two accounts share a token');
    assert.equal(readAccountToken(a), readAccountToken(b));
  });

  test('absent or empty reads as no credential', () => {
    for (const v of [null, undefined, '']) assert.equal(readAccountToken(v as never), null);
  });
});

describe('THE PLAINTEXT PATH IS CLOSED for this credential', () => {
  test('the fallback that makes this dangerous really does exist elsewhere', () => {
    // Not a hypothetical: revealStoredSecret returns unencrypted input as-is.
    // This test documents WHY the reader below cannot use it.
    assert.equal(revealStoredSecret(TOKEN), TOKEN);
  });

  test('a PLAINTEXT token in the column is REFUSED, never returned', () => {
    // The failure mode this prevents: a live ads token sitting in the clear in
    // the database, working perfectly, so nothing ever surfaces the mistake.
    assert.equal(readAccountToken(TOKEN), null);
  });

  test('near-miss shapes are refused too, not coerced', () => {
    for (const bad of [
      'not-encrypted',
      'deadbeef:cafe',                    // too few segments
      'zzzz:zzzz:zzzz',                   // not hex
      `${TOKEN}:${TOKEN}:${TOKEN}`,       // three segments, but not hex
      'deadbeef:cafebabe:nothex!!',
    ]) {
      assert.equal(readAccountToken(bad), null, bad.slice(0, 30));
    }
  });

  test('isEncryptedSecret is the single gate, and it agrees with the reader', () => {
    const sealed = sealAccountToken(TOKEN);
    assert.equal(isEncryptedSecret(sealed), true);
    assert.equal(isEncryptedSecret(TOKEN), false);
    assert.equal(isEncryptedSecret(null), false);
  });

  test('a FOUR-segment hex value is refused before decryptToken can quietly drop the tail', () => {
    // decryptToken splits on ":" and reads exactly three parts — handed
    // `iv:tag:data:extra` it would silently ignore `extra`. The shape gate
    // must refuse it first, so that lenient parse is never reached here.
    const sealed = sealAccountToken(TOKEN);
    assert.equal(readAccountToken(`${sealed}:deadbeef`), null);
  });

  test('a TAMPERED ciphertext reads as null, not a throw and not garbage', () => {
    // GCM's auth tag is the whole reason for choosing the mode; one flipped
    // nibble anywhere in the stored value must surface as "no credential".
    const sealed = sealAccountToken(TOKEN);
    const flip = (s: string, at: number) =>
      s.slice(0, at) + (s[at] === 'a' ? 'b' : 'a') + s.slice(at + 1);
    const [iv, tag, data] = sealed.split(':');
    assert.equal(readAccountToken(flip(sealed, sealed.length - 2)), null, 'ciphertext bit');
    assert.equal(readAccountToken(`${iv}:${flip(tag, 0)}:${data}`), null, 'auth tag bit');
    assert.equal(readAccountToken(`${flip(iv, 0)}:${tag}:${data}`), null, 'iv bit');
  });

  test('the intake maximum round-trips, and absurdly long garbage refuses without throwing', () => {
    // 500 chars is the route's cap — the longest value the seal path can be
    // handed. And a reader fed a megabyte of junk (a corrupted column, an
    // import gone wrong) must answer null in bounded time, not crash.
    const max = 'E'.repeat(500);
    assert.equal(readAccountToken(sealAccountToken(max)), max);
    assert.equal(readAccountToken('x'.repeat(1_000_000)), null);
    assert.equal(readAccountToken('ab:'.repeat(300_000) + 'cd'), null);
  });

  test('a well-formed value encrypted with a DIFFERENT secret reads as null, not a throw', () => {
    // The production/local AUTH_SECRET mismatch, as a unit test: it must
    // degrade to "not connected", never to a 500 in a merchant's screen.
    const sealed = encryptToken(TOKEN);
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = randomBytes(32).toString('base64url');
    try {
      assert.equal(readAccountToken(sealed), null);
    } finally {
      process.env.AUTH_SECRET = previous;
    }
  });
});
