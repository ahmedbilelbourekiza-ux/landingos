import "server-only";

import { aiProviderPreset } from "@/lib/erp/ai-providers";
import { guardedFetch, OutboundRefusedError } from "@/lib/net/outbound-guard";

/* =============================================================================
 * Does this API key work? — AUDIT.5, restoring the legacy's Test Connection.
 *
 * `AiProvider.lastTestAt` and `lastTestOk` are SELECTED BY BOTH ROUTES and
 * RENDERED BY THE AI SCREEN, and **nothing has ever written them**. It is
 * BUG-02's shape for the fourth time: columns migrated with their legacy meaning
 * intact, readers built on top of them, and the writer left behind in the port.
 *
 * -----------------------------------------------------------------------------
 * THE REASON THE PORT GAVE FOR SKIPPING IT WAS WRONG
 *
 * LP.17 recorded `/test` as deferred and said why: "testing a provider means
 * calling a model, which needs an adapter layer this deployment does not have".
 * That is a good rule and a false premise — the legacy's own adapters were read
 * again for this audit and two of the three never call a model at all:
 *
 *   - `openai-compat` → GET /models. Lists what the key can see. No inference.
 *   - `gemini`        → GET /models?key=… . The same.
 *   - `anthropic`     → POST /messages with max_tokens: 1. A one-token ping,
 *                       because Anthropic publishes no models list to probe.
 *
 * So this is a CREDENTIAL CHECK, not a chat feature, and it needs none of Tier 4
 * slice 27's machinery. The screen said "test unavailable" for a reason that did
 * not survive reading the source it was describing.
 *
 * -----------------------------------------------------------------------------
 * WHY IT MATTERS MORE HERE THAN FOR A CARRIER
 *
 * A carrier key that is wrong shows up the first time somebody books a parcel.
 * A model provider key that is wrong shows up **at chat time** — which on this
 * deployment is never, because `ai/chat` answers 501. An operator can configure
 * a provider, see it listed, mark it default, and have no way at all to learn
 * that the key was pasted with a trailing newline. AUDIT.1 added presets to make
 * a wrong base URL less likely; this is the part that finds out.
 *
 * -----------------------------------------------------------------------------
 * D-LP.5.1: THIS REACHES THE NETWORK, SO IT TAKES CONFIG AND NOT `db`
 *
 * `withTenant` opens an interactive transaction with a 15-second timeout and
 * this is a round trip to somebody else's server. The signature takes a plain
 * config object so a caller CANNOT hand it a transaction client — the same
 * reason `bookShipment` takes a `tenantId`.
 *
 * D-LP.2: an unregistered type REFUSES. A green tick that means "nobody was
 * contacted" is the fabricated-tracking-number defect wearing a different hat,
 * and this is the screen an operator checks before trusting the integration.
 * ========================================================================== */

export interface AiConnectionConfig {
  readonly type: string | null;
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly defaultModel: string | null;
  readonly timeoutMs: number | null;
}

export interface AiConnectionResult {
  readonly ok: boolean;
  readonly message: string;
  /** The URL that was contacted, for the log. Never the key. */
  readonly url?: string;
}

/** The legacy's own ceiling. A test that hangs is a request nobody can cancel. */
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;

function timeoutOf(cfg: AiConnectionConfig): number {
  const raw = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(raw, 1_000), MAX_TIMEOUT_MS);
}

/** Trailing slashes are what a person pastes; they are not a different URL. */
function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/**
 * The base URL to use, preferring what the tenant stored and falling back to the
 * preset. A provider saved before AUDIT.1 added presets can have none.
 */
