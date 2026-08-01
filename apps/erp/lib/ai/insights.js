/* =============================================================================
 * lib/ai/insights.js — deterministic insight engine + AI summarizer.
 *
 * Two layers, matching the product decision "instant rules + deep-AI button":
 *
 *   computeInsights() — pure functions over live CRM data. Always correct, always
 *     free (no model call). Surfaces: orders needing attention, low-confirmation
 *     agents, high-cancellation products, delivery delays, callback queue, and
 *     daily/weekly/monthly summaries. This is what the dashboard shows instantly.
 *
 *   summarizeInsights() — optional. Sends the deterministic result + compact
 *     context to the model for a natural-language explanation + prioritized
 *     suggestions. Invoked only when the user clicks "Deep AI analysis".
 *
 * Keeping the hard numbers in code (not the model) means the dashboard is never
 * wrong and never costs a token.
 * ========================================================================== */

const db = require('../db');
const providers = require('./providers');
const ctx = require('./context');

const HOUR = 3600000;
const DAY = 86400000;

const ACTIVE_STATUSES = ['pending','no_answer','callback','tentative1','tentative2','tentative3','unreachable'];

function startOfToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); }

function rate(n, d) { return d ? +(n / d).toFixed(3) : 0; }

/**
 * Compute all deterministic insights. Pure (no model). Returns an object the
 * dashboard renders directly. `permissions` gates which sections appear.
 */
function computeInsights(permissions) {
  const out = { generatedAt: new Date().toISOString(), sections: [] };
  if (!Array.isArray(permissions) || permissions.length === 0) return out;

  const orders = db.loadOrdersData().orders || [];
  const today0 = startOfToday();
  const today = orders.filter(o => (o.createdAt || 0) >= today0);
  const week  = orders.filter(o => (o.createdAt || 0) >= today0 - 6 * DAY);
  const month = orders.filter(o => (o.createdAt || 0) >= today0 - 29 * DAY);

  // --- Summary stats (read_analytics) ---
  if (permissions.includes('read_analytics')) {
    out.sections.push({
      key: 'summary', title: 'Summary', severity: 'info', items: [
        { label: 'Today',   value: `${today.length} orders · ${count(today,'confirmed')} confirmed (${pct(today,'confirmed')}) · ${count(today,'cancelled')} cancelled` },
        { label: 'This week',  value: `${week.length} orders · ${count(week,'confirmed')} confirmed (${pct(week,'confirmed')})` },
        { label: 'This month', value: `${month.length} orders · ${count(month,'confirmed')} confirmed (${pct(month,'confirmed')})` },
        { label: 'Revenue (today, confirmed)', value: money(today.filter(o => o.status === 'confirmed')) },
      ],
    });
  }

  // --- Orders needing attention (read_orders) ---
  if (permissions.includes('read_orders')) {
    const now = Date.now();
    const overdue = orders.filter(o => ACTIVE_STATUSES.includes(o.status) && (!o.calls || o.calls.length === 0) && (now - (o.createdAt || 0)) > 2 * HOUR);
    const staleCallback = orders.filter(o => o.status === 'callback');
    const noStockInfo = [];
    out.sections.push({
      key: 'attention', title: 'Orders needing attention', severity: overdue.length ? 'warning' : 'ok', items: [
        { label: `${overdue.length} order(s) >2h with no call`, value: overdue.slice(0, 8).map(o => `${o.id} (${o.client || '—'}, ${o.wilaya || '—'})`).join('; ') || '—' },
        { label: `${staleCallback.length} order(s) awaiting callback`, value: staleCallback.slice(0, 8).map(o => `${o.id} (${o.client || '—'})`).join('; ') || '—' },
      ],
    });
  }

  // --- Agents with low confirmation rate (read_analytics) ---
  if (permissions.includes('read_analytics')) {
    const roster = (db.getAgents() || []).map(a => a.name);
    const weekByAgent = group(week, o => o.agent);
    const lowAgents = roster.map(name => {
      const arr = weekByAgent[name] || [];
      const conf = count(arr, 'confirmed');
      return { name, total: arr.length, confirmed: conf, rate: rate(conf, arr.length) };
    }).filter(a => a.total >= 5); // need a minimum sample
    const avg = lowAgents.length ? lowAgents.reduce((s, a) => s + a.rate, 0) / lowAgents.length : 0;
    const flagged = lowAgents.filter(a => a.rate < avg * 0.7 && a.rate < 0.4).sort((a, b) => a.rate - b.rate);
    out.sections.push({
      key: 'agents', title: 'Agent performance (this week)', severity: flagged.length ? 'warning' : 'ok', items: flagged.length ? flagged.slice(0, 6).map(a => ({
        label: `${a.name}: ${a.confirmed}/${a.total} confirmed (${Math.round(a.rate * 100)}%)`,
        value: `avg is ${Math.round(avg * 100)}%`,
      })) : [{ label: 'No underperforming agents', value: `avg confirmation rate ${Math.round(avg * 100)}%` }],
    });
  }

  // --- High-cancellation products (read_analytics / read_products) ---
  if (permissions.includes('read_analytics')) {
    const byProduct = group(month, o => o.product);
    const prodFlags = Object.entries(byProduct).map(([name, arr]) => ({
      product: name, total: arr.length, cancelled: count(arr, 'cancelled'), rate: rate(count(arr,'cancelled'), arr.length),
    })).filter(p => p.total >= 5 && p.rate >= 0.4).sort((a, b) => b.rate - a.rate);
    out.sections.push({
      key: 'products', title: 'Products with high cancellation (this month)', severity: prodFlags.length ? 'warning' : 'ok',
      items: prodFlags.length ? prodFlags.slice(0, 6).map(p => ({
        label: `${p.product}: ${Math.round(p.rate * 100)}% cancelled (${p.cancelled}/${p.total})`,
      })) : [{ label: 'No products with abnormal cancellation', value: '' }],
    });
  }

  // --- Delivery delays (read_delivery) ---
  if (permissions.includes('read_delivery')) {
    const ships = db.listActiveShipments();
    const now = Date.now();
    const stalled = ships.filter(s => {
      const age = now - (s.createdAt || 0);
      return (['created','dispatched','in_transit'].includes(s.crmStatus) && age > 3 * DAY)
          || (s.crmStatus === 'at_office' && age > 2 * DAY)
          || (s.crmStatus === 'out_for_delivery' && age > 1 * DAY);
    });
    out.sections.push({
      key: 'delivery', title: 'Delivery delays', severity: stalled.length ? 'warning' : 'ok',
      items: stalled.length ? stalled.slice(0, 8).map(s => ({
        label: `${s.orderId} · ${s.crmStatus} · ${s.trackingNumber || '—'}`,
        value: `${Math.round((now - (s.createdAt||0)) / DAY)}d in transit`,
      })) : [{ label: 'No stalled shipments', value: '' }],
    });
  }

  // --- Fraud / duplicate signals (read_orders) — advisory ---
  if (permissions.includes('read_orders')) {
    const phoneMap = {};
    for (const o of today) {
      if (!o.phone) continue;
      (phoneMap[o.phone] = phoneMap[o.phone] || []).push(o);
    }
    const dupes = Object.entries(phoneMap).filter(([, arr]) => arr.length > 1);
    out.sections.push({
      key: 'fraud', title: 'Possible duplicates (same phone today)', severity: dupes.length ? 'warning' : 'ok',
      items: dupes.length ? dupes.slice(0, 6).map(([phone, arr]) => ({
        label: `${phone}: ${arr.length} orders`,
        value: arr.map(o => o.id).join(', '),
      })) : [{ label: 'No duplicate-phone orders today', value: '' }],
    });
  }

  return out;
}

