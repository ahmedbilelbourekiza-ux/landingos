/* =============================================================================
 * lib/ai/providers/openai-compat.js — the workhorse adapter.
 *
 * One adapter serves every provider that speaks the OpenAI Chat Completions
 * protocol: OpenAI itself, GLM (Zhipu), DeepSeek, Qwen (DashScope compat),
 * Mistral, OpenRouter, Ollama (OpenAI shim), LocalAI, vLLM, any custom
 * OpenAI-compatible gateway. The admin picks the right baseUrl + model.
 *
 * Endpoint: `${baseUrl}/chat/completions`  (baseUrl usually ends in /v1)
 * Auth:      `Authorization: Bearer <apiKey>`
 * Streaming: Server-Sent Events; `stream: true` in the body.
 *
 * Default baseUrl per known provider is only a CONVENIENCE — never required and
 * never hardcoded into the CRM core. The admin can override all of them.
 * ========================================================================== */

const { httpFetch, readSseLines, estimateTokens } = require('./base');

/** Friendly suggestions surfaced in the admin UI ("fill defaults for X"). */
const PRESETS = {
  openai:     { baseUrl: 'https://api.openai.com/v1',                 model: 'gpt-4o-mini' },
  glm:        { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',      model: 'glm-4-flash' },
  deepseek:   { baseUrl: 'https://api.deepseek.com/v1',               model: 'deepseek-chat' },
  qwen:       { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  mistral:    { baseUrl: 'https://api.mistral.ai/v1',                 model: 'mistral-small-latest' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1',              model: 'openai/gpt-4o-mini' },
  ollama:     { baseUrl: 'http://localhost:11434/v1',                 model: 'llama3.1' },
  custom:     { baseUrl: '',                                          model: '' },
};

function buildUrl(cfg, path) {
  let base = (cfg.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Missing baseUrl for OpenAI-compatible provider');
  return base + path;
}

function authHeaders(cfg) {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) h['Authorization'] = 'Bearer ' + cfg.apiKey;
  return h;
}

async function testConnection(cfg) {
  if (!cfg.baseUrl) return { ok: false, message: 'Missing base URL' };
  // Lightest possible call: list models (OpenAI /models). Many OpenAI-compat
  // servers implement it; if they don't, we fall back to a 1-token completion.
  const timeout = cfg.timeoutMs || 15000;
  try {
    const res = await httpFetch(buildUrl(cfg, '/models'), { headers: authHeaders(cfg) }, timeout);
    if (res.ok) {
      const n = Array.isArray(res.json?.data) ? res.json.data.length : null;
      return { ok: true, message: n !== null ? `Connected (${n} models available)` : 'Connection successful' };
    }
    // /models not supported — try a minimal chat completion as a fallback probe.
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Authentication failed (invalid API key)' };
    return { ok: false, message: `Provider responded ${res.status}` };
  } catch (e) {
    return { ok: false, message: 'Network error: ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
  }
}

function buildBody(req, cfg, stream) {
  const model = req.model || cfg.defaultModel;
  if (!model) throw new Error('No model specified (set a default model on the provider)');
  return {
    model,
    messages: req.messages || [],
    temperature: req.temperature ?? cfg.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? cfg.maxTokens ?? 2048,
    stream: !!stream,
  };
}

/** Non-streaming completion. Returns { text, usage }. */
async function chat(req, cfg) {
  const timeout = req.timeoutMs || cfg.timeoutMs || 30000;
  const res = await httpFetch(buildUrl(cfg, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify(buildBody(req, cfg, false)),
  }, timeout);
  if (!res.ok) throw new Error(ocrError(res));
  const choice = res.json?.choices?.[0];
  const text = choice?.message?.content || '';
  return { text, usage: res.json?.usage || null };
}

/**
 * Streaming completion — async generator. Yields { delta } for each token chunk,
 * then a final { text, usage }. Uses raw fetch so we can stream the body.
 */
async function* streamChat(req, cfg) {
  const timeout = req.timeoutMs || cfg.timeoutMs || 60000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let full = '';
  let usage = null;
  try {
    const response = await fetch(buildUrl(cfg, '/chat/completions'), {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(buildBody(req, cfg, true)),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(ocrError({ ok: false, status: response.status, text }));
    }
    for await (const payload of readSseLines(response)) {
      const delta = payload?.choices?.[0]?.delta?.content || '';
      if (delta) { full += delta; yield { delta }; }
      if (payload?.usage) usage = payload.usage;
      if (payload?.choices?.[0]?.finish_reason) usage = usage || { finish_reason: payload.choices[0].finish_reason };
    }
  } finally {
    clearTimeout(t);
  }
  yield { text: full, usage };
}

/** Build a readable error message from an OpenAI-compat error response. */
function ocrError(res) {
  let detail = '';
  try {
    const j = typeof res.json !== 'undefined' ? res.json : JSON.parse(res.text || '{}');
    detail = j?.error?.message || j?.message || '';
  } catch { /* ignore */ }
  if (!detail && res.text) detail = String(res.text).slice(0, 200);
  return `Provider error ${res.status}${detail ? ': ' + detail : ''}`;
}

module.exports = {
  key: 'openai-compat',
  label: 'OpenAI-Compatible (OpenAI, GLM, DeepSeek, Qwen, Mistral, OpenRouter, Ollama, Custom)',
  supportsStreaming: true,
  presets: PRESETS,
  testConnection,
  chat,
  streamChat,
};
