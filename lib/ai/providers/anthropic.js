/* =============================================================================
 * lib/ai/providers/anthropic.js — Anthropic Claude (Messages API).
 *
 * Native adapter because Claude's Messages API differs from OpenAI's:
 *   - system is a top-level param, not a message
 *   - roles are 'user'/'assistant'
 *   - auth: x-api-key header + anthropic-version header
 *   - streaming: SSE with typed events (content_block_delta, message_stop…)
 *
 * Docs: https://docs.anthropic.com/en/api/messages
 * ========================================================================== */

const { httpFetch, readSseLines, estimateTokens } = require('./base');

const PRESETS = { anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' } };
const ANTHROPIC_VERSION = '2023-06-01';

function headers(cfg) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': cfg.apiKey || '',
    'anthropic-version': ANTHROPIC_VERSION,
  };
}
function buildUrl(cfg, path) {
  return (cfg.baseUrl || PRESETS.anthropic.baseUrl).replace(/\/+$/, '') + path;
}

/** Split out the system prompt; map assistant→assistant, user→user. */
function toClaudeMessages(messages) {
  let system = '';
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') { system = (system ? system + '\n\n' : '') + (m.content || ''); continue; }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n\n' + (m.content || '');
    else out.push({ role, content: m.content || '' });
  }
  return { messages: out, system };
}

async function testConnection(cfg) {
  if (!cfg.apiKey) return { ok: false, message: 'Missing API key' };
  const timeout = cfg.timeoutMs || 15000;
  try {
    // Minimal 1-token call validates the key without listing models.
    const res = await httpFetch(buildUrl(cfg, '/messages'), {
      method: 'POST', headers: headers(cfg),
      body: JSON.stringify({
        model: cfg.defaultModel || PRESETS.anthropic.model,
        max_tokens: 1, messages: [{ role: 'user', content: 'ping' }],
      }),
    }, timeout);
    if (res.ok) return { ok: true, message: 'Connected to Anthropic' };
    if (res.status === 401) return { ok: false, message: 'Invalid API key' };
    return { ok: false, message: `Anthropic responded ${res.status}` };
  } catch (e) {
    return { ok: false, message: 'Network error: ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
  }
}

async function chat(req, cfg) {
  const timeout = req.timeoutMs || cfg.timeoutMs || 30000;
  const { messages, system } = toClaudeMessages(req.messages || []);
  const body = {
    model: req.model || cfg.defaultModel,
    max_tokens: req.maxTokens ?? cfg.maxTokens ?? 2048,
    temperature: req.temperature ?? cfg.temperature ?? 0.7,
    messages,
    ...(system ? { system } : {}),
  };
  const res = await httpFetch(buildUrl(cfg, '/messages'), {
    method: 'POST', headers: headers(cfg), body: JSON.stringify(body),
  }, timeout);
  if (!res.ok) throw new Error(claudeError(res));
  const text = (res.json?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
  return { text, usage: res.json?.usage || null };
}

/**
 * Streaming — Claude uses typed SSE events. We only care about
 * content_block_delta (text deltas) and message_delta/message_stop (final usage).
 */
async function* streamChat(req, cfg) {
  const timeout = req.timeoutMs || cfg.timeoutMs || 60000;
  const { messages, system } = toClaudeMessages(req.messages || []);
  const body = {
    model: req.model || cfg.defaultModel,
    max_tokens: req.maxTokens ?? cfg.maxTokens ?? 2048,
    temperature: req.temperature ?? cfg.temperature ?? 0.7,
    messages,
    stream: true,
    ...(system ? { system } : {}),
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let full = '';
  let usage = null;
  try {
    const response = await fetch(buildUrl(cfg, '/messages'), {
      method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(claudeError({ ok: false, status: response.status, text }));
    }
    for await (const ev of readSseLines(response)) {
      if (ev?.type === 'content_block_delta' && ev.delta?.text) {
        full += ev.delta.text; yield { delta: ev.delta.text };
      } else if (ev?.type === 'message_delta' && ev.usage) {
        usage = { ...usage, ...ev.usage };
      } else if (ev?.type === 'message_start' && ev.message?.usage) {
        usage = ev.message.usage;
      }
    }
  } finally {
    clearTimeout(t);
  }
  yield { text: full, usage };
}

function claudeError(res) {
  let detail = '';
  try {
    const j = typeof res.json !== 'undefined' ? res.json : JSON.parse(res.text || '{}');
    detail = j?.error?.message || '';
  } catch { /* ignore */ }
  return `Anthropic error ${res.status}${detail ? ': ' + detail : ''}`;
}

module.exports = {
  key: 'anthropic', label: 'Anthropic Claude',
  supportsStreaming: true, presets: PRESETS,
  testConnection, chat, streamChat,
};
