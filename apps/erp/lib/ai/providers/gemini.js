/* =============================================================================
 * lib/ai/providers/gemini.js — Google Gemini (Generative Language API).
 *
 * Native adapter because Gemini's request/response shape differs from OpenAI's
 * (roles are 'user'/'model', contents array, generateContent / streamGenerateContent).
 * Auth is an API key on the URL (?key=…), which is Google's documented method.
 *
 * Docs: https://ai.google.dev/api/rest/v1beta/models/generateContent
 * ========================================================================== */

const { httpFetch, readSseLines, estimateTokens } = require('./base');

const PRESETS = { gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' } };

/** Map OpenAI-style {role, content} messages → Gemini contents[]. */
function toGeminiContents(messages) {
  // System instructions are passed separately (systemInstruction), so split
  // them out. Non-system messages map to roles user/model; assistant→model.
  let systemInstruction = null;
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + (m.content || '');
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    // Merge consecutive same-role parts (Gemini alternates user/model strictly).
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: m.content || '' });
    } else {
      contents.push({ role, parts: [{ text: m.content || '' }] });
    }
  }
  return { contents, systemInstruction };
}

function buildUrl(cfg, model, method, stream) {
  let base = (cfg.baseUrl || PRESETS.gemini.baseUrl).replace(/\/+$/, '');
  const m = model || cfg.defaultModel;
  if (!m) throw new Error('No model specified');
  let url = `${base}/models/${m}:${method}`;
  if (cfg.apiKey) url += `?key=${encodeURIComponent(cfg.apiKey)}`;
  if (stream) url += (cfg.apiKey ? '&' : '?') + 'alt=sse'; // SSE framing
  return url;
}

async function testConnection(cfg) {
  if (!cfg.apiKey) return { ok: false, message: 'Missing API key' };
  const timeout = cfg.timeoutMs || 15000;
  try {
    // List models is the cheapest valid call.
    let base = (cfg.baseUrl || PRESETS.gemini.baseUrl).replace(/\/+$/, '');
    const res = await httpFetch(`${base}/models?key=${encodeURIComponent(cfg.apiKey)}`, {}, timeout);
    if (res.ok) {
      const n = Array.isArray(res.json?.models) ? res.json.models.length : null;
      return { ok: true, message: n !== null ? `Connected (${n} models)` : 'Connection successful' };
    }
    if (res.status === 400 || res.status === 403) return { ok: false, message: 'Invalid API key' };
    return { ok: false, message: `Google responded ${res.status}` };
  } catch (e) {
    return { ok: false, message: 'Network error: ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
  }
}

async function chat(req, cfg) {
  const timeout = req.timeoutMs || cfg.timeoutMs || 30000;
  const { contents, systemInstruction } = toGeminiContents(req.messages || []);
  const body = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? cfg.temperature ?? 0.7,
      maxOutputTokens: req.maxTokens ?? cfg.maxTokens ?? 2048,
    },
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
  };
  const res = await httpFetch(buildUrl(cfg, req.model || cfg.defaultModel, 'generateContent', false), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, timeout);
  if (!res.ok) throw new Error(geminiError(res));
  const parts = res.json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('');
  return { text, usage: res.json?.usageMetadata || null };
}

async function* streamChat(req, cfg) {
  const timeout = req.timeoutMs || cfg.timeoutMs || 60000;
  const { contents, systemInstruction } = toGeminiContents(req.messages || []);
  const body = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? cfg.temperature ?? 0.7,
      maxOutputTokens: req.maxTokens ?? cfg.maxTokens ?? 2048,
    },
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let full = '';
  let usage = null;
  try {
    const response = await fetch(buildUrl(cfg, req.model || cfg.defaultModel, 'streamGenerateContent', true), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(geminiError({ ok: false, status: response.status, text }));
    }
    for await (const payload of readSseLines(response)) {
      const parts = payload?.candidates?.[0]?.content?.parts || [];
      const delta = parts.map(p => p.text || '').join('');
      if (delta) { full += delta; yield { delta }; }
      if (payload?.usageMetadata) usage = payload.usageMetadata;
    }
  } finally {
    clearTimeout(t);
  }
  yield { text: full, usage };
}

function geminiError(res) {
  let detail = '';
  try {
    const j = typeof res.json !== 'undefined' ? res.json : JSON.parse(res.text || '{}');
    detail = j?.error?.message || '';
  } catch { /* ignore */ }
  return `Gemini error ${res.status}${detail ? ': ' + detail : ''}`;
}

module.exports = {
  key: 'gemini', label: 'Google Gemini',
  supportsStreaming: true, presets: PRESETS,
  testConnection, chat, streamChat,
};
