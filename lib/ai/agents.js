/* =============================================================================
 * lib/ai/agents.js — AI Agent resolution + system-prompt assembly.
 *
 * An "AI Agent" is a role-configured assistant (Manager, Sales, Confirmation…).
 * This module:
 *   - resolves an AI Agent config (falling back to a sane default)
 *   - assembles the system prompt: the agent's instructions + a capability
 *     declaration + a compact JSON dump of the live CRM context (from context.js)
 *
 * The CRM context is injected as a system message so the model answers from
 * REAL data — never hallucinated. The model is explicitly told it can only
 * analyze/recommend/summarize/answer, never act.
 * ========================================================================== */

const db = require('../db');
const ctx = require('./context');

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant integrated into a cash-on-delivery e-commerce CRM for Algeria. You help managers and agents understand their data and make better decisions.

STRICT RULES:
- Answer ONLY from the CRM data provided in this conversation. Never invent numbers.
- You can analyze, recommend, summarize, answer questions, and generate reports.
- You CANNOT perform actions, edit orders, or change any data. If the user wants an action taken, tell them the steps — they will approve and execute it.
- Be concise and direct. When citing figures, show the source field (e.g. "47 orders, 31 confirmed = 66%").
- Statuses: orders use pending/no_answer/callback/confirmed/cancelled/tentative1-3/unreachable; delivery uses created/dispatched/in_transit/at_office/out_for_delivery/delivered/refused/returned/cancelled.
- Money is in Algerian Dinar (DZD). Dates are epoch-milliseconds.`;

/**
 * Resolve an AI Agent by id, with a fallback to a synthetic "general" agent
 * (read-mostly permissions) when none is specified or the requested one is
 * disabled. Never throws — returns a usable config.
 */
function resolveAgent(agentId) {
  if (agentId) {
    const a = db.getAiAgent(agentId);
    if (a && a.enabled) return a;
  }
  // Fallback: general-purpose read-mostly assistant.
  return {
    id: null,
    name: 'Assistant',
    description: '',
    providerId: '',
    model: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    permissions: ['read_orders', 'read_customers', 'read_products', 'read_delivery', 'read_analytics', 'read_agent_notes', 'generate_reports', 'suggest_actions'],
    enabled: true,
    role: 'general',
  };
}

/**
 * Build the messages array for a chat request.
 *   [0] system: agent's own system prompt
 *   [1] system: CRM data snapshot (real numbers for grounding)
 *   [2..] user/assistant: conversation history
 *   [last] user: the new question
 *
 * `actor` shape: { name, scopedAgent? } — when scopedAgent is set (agent.html),
 * order context is limited to that agent's own orders.
 */
function buildMessages({ agent, history, question, actor }) {
  const permissions = agent.permissions || [];
  const context = ctx.buildContext(permissions, {
    range: 'today',
    scopedAgent: actor && actor.scopedAgent,
    orderLimit: actor && actor.scopedAgent ? 200 : 500,
    activeDeliveryOnly: true,
  });

  const messages = [];

  // [0] agent's own instruction set.
  messages.push({ role: 'system', content: agent.systemPrompt || DEFAULT_SYSTEM_PROMPT });

  // [1] live CRM context, grounded and capability-declared.
  const caps = permissions
    .filter(p => p.startsWith('read_') || p === 'generate_reports' || p === 'suggest_actions')
    .map(p => ctx.PERMISSIONS[p] || p);
  const contextBlock = [
    '=== LIVE CRM DATA (authoritative — answer only from this) ===',
    'Your current capabilities: ' + (caps.length ? caps.join('; ') : 'none — you have no data access'),
    'Data snapshot (today):',
    '```json',
    JSON.stringify(context),
    '```',
    'If the question needs data NOT in this snapshot (e.g. a different date range), say so and ask the user to request it explicitly — do not guess.',
  ].join('\n');
  messages.push({ role: 'system', content: contextBlock });

  // [2..] prior turns (most recent kept; trimmed by the route layer).
  for (const turn of (history || [])) {
    if (turn && turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
  }

  // [last] the new question.
  messages.push({ role: 'user', content: question || '' });

  return { messages, context };
}

module.exports = { resolveAgent, buildMessages, DEFAULT_SYSTEM_PROMPT };