/* ---- small helpers ---- */
function count(arr, status) { return arr.filter(o => o.status === status).length; }
function pct(arr, status) { return (arr.length ? Math.round(count(arr, status) / arr.length * 100) : 0) + '%'; }
function money(arr) { return arr.reduce((s, o) => s + (o.price || 0), 0).toLocaleString() + ' DZD'; }
function group(arr, keyFn) {
  const g = {}; for (const o of arr) { const k = keyFn(o); if (!k) continue; (g[k] = g[k] || []).push(o); } return g;
}

/**
 * Deep AI analysis — feed the deterministic insights + compact context to the
 * model for an explanation + prioritized recommendations. Advisory only.
 * Returns the model's text. Throws on provider errors (caller handles).
 */
async function summarizeInsights({ providerId, agent, permissions }) {
  const insights = computeInsights(permissions);
  const context = ctx.buildContext(permissions, { range: 'today', orderLimit: 300, activeDeliveryOnly: true });

  const system = (agent && agent.systemPrompt) || ctx.PERMISSIONS;
  const messages = [
    { role: 'system', content: 'You are an analyst for a COD e-commerce CRM. You receive deterministic insights and live data. Write a concise, prioritized brief: the top 3 issues, why they matter, and the single best next action for each. Cite the real numbers. Advisory only — never claim to execute.' },
    { role: 'system', content: 'DETERMINISTIC INSIGHTS (computed from real data):\n```json\n' + JSON.stringify(insights) + '\n```' },
    { role: 'system', content: 'LIVE DATA SNAPSHOT:\n```json\n' + JSON.stringify({ analytics: context.analytics, totals: context.orders ? context.orders.length : 0 }) + '\n```' },
    { role: 'user', content: 'Give me the prioritized analysis and recommended actions.' },
  ];

  const result = await providers.chat({ providerId: agent && agent.providerId || providerId, messages, temperature: 0.4, maxTokens: 1200 });
  return result.text;
}

module.exports = { computeInsights, summarizeInsights };
