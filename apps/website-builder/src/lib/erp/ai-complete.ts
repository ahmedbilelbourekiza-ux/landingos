import { aiProviderPreset } from "./ai-providers.ts";
import { guardedFetch, OutboundRefusedError } from "../net/outbound-guard.ts";

/* =============================================================================
 * One completion, any provider (LB.24).
 *
 * The first code in the new platform that asks a model to produce anything.
 * `ai-connection.ts` next door proves a credential works; this module spends
 * it. The adapters are ports of the legacy trio (`apps/erp/lib/ai/providers/`)
 * with everything LB.24 does not need removed: no streaming, no conversation
 * history, no agent permission clamps — one system prompt, one user message,
 * one text answer.
 *
 * The request builders and response readers are exported PURE — a (cfg,
 * messages) pair in, a {url, headers, body} out — so the suite asserts every
 * provider's wire shape without a server or a network (the calc.ts rule).
 * Only `completeWithProvider` touches fetch.
 *
 * NO `server-only` directive, deliberately (the tracking providers' rule):
 * the module HOLDS no secret — the key arrives as an argument and only the
 * route may load one — and the directive would make the wire shapes
 * untestable from node. Nothing here may be imported by a client component.
 *
 * Money note: every call here bills the TENANT's own key. Nothing in this
 * module may log, echo or serialize `cfg.apiKey`; errors carry the provider's
 * status and a short detail, never the request headers.
 * ========================================================================== */

export interface AiCompletionConfig {
  readonly type: string | null;
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly defaultModel: string | null;
  readonly temperature: number | null;
  readonly maxTokens: number | null;
  readonly timeoutMs: number | null;
}

export interface AiMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface AiWireRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Refusals the route can name to the operator. */
export class AiCallError extends Error {
  readonly code: "AI_UPSTREAM_ERROR" | "AI_EMPTY_ANSWER";

  constructor(code: "AI_UPSTREAM_ERROR" | "AI_EMPTY_ANSWER", message: string) {
    super(message);
    this.name = "AiCallError";
    this.code = code;
  }
}

/* Generation needs room a chat default does not: a truncated JSON answer is a
 * worse failure than a slightly larger bill, so the token ceiling is floored
 * at 2048 and the timeout at 30s regardless of the provider row's chat-sized
 * settings. Both still respect a LARGER configured value. */
const MIN_GENERATION_TOKENS = 2048;
const MIN_TIMEOUT_MS = 30_000;
/* Room for a Gemini reasoning model to think WITHOUT starving the answer —
 * see the gemini branch below. On 3.6-flash output pricing the worst case
 * adds ~2 hundredths of a dollar per call, so AQ.1's "N calls is a spend
 * ceiling" argument survives unchanged. */
const GEMINI_THINKING_HEADROOM = 4_096;
const MAX_TIMEOUT_MS = 120_000;

const baseOf = (cfg: AiCompletionConfig): string =>
  (cfg.baseUrl && cfg.baseUrl.trim()) ||
  aiProviderPreset(cfg.type ?? "")?.baseUrl ||
  "";

const modelOf = (cfg: AiCompletionConfig): string =>
  (cfg.defaultModel && cfg.defaultModel.trim()) ||
  aiProviderPreset(cfg.type ?? "")?.model ||
  "";

const tokensOf = (cfg: AiCompletionConfig): number =>
  Math.max(cfg.maxTokens ?? MIN_GENERATION_TOKENS, MIN_GENERATION_TOKENS);

const temperatureOf = (cfg: AiCompletionConfig): number => cfg.temperature ?? 0.7;

export const generationTimeoutMs = (cfg: AiCompletionConfig): number =>
  Math.min(MAX_TIMEOUT_MS, Math.max(cfg.timeoutMs ?? MIN_TIMEOUT_MS, MIN_TIMEOUT_MS));

/** The system half, separated: Anthropic and Gemini take it out of band. */
const splitSystem = (messages: readonly AiMessage[]) => ({
  system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
  users: messages.filter((m) => m.role === "user"),
});

