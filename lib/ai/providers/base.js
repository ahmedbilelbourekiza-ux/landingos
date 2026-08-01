/* =============================================================================
 * lib/ai/providers/base.js — AI provider adapter contract + shared helpers.
 *
 * The CRM must support ANY language model (OpenAI, Gemini, Claude, GLM,
 * DeepSeek, Qwen, Mistral, OpenRouter, Ollama, any OpenAI-compatible API, …)
 * without hardcoding any of them. Each model is reached through an adapter that
 * implements this shape; the CRM core calls the generic methods and never knows
 * model specifics.
 *
 * Adding a model = add one file in lib/ai/providers/ exporting an object that
 * matches ADAPTER_SHAPE, then register it in lib/ai/providers/index.js.
 *
 * No model is ever imported or referenced by name anywhere else in the CRM.
 * ========================================================================== */

/**
 * Every AI provider adapter implements this contract.
 *   key        — provider token: 'openai-compat' | 'gemini' | 'anthropic' | …
 *   label      — human label shown in the admin dropdown.
 *   supportsStreaming — whether streamChat() yields incremental tokens.
 *   testConnection(cfg) — validate credentials by calling the model API.
 *   chat({messages, model, temperature, maxTokens}, cfg) → { text, usage }
 *   streamChat(...) → async generator yielding { delta } chunks, then { text, usage }.
 */
const ADAPTER_SHAPE = {
  key: 'string',
  label: 'string',
  supportsStreaming: true,
  async testConnection(cfg) { throw new Error('testConnection not implemented'); },
  async chat(req, cfg) { throw new Error('chat not implemented'); },
  async *streamChat(req, cfg) { throw new Error('streamChat not implemented'); },
};

/**
 * Shared fetch helper with timeout, modelled on lib/platforms/base.js#httpFetch.
 * Returns { ok, status, text, json, headers }. The body is parsed as JSON when
 * possible; callers that expect SSE/neld responses can read `text` directly.
 */
async function httpFetch(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, text, json, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Read a fetch Response body as a stream of SSE-style `data:` lines. Used by
 * adapters that consume server-sent-events token streams (OpenAI-compat,
 * Anthropic). Yields each parsed JSON payload, skipping empty / `[DONE]` lines.
 */
async function* readSseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        line = line.replace(/\r$/, '');
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try { yield JSON.parse(data); } catch { /* partial / non-json, skip */ }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/** Count tokens cheaply (word-ish heuristic). Used only for history trimming &
 * logging — never billed. Real token counts come from provider usage when present. */
function estimateTokens(text) {
  if (!text) return 0;
  // ~4 chars per token for latin; Arabic/CJK are denser. Bias slightly high.
  return Math.ceil(String(text).length / 3.5);
}

module.exports = { ADAPTER_SHAPE, httpFetch, readSseLines, estimateTokens };
