import "server-only";

import type { TenantDb } from "@landingos/db";

import { notifyQuietly } from "@/lib/platform/notifications";

/* =============================================================================
 * What the ERP tells people about — M-16.
 *
 * Every producer the ERP had, named once here so a call site reads as intent
 * rather than as an audience decision made on the spot. The audience is the
 * whole of the thinking in this file, and getting it wrong is not cosmetic: the
 * audit found `agent_overdue`, `agent_suspended`, `stale_orders`,
 * `followup_overdue` and `suspicious_call` all stored with `target: null` —
 * "everyone" — so an alert ABOUT an agent's own missed order was stored for that
 * agent to read.
 *
 * AN AUDIENCE IS A PERMISSION, NOT A ROLE. See `lib/platform/notifications.ts`.
 * The two used here:
 *
 *   erp:agents:manage — supervision OF PEOPLE. Misconduct, suspensions,
 *                       accountability. SENSITIVE, so no role grants it
 *                       implicitly and it cannot reach an agent by accident.
 *   erp:clients:read  — sees the WHOLE BOOK. Also SENSITIVE (D-05.1), and it is
 *                       already the predicate `seesWholeBook` uses to decide who
 *                       may see every order — so "supervisors of the work" is the
 *                       same set here as it is everywhere else in the product.
 *
 * Nothing raised here may fail the thing it is about: `notifyQuietly` logs and
 * returns. A confirmed call is not undone because nobody could be told about it.
 * ========================================================================== */

const ERP = "erp";

/** Sees every order — the same predicate `seesWholeBook` applies. */
const SUPERVISOR = "erp:clients:read";
/** Supervises PEOPLE — misconduct and accountability. */
const PEOPLE_MANAGER = "erp:agents:manage";
/** Actually works orders. Who an unassigned order is offered to. */
const WORKS_ORDERS = "erp:orders:write";

const label = (order: { reference: string | null; id: string }) => order.reference ?? order.id;

/* -----------------------------------------------------------------------------
 * Orders
 * -------------------------------------------------------------------------- */

/**
 * A new order arrived.
 *
 * "The single most important thing that happens in this system" — and it was
 * broadcast-only, so it disappeared on refresh and anything that arrived while
 * the console was closed was never seen at all.
 *
 * Addressed to whoever it landed on, plus the people who see the whole book. An
 * UNASSIGNED order goes to everyone who can actually work one rather than to
 * everyone in the company: the ERP broadcast to all, but a company's bookkeeper
 * being told about each incoming order is noise, and noise is what makes a feed
 * stop being read. Narrower than the ERP, deliberately.
 */
export function notifyNewOrder(
  db: TenantDb,
  tenantId: string,
  order: { id: string; reference: string | null; client: string | null; phone: string | null; agentUserId: string | null },
) {
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "new_order",
    title: `New order ${label(order)}`,
    body: [order.client, order.phone].filter(Boolean).join(" — "),
    audience: order.agentUserId
      ? { userId: order.agentUserId, permission: SUPERVISOR }
      : { permission: WORKS_ORDERS },
    entity: "order",
    entityId: order.id,
  });
}

/**
 * A call was logged that the suspicious-call rule flagged.
 *
 * MANAGER-ONLY, AND THE AGENT MUST NOT SEE IT. The flag exists because an agent
 * can clear their queue by marking orders confirmed without dialling, and being
 * paid per confirmed order for it. Telling them they were flagged tells them
 * exactly what to change.
 */
export function notifySuspiciousCall(
  db: TenantDb,
  tenantId: string,
  order: { id: string; reference: string | null },
  reason: "no call was started" | "the call was shorter than the threshold",
) {
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "suspicious_call",
    title: `Suspicious call on ${label(order)}`,
    body: reason,
    audience: { permission: PEOPLE_MANAGER },
    entity: "order",
    entityId: order.id,
  });
}

/* -----------------------------------------------------------------------------
 * Delivery
 * -------------------------------------------------------------------------- */

/**
 * A parcel reached a state somebody should know about.
 *
 * To the person chasing it — the follow-up agent if one is assigned, otherwise
 * whoever confirmed it — plus the whole-book supervisors. BUG-04 was that this
 * notification, the one the console is built to render, never arrived at all:
 * the broadcaster was called with the event name first, so clients received the
 * bare string `"delivery_update"` and the handler fell straight through.
 */
export function notifyDeliveryUpdate(
  db: TenantDb,
  tenantId: string,
  order: { id: string; reference: string | null; agentUserId: string | null; followupUserId: string | null },
  status: string,
) {
  const owner = order.followupUserId ?? order.agentUserId;
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "delivery_update",
    title: `Parcel ${label(order)} is ${status}`,
    body: "",
    audience: owner ? { userId: owner, permission: SUPERVISOR } : { permission: SUPERVISOR },
    entity: "order",
    entityId: order.id,
  });
}

/**
 * A carrier reported something needing a phone call.
 *
 * Goes to the person the task was raised against, and to supervisors — an
 * unactioned one becomes their problem when it escalates.
 */
export function notifyFollowupRaised(
  db: TenantDb,
  tenantId: string,
  order: { id: string; reference: string | null },
  reason: string,
  agentUserId: string | null,
) {
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "followup_raised",
    title: `Call the customer about ${label(order)}`,
    body: reason,
    audience: agentUserId
      ? { userId: agentUserId, permission: SUPERVISOR }
      : { permission: WORKS_ORDERS },
    entity: "order",
    entityId: order.id,
  });
}

/* -----------------------------------------------------------------------------
 * The scheduled work
 * -------------------------------------------------------------------------- */

/** Follow-up reminders nobody actioned before their countdown expired. */
export function notifyFollowupOverdue(db: TenantDb, tenantId: string, count: number) {
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "followup_overdue",
    title: `${count} follow-up reminder${count === 1 ? "" : "s"} overdue`,
    body: "Nobody acted before the countdown expired.",
    audience: { permission: SUPERVISOR },
  });
}

/**
 * Orders nobody has called for longer than `alertMinutes`.
 *
 * ONE SUMMARY PER PASS, not one per order — the ERP's own choice, and the
 * difference between a signal and a reason to mute the panel.
 */
export function notifyStaleOrders(
  db: TenantDb,
  tenantId: string,
  count: number,
  minutes: number,
) {
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "stale_orders",
    title: `${count} order${count === 1 ? "" : "s"} nobody has called`,
    body: `More than ${minutes} minutes without a call.`,
    audience: { permission: SUPERVISOR },
  });
}

/** An order sat with an agent past the threshold and the miss was counted. */
export function notifyAgentOverdue(
  db: TenantDb,
  tenantId: string,
  count: number,
  reassigned: number,
) {
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "agent_overdue",
    title: `${count} overdue order${count === 1 ? "" : "s"}`,
    body: reassigned ? `${reassigned} moved to another agent.` : "Nobody has called them.",
    audience: { permission: PEOPLE_MANAGER },
  });
}

/**
 * An account was suspended automatically.
 *
 * Manager-only, and it is the one alert where that matters most: it is about a
 * person, and it takes effect on their very next request.
 */
export function notifyAgentSuspended(db: TenantDb, tenantId: string, count: number) {
  return notifyQuietly(db, tenantId, {
    product: ERP,
    type: "agent_suspended",
    title: `${count} account${count === 1 ? "" : "s"} suspended automatically`,
    body: "The missed-order threshold was reached.",
    audience: { permission: PEOPLE_MANAGER },
  });
}
