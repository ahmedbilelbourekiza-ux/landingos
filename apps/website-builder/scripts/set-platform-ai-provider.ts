/* =============================================================================
 * PF.1 — install the platform-level AI provider credential, ATTENDED.
 *
 * Run by the OPERATOR, by hand, when they decide AI goes live for the
 * platform (the set-render-credential.ts pattern; NEXT_STEPS §PF.1 records
 * the decision as theirs):
 *
 *   cd apps/website-builder
 *   PLATFORM_AI_TYPE=gemini PLATFORM_AI_KEY=AIza... \
 *     node --env-file=.env --experimental-strip-types scripts/set-platform-ai-provider.ts
 *
 * Optional: PLATFORM_AI_MODEL and PLATFORM_AI_BASE_URL override the type's
 * preset (lib/erp/ai-providers.ts fills both when absent — the same
 * suggestions the removed tenant form used to prefill).
 *
 * Reads everything from the ENVIRONMENT of this one invocation (never stored
 * in any file), and — before storing anything — does two checks the removed
 * tenant route used to do:
 *
 *   1. SEC.7: a custom base URL is refused if it resolves private/internal
 *      (`refuseOutboundUrl`), exactly as the tenant POST refused it.
 *   2. AUDIT.5: the type's own connection test runs against the real
 *      provider (openai-compat/gemini: a free GET /models; anthropic: a
 *      max_tokens:1 ping). A key that fails its test is NOT stored — a
 *      credential that every tenant depends on must not be installed broken.
 *      PLATFORM_AI_SKIP_TEST=1 bypasses this for a deliberate offline
 *      install; the suites do not use this script at all.
 *
 * ⚠ The AES key derives from AUTH_SECRET, so this must run with the
 * AUTH_SECRET of the deployment that will READ the credential — encrypting
 * with a dev secret produces a row production silently cannot decrypt
 * (proven the hard way in LB.23: it reads as "not configured").
 *
 * Prints only the masked tail of the key. Deleting the row turns AI off
 * platform-wide again:  asPlatform().platformCredential.delete({ where: {
 * key: "platform-ai" } }).
 * ========================================================================== */

import { asPlatform, disconnect } from "@landingos/db";

import {
  storePlatformAiProvider,
  PLATFORM_AI_CREDENTIAL_KEY,
  type PlatformAiProvider,
} from "../src/lib/platform/platform-ai.ts";
import { AI_PROVIDER_KEYS, aiProviderPreset } from "../src/lib/erp/ai-providers.ts";
import { testAiConnection } from "../src/lib/erp/ai-connection.ts";
import { refuseOutboundUrl } from "../src/lib/net/outbound-guard.ts";
import { maskToken } from "../src/lib/meta/crypto.ts";

const type = process.env.PLATFORM_AI_TYPE?.trim();
const apiKey = process.env.PLATFORM_AI_KEY?.trim();

if (!type || !apiKey) {
  console.error("PLATFORM_AI_TYPE and PLATFORM_AI_KEY are required (env of this invocation only).");
  process.exit(1);
}
if (!AI_PROVIDER_KEYS.includes(type)) {
  console.error(`Unknown provider type "${type}" — one of: ${AI_PROVIDER_KEYS.join(", ")}.`);
  process.exit(1);
}

const preset = aiProviderPreset(type);
const baseUrl = process.env.PLATFORM_AI_BASE_URL?.trim() || preset?.baseUrl || "";
const defaultModel = process.env.PLATFORM_AI_MODEL?.trim() || preset?.model || "";

if (!baseUrl || !defaultModel) {
  console.error(`Type "${type}" has no preset base URL/model — set PLATFORM_AI_BASE_URL and PLATFORM_AI_MODEL.`);
  process.exit(1);
}

/* SEC.7 — the same refusal the tenant configuration route applied. This URL
 * is fetched server-side with the platform's key attached. */
const reason = refuseOutboundUrl(baseUrl, { protocols: ["https:", "http:"] });
if (reason) {
  console.error(`Refusing base URL: ${reason}`);
  process.exit(1);
}

const cfg: PlatformAiProvider = { type, apiKey, defaultModel, baseUrl };

if (process.env.PLATFORM_AI_SKIP_TEST === "1") {
  console.log("Connection test SKIPPED (PLATFORM_AI_SKIP_TEST=1).");
} else {
  const result = await testAiConnection({ type, baseUrl, apiKey, defaultModel, timeoutMs: null });
  if (!result.ok) {
    console.error(`Connection test FAILED — nothing stored: ${result.message}`);
    await disconnect();
    process.exit(1);
  }
  console.log(`Connection test passed: ${result.message}`);
}

await storePlatformAiProvider(cfg);
const row = await asPlatform().platformCredential.findUnique({
  where: { key: PLATFORM_AI_CREDENTIAL_KEY },
  select: { updatedAt: true },
});
console.log(
  `Stored ${PLATFORM_AI_CREDENTIAL_KEY}: ${type} · ${defaultModel} · key ${maskToken(apiKey)}` +
    ` (encrypted at rest; updated ${row?.updatedAt.toISOString()}).`,
);
await disconnect();