export function buildCompletionRequest(
  cfg: AiCompletionConfig,
  messages: readonly AiMessage[],
): AiWireRequest {
  const base = baseOf(cfg).replace(/\/+$/, "");
  const model = modelOf(cfg);
  if (!base) throw new AiCallError("AI_UPSTREAM_ERROR", "The provider has no base URL.");
  if (!model) throw new AiCallError("AI_UPSTREAM_ERROR", "The provider has no model configured.");

  const { system, users } = splitSystem(messages);

  switch (cfg.type) {
    case "anthropic":
      return {
        url: `${base}/messages`,
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: {
          model,
          max_tokens: tokensOf(cfg),
          temperature: temperatureOf(cfg),
          messages: users.map((m) => ({ role: "user", content: m.content })),
          ...(system ? { system } : {}),
        },
      };
    case "gemini":
      return {
        // The key rides the query string — Gemini's own convention. Callers
        // must never log this URL; parity with ai-connection's deliberate
        // key-free `url` field in its results. Google's own listings name
        // models as `models/<id>`, so that prefix is normalized away rather
        // than doubled into a 404 the connection tester cannot catch.
        url: `${base}/models/${model.replace(/^models\//, "")}:generateContent?key=${encodeURIComponent(cfg.apiKey ?? "")}`,
        headers: { "content-type": "application/json" },
        body: {
          contents: [{ role: "user", parts: users.map((m) => ({ text: m.content })) }],
          generationConfig: {
            temperature: temperatureOf(cfg),
            /* Gemini 3 models REASON, and their thinking tokens spend the
             * same maxOutputTokens budget as the answer — measured on a
             * real gemini-3.6-flash call (24 Aug 2026): thoughts 1681 +
             * answer 363 ≈ the old cap of 2048, finishReason MAX_TOKENS,
             * JSON cut mid-object. So `maxTokens` here means the ANSWER
             * budget, and this adapter adds the thinking allowance on top —
             * with thinkingLevel "low", because a fixed-contract copy task
             * buys nothing with deep reasoning. */
            maxOutputTokens: tokensOf(cfg) + GEMINI_THINKING_HEADROOM,
            thinkingConfig: { thinkingLevel: "low" },
          },
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        },
      };
    default:
      // openai-compat carries everything else, exactly as the preset list says.
      return {
        url: `${base}/chat/completions`,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey ?? ""}`,
        },
        body: {
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: temperatureOf(cfg),
          max_tokens: tokensOf(cfg),
        },
      };
  }
}

/** What the provider says the call cost. Display-only (AQ.1's ledger); the
 * quota's unit is calls, so a provider that reports nothing costs nothing in
 * accuracy — the pair is simply null. */
export interface AiUsageCounts {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
}

export interface AiAnswer {
  readonly text: string;
  readonly usage: AiUsageCounts;
}

export function readCompletionUsage(type: string | null, json: unknown): AiUsageCounts {
  const j = json as any;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (type === "anthropic") {
    return {
      promptTokens: num(j?.usage?.input_tokens),
      completionTokens: num(j?.usage?.output_tokens),
    };
  }
  if (type === "gemini") {
    return {
      promptTokens: num(j?.usageMetadata?.promptTokenCount),
      completionTokens: num(j?.usageMetadata?.candidatesTokenCount),
    };
  }
  return {
    promptTokens: num(j?.usage?.prompt_tokens),
    completionTokens: num(j?.usage?.completion_tokens),
  };
}

/** Did the provider CUT the answer at its token limit? Each adapter names it
 * differently; a truncated answer must be refused with the truth rather than
 * reaching the copy parser as mystery bad JSON — that disguise cost a real
 * diagnosis cycle (24 Aug 2026). */
export function readTruncation(type: string | null, json: unknown): boolean {
  const j = json as any;
  if (type === "anthropic") return j?.stop_reason === "max_tokens";
  if (type === "gemini") return j?.candidates?.[0]?.finishReason === "MAX_TOKENS";
  return j?.choices?.[0]?.finish_reason === "length";
}

export function readCompletionResponse(type: string | null, json: unknown): string {
  const j = json as any;
  if (type === "anthropic") {
    return ((j?.content ?? []) as any[])
      .filter((b) => b?.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("");
  }
  if (type === "gemini") {
    return ((j?.candidates?.[0]?.content?.parts ?? []) as any[])
      .map((p) => String(p?.text ?? ""))
      .join("");
  }
  return String(j?.choices?.[0]?.message?.content ?? "");
}

/** Ask the configured provider for one answer. Throws `AiCallError` only. */
export async function completeWithProvider(
  cfg: AiCompletionConfig,
  messages: readonly AiMessage[],
): Promise<AiAnswer> {
  const wire = buildCompletionRequest(cfg, messages);

  let res: Response;
  try {
    /* SEC.7 — a merchant-set baseUrl is a server-side fetch of an arbitrary
     * host, with a credential attached. guardedFetch refuses private-range
     * targets both as written and AS RESOLVED at request time, and re-checks
     * every redirect hop instead of letting the runtime follow them blind —
     * before this, a hostile "OpenAI-compatible" base could 302 the request
     * (x-api-key and all) at the cloud metadata service. */
    res = await guardedFetch(
      wire.url,
      {
        method: "POST",
        headers: wire.headers,
        body: JSON.stringify(wire.body),
        signal: AbortSignal.timeout(generationTimeoutMs(cfg)),
        cache: "no-store",
      },
      { protocols: ["https:", "http:"], maxRedirects: 3 },
    );
  } catch (error) {
    if (error instanceof OutboundRefusedError) {
      // The guard's own words — operator-actionable, and never a secret.
      throw new AiCallError("AI_UPSTREAM_ERROR", error.message);
    }
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AiCallError(
      "AI_UPSTREAM_ERROR",
      timedOut ? "The model did not answer in time." : "The provider could not be reached.",
    );
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // The STATUS only — ai-connection's deliberate rule. A merchant-set
    // baseUrl makes this a server-side fetch of an arbitrary host, and
    // reflecting response bodies would upgrade that from a status oracle to
    // a read primitive.
    throw new AiCallError("AI_UPSTREAM_ERROR", `Provider error ${res.status}.`);
  }

  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new AiCallError("AI_UPSTREAM_ERROR", "The provider answered with something that is not JSON.");
  }

  if (readTruncation(cfg.type, json)) {
    throw new AiCallError("AI_UPSTREAM_ERROR", "The model's answer was cut off at its token limit.");
  }
  const answer = readCompletionResponse(cfg.type, json).trim();
  if (!answer) throw new AiCallError("AI_EMPTY_ANSWER", "The model returned an empty answer.");
  return { text: answer, usage: readCompletionUsage(cfg.type, json) };
}
