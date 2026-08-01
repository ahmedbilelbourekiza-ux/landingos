/* =============================================================================
 * lib/followup.js — Order Follow-up (Suivi des Commandes) department (req §1).
 *
 * Three agent roles, stored on the `agents` table:
 *   - confirmation : confirms orders (the existing flow)
 *   - followup     : tracks shipments, contacts customers on delivery issues
 *   - both         : does confirmation AND follow-up
 *
 * Responsibilities:
 *   1. Automatic + manual assignment of a follow-up agent when an order is
 *      confirmed and sent to a delivery company. Workload-balanced.
 *   2. Call-reminder system: certain delivery statuses require calling the
 *      customer (unavailable / delivery failed / returned to agency / address
 *      problem / customer delay). When such a status arrives, a follow-up task
 *      is auto-created with a configurable countdown; if the agent doesn't act
 *      before it expires, the order is highlighted and the manager is notified.
 *   3. The Suivi dashboard: orders grouped into actionable buckets.
 * ========================================================================== */

const db = require('./db');
const { CRM_STATUS_LABEL } = require('./statusMap');

/* Delivery CRM statuses that REQUIRE a customer call. The original (carrier)
 * status text is also keyword-matched so we catch native strings like
 * "Client absent", "Adresse erronée", "Reporté par le client", etc. */
const CALL_REQUIRED_CRM_STATUSES = ['refused', 'returned'];
const CALL_REQUIRED_KEYWORDS = [
  /absent|unavailable|injoignable|injoignable/i,
  /fail|échec|echec|échouée|echouee/i,
  /retour|return/i,
  /adresse|address|erronée|erronee/i,
  /report|delay|délai|delai|postpone/i,
  /annul.*client|client.*annul|refus/i,
  /bureau|agence|office/i,    // returned-to-agency / held at office needing contact
];

function statusRequiresCall(crmStatus, originalStatus = '') {
  if (crmStatus && CALL_REQUIRED_CRM_STATUSES.includes(crmStatus)) return true;
  const text = `${crmStatus || ''} ${originalStatus || ''}`.trim();
  if (text && CALL_REQUIRED_KEYWORDS.some(re => re.test(text))) return true;
  return false;
}

/* ---------------------------------------------------------------------------
 * Follow-up agent assignment (workload-balanced, role-aware).
 * Mirrors the autoAssign() pattern in index.js but scoped to followup/both.
 * ------------------------------------------------------------------------- */

/** Current open follow-up workload per agent name. */
function workloadByAgent() {
  const counts = {};
  for (const a of db.getAgentsByRole('followup')) counts[a.name] = 0;
  for (const o of db.loadOrdersData().orders) {
    if (o.followupAgent && counts[o.followupAgent] !== undefined) counts[o.followupAgent]++;
  }
  return counts;
}

/**
 * Assign a follow-up agent to an order.
 *   - opts.agent  : explicit manual reassignment (overrides auto-assign)
 *   - opts.auto   : when true and no explicit agent, workload-balance across
 *                   followup/both agents (only if the setting is enabled)
 * Returns the chosen agent name ('' when none available / disabled).
 */
function assignFollowup(orderId, opts = {}) {
  const eligible = db.getAgentsByRole('followup');
  if (!eligible.length) return '';

  let chosen = '';
  if (opts.agent && eligible.some(a => a.name === opts.agent)) {
    chosen = opts.agent;
  } else if (opts.auto || db.getSettings().followupAutoAssign) {
    const counts = workloadByAgent();
    // Round-robin to the least-loaded eligible agent.
    chosen = eligible.reduce((min, a) =>
      (counts[a.name] || 0) < (counts[min.name] || 0) ? a : min, eligible[0]).name;
  }

  if (chosen) {
    db.patchOrder(orderId, { followupAgent: chosen, followupAssignedAt: Date.now() });
    db.audit('order', orderId, 'followup_assign', opts.actor || 'system', { agent: chosen });
  }
  return chosen;
}

/** Manual reassignment convenience wrapper. */
function reassign(orderId, agent, actor = 'admin') {
  return assignFollowup(orderId, { agent, actor });
}

/* ---------------------------------------------------------------------------
 * Call-reminder system — auto task on delivery statuses + countdown + escalation.
 * ------------------------------------------------------------------------- */

/**
 * Handle an inbound delivery status for an order. If the status requires a
 * customer call, create a follow-up task with a countdown (configurable via
 * followupReminderMinutes) and stamp the order's call-reminder fields.
 *
 * Returns the created task (or null when no call is required / a task exists).
 */
