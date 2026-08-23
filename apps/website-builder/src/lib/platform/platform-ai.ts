import { asPlatform } from "@landingos/db";

// Relative, not `@/lib/meta/crypto`: the alias only resolves inside Next's
// build, and the suite (and the attended install script) import this module
// from bare node.
import { encryptToken, revealStoredSecret } from "../meta/crypto.ts";

/* =============================================================================
 * PF.1 — the platform-level AI provider.
 *
 * ONE credential, the OPERATOR's, powers every AI feature (landing generation,
 * behavior insights, the ERP assistant when it ships) for EVERY tenant. This
 * replaced the per-tenant `AiProvider` flow: AI is a platform capability, like
 * a real SaaS, not a bring-your-own-key integration — deliberately UNLIKE the
 * Meta pixel, where the credential really is each merchant's own ad account.
 *
 * THE CREDENTIAL is a PlatformCredential row (key "platform-ai") holding an
 * AES-256-GCM-encrypted JSON config — the render-domains pattern, key derived
 * from AUTH_SECRET. It is the operator's secret: no route selects it into a
 * response, the reader below decrypts server-side only, and
 * `scripts/set-platform-ai-provider.ts` is the attended writer. It does NOT
 * live in `AiProvider` because that table is tenant-gated and RLS-scoped: a
 * "platform row" there would either be invisible to every tenant transaction
 * or need the one RLS policy shape the apply-rls script exists to keep unique.
 *
 * UNCONFIGURED IS A FIRST-CLASS STATE: without the row (or with one this
 * deployment cannot decrypt) every reader gets null and the spending routes
 * answer 501 NO_AI_PROVIDER — AI is simply off, platform-wide, with no
 * fallback to any per-tenant row. One source, one answer.
 *
 * WHAT THIS DOES NOT CHANGE: the AQ.1 quota. `reserveAiCall` still meters
 * every attempt PER TENANT against the tenant's own AiUsageEvent ledger and
 * ProductSetting override — the credential is shared; the allowance is not.
 * And SEC.7 holds regardless of source: `completeWithProvider` re-checks the
 * base URL at request time through the outbound guard.
 * ========================================================================== */

export const PLATFORM_AI_CREDENTIAL_KEY = "platform-ai";

export interface PlatformAiProvider {
  /** One of `AI_PROVIDER_KEYS` — "openai-compat" | "gemini" | "anthropic". */
  readonly type: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  /** Always stored explicitly — the install script fills the preset when the
   *  operator gives none, so readers never need a fallback of their own. */
  readonly baseUrl: string;
  /** Optional tuning; `ai-complete` has its own floors when absent. */
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}

/** Encrypt + upsert the config row. The attended script calls this; tests
 * call it against dev with a stub base. Never logs the key. */
export async function storePlatformAiProvider(cfg: PlatformAiProvider): Promise<void> {
  const value = encryptToken(JSON.stringify(cfg));
  await asPlatform().platformCredential.upsert({
    where: { key: PLATFORM_AI_CREDENTIAL_KEY },
    create: { key: PLATFORM_AI_CREDENTIAL_KEY, value },
    update: { value },
  });
}

/** Null when unconfigured OR undecryptable/malformed — every broken state
 * reads as "not configured" rather than failing a merchant's request over an
 * operator-side problem. A config without a model is broken: refusing it here
 * as a 501 beats the 502 it would become at call time. */
export async function readPlatformAiProvider(): Promise<PlatformAiProvider | null> {
  const row = await asPlatform().platformCredential.findUnique({
    where: { key: PLATFORM_AI_CREDENTIAL_KEY },
    select: { value: true },
  });
  if (!row) return null;
  try {
    const cfg = JSON.parse(revealStoredSecret(row.value)) as PlatformAiProvider;
    return cfg.type && cfg.apiKey && cfg.defaultModel && cfg.baseUrl ? cfg : null;
  } catch {
    return null;
  }
}
