/* =============================================================================
 * lib/ai/conversations.js — chat-history helpers.
 *
 * Persistence lives in lib/db.js (ai_conversations, append-only). This module
 * adds the bits the route layer needs: load + trim to a token budget, record a
 * turn, and clear. Trimming keeps the prompt within model context windows
 * without losing the most recent turns.
 * ========================================================================== */

const db = require('../db');
const { estimateTokens } = require('./providers/base');

/** Load a conversation's recent turns, trimmed to stay under `maxTokens`. */
function load(actorName, agentId, { maxTokens = 4000, limit = 30 } = {}) {
  const turns = db.getConversation(actorName, agentId, limit);
  // Walk newest→oldest, keep until we'd blow the budget, then reverse to chronological.
  const kept = [];
  let budget = maxTokens;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const cost = estimateTokens(t.content) + 4; // +4 for message framing
    if (cost > budget && kept.length) break;
    budget -= cost;
    kept.unshift({ role: t.role, content: t.content });
  }
  return kept;
}

function record(actorName, agentId, role, content) {
  return db.addConversationTurn({
    actorName: actorName || 'anonymous',
    agentId: agentId || null,
    role,
    content: content || '',
    tokenCount: estimateTokens(content),
  });
}

function clear(actorName, agentId) {
  db.clearConversation(actorName, agentId);
}

module.exports = { load, record, clear, estimateTokens };