function resolveBase(cfg: AiConnectionConfig): string | null {
  const stored = cfg.baseUrl?.trim();
  if (stored) return stored;
  return aiProviderPreset(cfg.type ?? "")?.baseUrl || null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<{ status: number; ok: boolean; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    /* SEC.7 — the same guard `completeWithProvider` runs, because this module
     * contacts the same merchant-set base URL: refused as written and AS
     * RESOLVED when it points anywhere private, every redirect hop re-checked.
     * The connection tester is the screen where the refusal is USEFUL — the
     * operator sees it at configuration time instead of at generation time. */
    const res = await guardedFetch(
      url,
      { ...init, signal: controller.signal, cache: "no-store" },
      { protocols: ["https:", "http:"], maxRedirects: 3 },
    );
    // A provider that answers HTML on an error path must not crash the test.
    const json = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

function networkMessage(error: unknown): string {
  if (error instanceof OutboundRefusedError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "Network error: timeout";
  return `Network error: ${error instanceof Error ? error.message : String(error)}`;
}

// -----------------------------------------------------------------------------
// The three adapters, ported call for call from `apps/erp/lib/ai/providers/`.
// -----------------------------------------------------------------------------

async function testOpenAiCompatible(cfg: AiConnectionConfig): Promise<AiConnectionResult> {
  const base = resolveBase(cfg);
  if (!base) return { ok: false, message: "Missing base URL." };
  const url = join(base, "/models");
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {} },
      timeoutOf(cfg),
    );
    if (res.ok) {
      const data = (res.json as { data?: unknown[] } | null)?.data;
      const n = Array.isArray(data) ? data.length : null;
      return {
        ok: true,
        url,
        message: n !== null ? `Connected (${n} models available).` : "Connection successful.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, url, message: "Authentication failed (invalid API key)." };
    }
    return { ok: false, url, message: `Provider responded ${res.status}.` };
  } catch (error) {
    return { ok: false, url, message: networkMessage(error) };
  }
}

async function testGemini(cfg: AiConnectionConfig): Promise<AiConnectionResult> {
  if (!cfg.apiKey) return { ok: false, message: "Missing API key." };
  const base = resolveBase(cfg);
  if (!base) return { ok: false, message: "Missing base URL." };
  // Google takes the key in the query string. The URL recorded in the log is
  // therefore the one WITHOUT it — see the `url` returned below.
  const url = join(base, "/models");
  try {
    const res = await fetchWithTimeout(
      `${url}?key=${encodeURIComponent(cfg.apiKey)}`,
      {},
      timeoutOf(cfg),
    );
    if (res.ok) {
      const models = (res.json as { models?: unknown[] } | null)?.models;
      const n = Array.isArray(models) ? models.length : null;
      return { ok: true, url, message: n !== null ? `Connected (${n} models).` : "Connection successful." };
    }
    if (res.status === 400 || res.status === 403) {
      return { ok: false, url, message: "Invalid API key." };
    }
    return { ok: false, url, message: `Google responded ${res.status}.` };
  } catch (error) {
    return { ok: false, url, message: networkMessage(error) };
  }
}

async function testAnthropic(cfg: AiConnectionConfig): Promise<AiConnectionResult> {
  if (!cfg.apiKey) return { ok: false, message: "Missing API key." };
  const base = resolveBase(cfg);
  if (!base) return { ok: false, message: "Missing base URL." };
  const url = join(base, "/messages");
  // Anthropic publishes no models list, so the legacy validates the key with the
  // smallest possible completion. `max_tokens: 1` is the whole point: it is a
  // ping, and it is the only adapter here that spends anything at all.
  const model = cfg.defaultModel?.trim() || aiProviderPreset("anthropic")?.model || "claude-sonnet-4-5";
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      },
      timeoutOf(cfg),
    );
    if (res.ok) return { ok: true, url, message: "Connected to Anthropic." };
    if (res.status === 401) return { ok: false, url, message: "Invalid API key." };
    return { ok: false, url, message: `Anthropic responded ${res.status}.` };
  } catch (error) {
    return { ok: false, url, message: networkMessage(error) };
  }
}

const TESTERS: Record<string, (cfg: AiConnectionConfig) => Promise<AiConnectionResult>> = {
  "openai-compat": testOpenAiCompatible,
  gemini: testGemini,
  anthropic: testAnthropic,
};

/** Whether this deployment can test a type at all, without contacting anything. */
export const canTestAiProvider = (type: string | null | undefined): boolean =>
  Boolean(type && type in TESTERS);

/**
 * Contact the provider and report what it said.
 *
 * NEVER THROWS: every branch returns a result, because the caller records the
 * outcome either way and a thrown test is a row that says nothing happened.
 */
export async function testAiConnection(cfg: AiConnectionConfig): Promise<AiConnectionResult> {
  const tester = TESTERS[cfg.type ?? ""];
  if (!tester) {
    // Refused rather than passed — D-LP.2. A row can name a type this build has
    // no adapter for (an older deployment, a hand-edited record), and a green
    // tick there would mean "we did not look".
    return { ok: false, message: `No adapter is registered for provider type "${cfg.type ?? ""}".` };
  }
  try {
    return await tester(cfg);
  } catch (error) {
    return { ok: false, message: networkMessage(error) };
  }
}
