/* =============================================================================
 * lib/ai/providers/index.js — AI provider registry + chat service.
 *
 * Resolves the right adapter for an AI provider (by its `type` field) and
 * exposes the high-level operations the rest of the backend uses:
 *
 *   - resolveAdapter(providerId)
 *   - listAdapterKeys()              → admin dropdown
 *   - getPreset(type)                → default baseUrl/model for a known brand
 *   - chat({ provider, messages })   → { text, usage } (non-streaming)
 *   - streamChat({ provider, messages }) → async generator (or null if unsupported)
 *
 * Keeping this logic out of index.js keeps route handlers thin and each model's
 * specifics in its own adapter file. No model is referenced by name here.
 * ========================================================================== */

const db = require('../../db');

const adapters = {
  'openai-compat': require('./openai-compat'),
  'gemini':        require('./gemini'),
  'anthropic':     require('./anthropic'),
};

const ALL_ADAPTER_KEYS = [
  { key: 'openai-compat', label: 'OpenAI-Compatible (OpenAI, GLM, DeepSeek, Qwen, Mistral, OpenRouter, Ollama, Custom)' },
  { key: 'gemini',        label: 'Google Gemini' },
  { key: 'anthropic',     label: 'Anthropic Claude' },
];

function getAdapter(typeKey) { return adapters[typeKey] || adapters['openai-compat']; }
function listAdapterKeys() { return ALL_ADAPTER_KEYS; }

/** Default baseUrl/model suggestions for a known provider brand (admin UX only). */
function getPreset(typeKey) {
  const a = getAdapter(typeKey);
  return (a && a.presets) ? a.presets : null;
}

/**
 * Resolve a usable adapter + secrets config for an AI provider id.
 * Returns { cfg, adapter } or throws if no provider is configured at all.
 */
function resolveProvider(id) {
  const cfg = db.resolveAiProvider(id);
  if (!cfg) {
    const err = new Error('No AI provider configured');
    err.code = 'NO_AI_PROVIDER';
    throw err;
  }
  if (!cfg.active) {
    const err = new Error('The configured AI provider is inactive');
    err.code = 'AI_PROVIDER_INACTIVE';
    throw err;
  }
  return { cfg, adapter: getAdapter(cfg.type) };
}

/**
 * Non-streaming chat. Accepts either an AI provider id or a resolved cfg.
 * Returns { text, usage, model }.
 */
async function chat({ providerId, messages, model, temperature, maxTokens, timeoutMs }) {
  const { cfg, adapter } = resolveProvider(providerId);
  const result = await adapter.chat(
    { messages, model: model || cfg.defaultModel, temperature, maxTokens, timeoutMs },
    cfg
  );
  return { ...result, model: model || cfg.defaultModel, providerId: cfg.id };
}

/**
 * Streaming chat. Returns the adapter's async generator when the adapter
 * supports streaming, otherwise null (caller falls back to non-stream chat).
 */
function streamChat({ providerId, messages, model, temperature, maxTokens, timeoutMs }) {
  const { cfg, adapter } = resolveProvider(providerId);
  if (!adapter.supportsStreaming) return null;
  const gen = adapter.streamChat(
    { messages, model: model || cfg.defaultModel, temperature, maxTokens, timeoutMs },
    cfg
  );
  return { generator: gen, providerId: cfg.id, model: model || cfg.defaultModel };
}

/**
 * Test an AI provider connection by calling its adapter's testConnection.
 * Used by the "Test Connection" admin button. Returns { ok, message }.
 */
async function testProviderConnection(id) {
  const cfg = db.getAiProviderSecrets(id);
  if (!cfg) return { ok: false, message: 'Provider not found' };
  const adapter = getAdapter(cfg.type);
  try {
    return await adapter.testConnection(cfg);
  } catch (e) {
    return { ok: false, message: e.name === 'AbortError' ? 'Timeout' : e.message };
  }
}

module.exports = {
  adapters,
  getAdapter,
  listAdapterKeys,
  getPreset,
  resolveProvider,
  chat,
  streamChat,
  testProviderConnection,
};
