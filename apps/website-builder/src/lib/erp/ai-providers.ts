/* =============================================================================
 * Which model providers this deployment can talk to — the adapter vocabulary.
 *
 * ONE list (the audit's D-LP.3 rule): `ai-complete` and `ai-connection` key
 * their adapters on it, and since PF.1 the ATTENDED INSTALL SCRIPT
 * (`scripts/set-platform-ai-provider.ts`) validates the operator's chosen
 * type against `AI_PROVIDER_KEYS` and prefills the base URL and model from
 * the preset. The tenant-facing route and form that used to share this list
 * are gone — the provider credential is platform-level now — but the rule
 * that created the list survives: a type an adapter cannot serve must not be
 * offerable anywhere, and a type the script accepts must have an adapter.
 *
 * THE PRESETS ARE SUGGESTIONS, NOT SILENT DEFAULTS: the script stores an
 * explicit base URL and model every time (overridable per invocation), which
 * is what lets one `openai-compat` entry serve OpenAI, GLM, DeepSeek, Qwen,
 * OpenRouter or a local Ollama.
 *
 * NO DIRECTIVE, deliberately: a list and a lookup — no I/O, no React, no
 * Prisma — importable from Next routes and from bare node alike.
 * ========================================================================== */

export interface AiProviderType {
  readonly key: string;
  readonly label: string;
  /** Suggested base URL and model. Empty where there is no single sensible one. */
  readonly baseUrl: string;
  readonly model: string;
}

export const AI_PROVIDER_TYPES: readonly AiProviderType[] = [
  {
    key: "openai-compat",
    // The label names the brands this one entry covers, because otherwise a
    // tenant on DeepSeek has no reason to think any of these apply to them.
    label: "OpenAI-compatible (OpenAI, GLM, DeepSeek, Qwen, Mistral, OpenRouter, Ollama, custom)",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    key: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
  },
  {
    key: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
  },
] as const;

/** The keys, for the route's own validation. One list, one answer. */
export const AI_PROVIDER_KEYS = AI_PROVIDER_TYPES.map((t) => t.key) as [string, ...string[]];

export const aiProviderPreset = (key: string): AiProviderType | undefined =>
  AI_PROVIDER_TYPES.find((t) => t.key === key);
