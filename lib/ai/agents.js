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

/* The most an ordinary agent's assistant may ever see, regardless of how the
 * AI Agent row is configured (audit SEC-03).
 *
 * read_analytics is deliberately absent: getAnalytics() aggregates across EVERY
 * order in the system and ignores scopedAgent entirely, so granting it to a
 * confirmation agent would hand over company-wide performance data. The other
 * read permissions are safe for an agent because their order context is pinned
 * to their own name server-side — read_customers included, since calling the
 * customer is literally the job. */
const AGENT_MAX_PERMISSIONS = [
  'read_orders', 'read_customers', 'read_products', 'read_delivery',
  'read_agent_notes', 'generate_reports', 'suggest_actions',
];

/**
 * Resolve an AI Agent by id, clamped to what the CALLER is allowed to see.
 *
 * The fallback used to grant EVERY permission including read_customers, and the
 * chat endpoints were unauthenticated — so anyone could ask the model to list
 * the customer database and have it answer, on the account owner's token
 * budget. Two things changed: the routes now require a session, and the
 * effective permission set is the intersection of the configured agent's
 * permissions with the caller's own ceiling. The assistant can therefore never
 * reveal more than the caller could already fetch from the API themselves.
 *
 * @param {string} agentId
 * @param {{isManager?:boolean}} caller
 */
function resolveAgent(agentId, caller = {}) {
  const ceiling = caller.isManager ? ctx.ALL_PERMISSIONS : AGENT_MAX_PERMISSIONS;
  const clamp = (perms) => (Array.isArray(perms) ? perms : []).filter(p => ceiling.includes(p));

  if (agentId) {
    const a = db.getAiAgent(agentId);
    if (a && a.enabled) return { ...a, permissions: clamp(a.permissions) };
  }
  // Fallback: a general-purpose read-only assistant at the caller's ceiling.
  return {
    id: null,
    name: 'Assistant',
    description: '',
    providerId: '',
    model: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    permissions: [...ceiling],
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

module.exports = { resolveAgent, buildMessages, DEFAULT_SYSTEM_PROMPT, AGENT_MAX_PERMISSIONS };
