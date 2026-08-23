import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { asPlatform, disconnect } from '@landingos/db';

import {
  storePlatformAiProvider,
  readPlatformAiProvider,
  PLATFORM_AI_CREDENTIAL_KEY,
} from '../../src/lib/platform/platform-ai.ts';
import { encryptToken } from '../../src/lib/meta/crypto.ts';

/* =============================================================================
 * PF.1 — the platform-level AI provider credential.
 *
 * ⚠ Nothing here contacts any provider. What this suite pins is the STORE:
 * encrypted at rest (the render-domains pattern), one global row, and — the
 * property the routes depend on — every broken state reads as null, because
 * the spending routes turn null into 501 NO_AI_PROVIDER and a merchant's
 * request must never 500 over an operator-side problem.
 *
 * The E2E half lives in builder-ai.test.ts / builder-insights.test.ts, which
 * install this credential (pointed at their local stubs) and drive the
 * generate/analyze routes through it against the running server.
 * ========================================================================== */

const HAS_DB = Boolean(process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL);
const skip = !HAS_DB;

const CFG = {
  type: 'gemini',
  apiKey: 'AIza-test-secret-pf1',
  defaultModel: 'gemini-2.0-flash',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
} as const;

const rawRow = () =>
  asPlatform().platformCredential.findUnique({
    where: { key: PLATFORM_AI_CREDENTIAL_KEY },
    select: { value: true },
  });

const wipe = () =>
  asPlatform().platformCredential.deleteMany({ where: { key: PLATFORM_AI_CREDENTIAL_KEY } });

describe('the platform AI credential store', { skip }, () => {
  after(async () => {
    await wipe();
    await disconnect();
  });

  test('absent: null, which the routes answer as 501 — AI is off, not broken', async () => {
    await wipe();
    assert.equal(await readPlatformAiProvider(), null);
  });

  test('stored ENCRYPTED at rest, and reads back whole', async () => {
    await storePlatformAiProvider(CFG);
    const row = await rawRow();
    assert.ok(row);
    // The meta/crypto shape (iv:tag:ciphertext), never the plaintext.
    assert.match(row!.value, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
    assert.ok(!row!.value.includes('AIza-test-secret-pf1'));

    const cfg = await readPlatformAiProvider();
    assert.deepEqual(cfg, CFG);
  });

  test('a second store REPLACES the row — one credential, not a list', async () => {
    await storePlatformAiProvider({ ...CFG, type: 'openai-compat', defaultModel: 'gpt-4o-mini' });
    const cfg = await readPlatformAiProvider();
    assert.equal(cfg?.type, 'openai-compat');
    assert.equal(cfg?.defaultModel, 'gpt-4o-mini');
    const rows = await asPlatform().platformCredential.count({
      where: { key: PLATFORM_AI_CREDENTIAL_KEY },
    });
    assert.equal(rows, 1);
  });

  test('an UNDECRYPTABLE row is null — the wrong-AUTH_SECRET state reads as "not configured"', async () => {
    // The exact prod failure LB.23 proved: encrypted under one AUTH_SECRET,
    // read under another. Simulated by writing a value this secret never made.
    await asPlatform().platformCredential.upsert({
      where: { key: PLATFORM_AI_CREDENTIAL_KEY },
      create: { key: PLATFORM_AI_CREDENTIAL_KEY, value: 'deadbeef:deadbeef:deadbeef' },
      update: { value: 'deadbeef:deadbeef:deadbeef' },
    });
    assert.equal(await readPlatformAiProvider(), null);
  });

  test('a MALFORMED config is null too — decryptable garbage must not reach a route', async () => {
    await asPlatform().platformCredential.upsert({
      where: { key: PLATFORM_AI_CREDENTIAL_KEY },
      create: { key: PLATFORM_AI_CREDENTIAL_KEY, value: encryptToken('not json at all') },
      update: { value: encryptToken('not json at all') },
    });
    assert.equal(await readPlatformAiProvider(), null);
  });

  test('a config MISSING its model (or key, type, base) is null — a 501 now beats a 502 at call time', async () => {
    for (const missing of ['type', 'apiKey', 'defaultModel', 'baseUrl'] as const) {
      const broken: Record<string, string> = { ...CFG };
      delete broken[missing];
      await asPlatform().platformCredential.upsert({
        where: { key: PLATFORM_AI_CREDENTIAL_KEY },
        create: { key: PLATFORM_AI_CREDENTIAL_KEY, value: encryptToken(JSON.stringify(broken)) },
        update: { value: encryptToken(JSON.stringify(broken)) },
      });
      assert.equal(await readPlatformAiProvider(), null, `missing ${missing} must read as unconfigured`);
    }
  });
});