function onDeliveryStatus(orderId, { crmStatus, originalStatus = '', description = '' }, actor = 'system') {
  if (!statusRequiresCall(crmStatus, originalStatus)) return null;
  const order = db.getOrder(orderId);
  if (!order) return null;

  // Avoid duplicate reminders: if there's already an open task for this order,
  // refresh its countdown instead of creating a new one.
  const minutes = Number(db.getSettings().followupReminderMinutes) || 120;
  const dueAt = Date.now() + minutes * 60 * 1000;
  const reason = description || CRM_STATUS_LABEL[crmStatus] || originalStatus || crmStatus || '';

  const existing = db.getOpenFollowupForOrder(orderId, 'call_customer');
  const task = db.saveFollowupTask({
    id: existing?.id,
    orderId,
    type: 'call_customer',
    status: 'open',
    dueAt,
    agent: order.followupAgent || existing?.agent || '',
    reason,
  });

  db.patchOrder(orderId, { callReminderDue: dueAt, callReminderStatus: 'pending' });
  db.audit('order', orderId, 'followup_reminder_created', actor, { dueAt, reason });
  return task;
}

/** Mark a reminder resolved (the agent called the customer). */
function resolveReminder(orderId, taskId, actor = 'agent') {
  if (taskId) db.resolveFollowupTask(taskId);
  if (orderId) db.patchOrder(orderId, { callReminderStatus: 'done' });
  db.audit('order', orderId || '', 'followup_reminder_resolved', actor, {});
}

/**
 * Sweep all open reminders whose countdown has expired. For each, mark it
 * overdue, highlight the order, and notify the manager. Intended to run on the
 * jobs loop (cheap: bounded by the number of open tasks).
 *
 * `notify({type,title,body,orderId,target})` is injected from index.js so this
 * module stays decoupled from the SSE/notification layer.
 */
function sweepOverdue(notify) {
  const overdue = db.listOverdueFollowupTasks();
  const escalated = [];
  for (const task of overdue) {
    db.markFollowupOverdue(task.id);
    const order = db.getOrder(task.orderId);
    if (order) {
      db.patchOrder(task.orderId, { callReminderStatus: 'overdue' });
      db.audit('order', task.orderId, 'followup_overdue', 'jobs', { taskId: task.id });
      escalated.push({ task, order });
    }
  }
  if (escalated.length && notify) {
    notify({
      type: 'followup_overdue',
      title: '⏰ ' + escalated.length + ' rappel(s) de suivi en retard',
      body: escalated.map(e => e.order.id).join(', '),
      orderId: '',
    });
  }
  return escalated;
}

/* ---------------------------------------------------------------------------
 * Suivi dashboard — orders grouped into 5 actionable buckets (req §1).
 * ------------------------------------------------------------------------- */

/** Is an order actively in delivery (has a shipment, not terminal)? */
function isInDelivery(order) {
  const TERMINAL = ['delivered', 'refused', 'returned', 'cancelled'];
  if (!order.deliveryStatus && !order.shipmentId) return false;
  if (order.classification === 'fake') return false;
  // Heuristic: once confirmed with a shipment and not terminal, it's "in delivery".
  const lastCrm = order.deliveryStatus || '';
  return !!order.shipmentId || (order.status === 'confirmed' && !TERMINAL.some(t => (lastCrm || '').toLowerCase().includes(t)));
}

function dashboard() {
  const orders = db.loadOrdersData().orders;
  const tasks = db.getFollowupTasks({ status: 'open' });
  const overdueTasks = db.getFollowupTasks({ status: 'overdue' });
  const tasksByOrder = {};
  for (const t of [...tasks, ...overdueTasks]) tasksByOrder[t.orderId] = t;

  const confirmed = orders.filter(o => o.status === 'confirmed' && o.classification !== 'fake');

  const buckets = {
    waitingFollowup: [],  // confirmed + sent to carrier, no follow-up agent yet
    inDelivery: [],       // in delivery, on track
    needsContact: [],     // a call-reminder task is open (countdown running)
    problems: [],         // delivery issue but not yet overdue (refused/returned etc.)
    escalation: [],       // overdue reminders
  };

  for (const o of confirmed) {
    const task = tasksByOrder[o.id];
    const isOverdue = o.callReminderStatus === 'overdue' || (task && task.status === 'overdue');
    const needsCall = o.callReminderStatus === 'pending' || (task && task.status === 'open');

    if (isOverdue) {
      buckets.escalation.push(o);
    } else if (needsCall) {
      buckets.needsContact.push(o);
    } else if (o.callReminderStatus !== 'pending') {
      // No active reminder — check the delivery state.
      const hasProblem = CALL_REQUIRED_CRM_STATUSES.some(s => (o.deliveryStatus || '').toLowerCase().includes(s));
      if (hasProblem) buckets.problems.push(o);
      else if (isInDelivery(o) && !o.followupAgent) buckets.waitingFollowup.push(o);
      else if (isInDelivery(o)) buckets.inDelivery.push(o);
    }
  }

  return {
    counts: {
      waitingFollowup: buckets.waitingFollowup.length,
      inDelivery: buckets.inDelivery.length,
      needsContact: buckets.needsContact.length,
      problems: buckets.problems.length,
      escalation: buckets.escalation.length,
    },
    buckets,
    openTasks: tasks,
    overdueTasks,
  };
}

module.exports = {
  CALL_REQUIRED_CRM_STATUSES,
  statusRequiresCall,
  assignFollowup,
  reassign,
  onDeliveryStatus,
  resolveReminder,
  sweepOverdue,
  dashboard,
  workloadByAgent,
};
