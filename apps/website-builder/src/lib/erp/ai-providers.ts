/* =============================================================================
 * Which model providers this deployment offers — the audit's finding.
 *
 * TWO PLACES HELD THIS LIST. `POST /api/erp/ai/providers` validated
 * `z.enum(["openai-compat", "gemini", "anthropic"])` and
 * `console/erp/ai/page.tsx` declared its own
 * `const PROVIDER_TYPES = ["openai-compat", "gemini", "anthropic"]` — with a
 * comment on the component saying "the route's own enum, so a type it would
 * refuse cannot be offered", which was the intent and not what the code did.
 *
 * It is the second-vocabulary defect D-LP.3 exists to prevent, and it fails the
 * same way: silently, the moment one of the two changes. A type added to the
 * route would never appear in the dropdown; one added to the dropdown would be
 * refused with a 422 nobody could explain.
 *
 * NO DIRECTIVE, and that is required: the route imports it on the server and
 * the screen imports it to build a `<select>`. It is a list and a lookup table
 * — no I/O, no React, no Prisma — which is the `edit-field.ts` shape.
 *
 * -----------------------------------------------------------------------------
 * THE PRESETS ARE THE SECOND HALF, AND THEY ARE NOT DECORATION
 *
 * The legacy publishes `GET /api/ai/providers/presets/:type` and the platform
 * had nothing: an operator configuring "Google Gemini" was shown an empty base
 * URL box and had to know
 * `https://generativelanguage.googleapis.com/v1beta` from memory. A field
 * somebody has to look up in another tab is a field they get wrong, and a wrong
 * base URL fails at chat time rather than at configuration time.
 *
 * They are SUGGESTIONS, not defaults that are silently stored: the form
 * prefills them and a person can overwrite them, which is what makes an
 * OpenAI-compatible provider (GLM, DeepSeek, Qwen, OpenRouter, a local Ollama)
 * work through the same entry.
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
