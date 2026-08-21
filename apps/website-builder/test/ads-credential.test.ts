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
