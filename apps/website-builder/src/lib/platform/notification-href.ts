/* =============================================================================
 * Where a notification takes you — PM.4.
 *
 * NO DIRECTIVE. The provider is a client component and the shell that renders
 * it is a server one; the same mapping has to be reachable from both, so this
 * carries neither `server-only` nor `"use client"`. Same rule as
 * `notify-vocab.ts`, `edit-field.ts` and `action-errors.ts`.
 *
 * -----------------------------------------------------------------------------
 * WHAT IT CLOSES, AND IT IS THIS PROJECT'S MOST-CAUGHT SHAPE
 *
 * `Notification.entity` and `Notification.entityId` are written on every ERP
 * notification that is about one order — six of them — and stored, and returned
 * by `GET /api/platform/notifications`, and carried on every SSE frame. The
 * console read them for exactly ONE purpose: `flashEntity(payload.entityId)`,
 * which highlights the row IF you happen to already be looking at the screen it
 * is on. The panel rendered every row as a `<li>` with no link at all.
 *
 * So an operator was told "delivery problem — ORD-0042" and then had to open
 * the order list, filter or scroll to find ORD-0042, and open it. Three
 * navigations to reach a record the notification was already holding the id of.
 * A column written, stored, delivered over a live stream — and read by nothing
 * that could act on it.
 *
 * -----------------------------------------------------------------------------
 * TWO RULES THIS FOLLOWS
 *
 * **A notification with no entity still has a destination.** `followup_overdue`
 * carries a COUNT, not an id: it is "nine follow-ups are late", and the place
 * that answers it is the follow-up queue. Sending those nowhere would leave the
 * least actionable half of the feed the least reachable, which is backwards —
 * a count is exactly the notification you cannot act on from the toast.
 *
 * **An unknown type resolves to nothing rather than to a guess.** A notification
 * type added later lands in the feed and reads correctly; it simply is not a
 * link until somebody adds it here. A guessed destination that 404s is worse
 * than a row that does not move, and it is the same argument D-LP.2 makes about
 * a fabricated tracking number.
 * ========================================================================== */

/** The console prefix. The registry owns it for products; this is the one
 *  place a cross-product feed has to compose a path itself. */
const CONSOLE = "/console";

/**
 * Notification `type` → a destination that needs no entity id.
 *
 * Every key here is a `type` written by `lib/erp/notify.ts` or a platform
 * notifier, so a mapping cannot point at an event nothing raises.
 */
const BY_TYPE: Record<string, string> = {
  // Counts, not records. The queue is the answer.
  followup_overdue: `${CONSOLE}/erp/follow-up`,
  followup_raised: `${CONSOLE}/erp/follow-up`,
  followup_assigned: `${CONSOLE}/erp/follow-up`,
  // "N orders have gone unphoned" — the oldest first is the order to work them
  // in, which is why the sort is in the link rather than left to the default.
  stale_orders: `${CONSOLE}/erp/orders?status=pending&sort=createdAt&dir=asc`,
  // Supervision. Both are about PEOPLE, and the roster is where a missed-order
  // counter is reset and a suspension lifted.
  agent_overdue: `${CONSOLE}/erp/agents`,
  agent_suspended: `${CONSOLE}/erp/agents`,
  // LP.12's filter, not a screen: `suspicious=true` shares one vocabulary with
  // the list, the export and the analytics, so a flagged set can be narrowed.
  suspicious_call: `${CONSOLE}/erp/orders?suspicious=true`,
};

/**
 * Notification `entity` → the screen one of those is read on, per product.
 *
 * Keyed by product first, because `entity: "order"` means a different screen in
 * the ERP and in the builder — and a feed that is cross-product by construction
 * (M-16: one feed per person, every product they use) cannot assume one.
 *
 * -----------------------------------------------------------------------------
 * WHAT IS ACTUALLY WRITTEN TODAY, because a lookup table is the easiest place
 * in a codebase for a guess to sit and look like a fact.
 *
 * **`erp` / `order` is the only live entry.** Every ERP notification that names
 * an entity names that one — `notifyNewOrder`, `notifySuspiciousCall`,
 * `notifyDeliveryUpdate`, `notifyShipmentFailed`, `notifyFollowupRaised`,
 * `notifyOrderAssigned` and `assign.ts`. The platform's `entity: "invitation"`,
 * `"subscription"` and `"tenant"` are AUDIT rows, not notifications, and are
 * deliberately absent here.
 *
 * The rest are AHEAD OF A WRITER, and each names the work that would make it
 * reachable — the discipline AUDIT.8's exemption list uses for a schema column.
 * They are kept rather than deleted because every destination below was checked
 * against the routes that exist; an entry that had gone stale would send
 * somebody to a 404, which is the failure this file exists to avoid.
 */
const BY_ENTITY: Record<string, Record<string, (id: string) => string>> = {
  erp: {
    // LIVE.
    order: (id) => `${CONSOLE}/erp/orders/${id}`,
    // Ahead of a writer: a "duplicate customer" or "correction needed" notice.
    client: (id) => `${CONSOLE}/erp/clients/${id}`,
    // Ahead of a writer: a stock alert raised by a job rather than read off the
    // dashboard.
    product: (id) => `${CONSOLE}/erp/products/${id}`,
    // Ahead of a writer, and NOT `/shipments/{id}` — there is no shipment
    // detail screen, so the id is deliberately dropped rather than composed
    // into a path that does not exist.
    shipment: () => `${CONSOLE}/erp/shipments`,
    salesChannel: () => `${CONSOLE}/erp/sales-channels`,
    carrier: () => `${CONSOLE}/erp/carriers`,
  },
  "website-builder": {
    // Both ahead of a writer: the builder raises no notifications yet.
    order: (id) => `${CONSOLE}/builder/orders/${id}`,
    // `/edit`, because that is the route that exists — `/pages/{id}` is not a
    // screen, and this is exactly the kind of plausible-looking path a mapping
    // table acquires without anybody checking.
    landingPage: (id) => `${CONSOLE}/builder/pages/${id}/edit`,
  },
};

export interface NotificationRef {
  readonly product: string;
  readonly type: string | null;
  readonly entity: string | null;
  readonly entityId: string | null;
}

/**
 * Where this notification should open, or `null` when there is nowhere honest
 * to send somebody.
 *
 * The ENTITY wins over the type: `delivery_update` on order X is about order X,
 * and its type-level fallback would be a list. The type only answers for the
 * notifications that carry a count instead of an id.
 */
export function notificationHref(n: NotificationRef): string | null {
  if (n.entity && n.entityId) {
    const resolver = BY_ENTITY[n.product]?.[n.entity];
    if (resolver) return resolver(n.entityId);
  }
  return BY_TYPE[n.type ?? ""] ?? null;
}
