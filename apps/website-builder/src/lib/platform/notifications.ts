import "server-only";

import { can, type TenantRole } from "@landingos/auth";
import type { Prisma, TenantDb } from "@landingos/db";

import { pushToUsers } from "./push";

/* =============================================================================
 * Notifications — M-16.
 *
 * A PLATFORM service, not an ERP one. `Notification` moved to `platform.prisma`
 * in Phase 3.2 because the vision names notifications a shared service, and this
 * is the other half of that decision: one surface, one read model, one badge, and
 * a `product` column so a tenth product raises into it by calling `notify` rather
 * than by building its own.
 *
 * -----------------------------------------------------------------------------
 * THE AUDIENCE IS DECIDED ONCE, AT WRITE TIME — one row per recipient.
 *
 * The ERP stored one row with a free-text `target` ('' | 'manager' | an agent's
 * name) and interpreted it on every read. Every notification bug the audit found
 * lived in that interpretation: `target` was accepted by `push()` and had no
 * column to land in, so the live hop was targeted and the stored row was not; and
 * the alerts ABOUT an agent's own misconduct were stored with `target: null`,
 * meaning "everyone", for that agent to read.
 *
 * Fanning out on write removes the class. A read is `targetUserId = me` — one
 * indexed predicate, no role logic, nothing to get wrong later. It is also what
 * the schema already expects: `@@index([tenantId, targetUserId, readAt])` is an
 * index for exactly this query, and `readAt` on the row is only meaningful when
 * the row belongs to one person.
 *
 * The cost is rows. A company-wide notification writes one per member — tens,
 * for a call centre — and `pruneNotifications` bounds the table. That is the
 * right trade against a read-time audience rule that has already leaked once.
 *
 * -----------------------------------------------------------------------------
 * AN AUDIENCE IS NAMED BY A PERMISSION, NEVER BY A ROLE LIST.
 *
 * "Managers only" is not a thing the platform can evaluate — MANAGER, ADMIN and
 * OWNER all supervise, and a MEMBER with an explicit grant may too. So a producer
 * says WHICH PERMISSION the recipient must hold and `can()` decides, exactly as
 * it decides the route. One rule: an alert about an agent's missed orders goes to
 * whoever may manage agents, by definition rather than by convention.
 *
 * It also means entitlement is checked for free — a member of a tenant that
 * dropped the ERP stops receiving the ERP's alerts without anybody editing a
 * membership.
 * ========================================================================== */

/** Who a notification is for. Exactly one of these shapes. */
export type Audience =
  /** One person: their own order, their own parcel. */
  | { readonly userId: string }
  /** Everybody who holds this permission — supervision alerts. */
  | { readonly permission: string }
  /**
   * The person it concerns AND their supervisors.
   *
   * The ERP's `'<agent name>'` target, which it documented as "that agent, plus
   * managers". Used where both need to know and neither is the primary reader.
   */
  | { readonly userId: string; readonly permission: string };

export interface NotificationInput {
  /** A product-registry id, or "platform". Never used to decide visibility. */
  readonly product: string;
  /** Machine type — `new_order`, `delivery_update`, `agent_overdue`. */
  readonly type: string;
  readonly title: string;
  readonly body?: string;
  readonly audience: Audience;
  /** What it is about, as loose references — deliberately not foreign keys. */
  readonly entity?: string;
  readonly entityId?: string;
}

/**
 * Everybody in this tenant who should receive it.
 *
 * A membership is read once and `can()` answers per person, so the entitlement
 * gate rides along: a tenant whose subscription lapsed has nobody holding the
 * product's permissions and therefore nobody to notify.
 */
async function recipients(db: TenantDb, audience: Audience): Promise<string[]> {
  const named = "userId" in audience ? audience.userId : null;
  const permission = "permission" in audience ? audience.permission : null;

  // The common case by a distance: an order's own agent. No roster read at all.
  if (named && !permission) return [named];

  const entitlements = await db.subscription
    .findFirst({ select: { entitlements: true } })
    .then((s) =>
      Array.isArray(s?.entitlements) ? (s.entitlements as unknown[]).map(String) : [],
    );

  const members = await db.membership.findMany({
    // A suspended member is not a recipient. They cannot act on it, and their
    // session is already refused on the next request (M-09).
    where: { suspended: false },
    select: { userId: true, role: true, permissions: true },
  });

  const out = new Set<string>(named ? [named] : []);
  for (const member of members) {
    if (
      permission &&
      can(
        {
          userId: member.userId,
          tenantId: "",
          role: member.role as TenantRole,
          permissions: Array.isArray(member.permissions)
            ? (member.permissions as unknown[]).map(String)
            : [],
          entitlements,
        },
        permission,
      )
    ) {
      out.add(member.userId);
    }
  }
  return [...out];
}

/**
 * Store a notification for everybody it is for.
 *
 * Returns the ids written, which is nothing when the audience is empty — a
 * tenant with no manager gets no manager alerts, and that is correct rather than
 * an error.
 *
 * NOTHING HERE MAY THROW INTO A CALLER'S WORK. A notification is a message about
 * something that already happened; failing an order because we could not tell
 * anybody about it would be trading the thing for the announcement. Callers use
 * `notifyQuietly`.
 */
export async function notify(
  db: TenantDb,
  tenantId: string,
  input: NotificationInput,
): Promise<number> {
  const targets = await recipients(db, input.audience);
  if (targets.length === 0) return 0;

  const audienceRole =
    "permission" in input.audience && !("userId" in input.audience) ? "MANAGER" : null;

  const { count } = await db.notification.createMany({
    data: targets.map((userId) => ({
      tenantId,
      product: input.product,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      targetUserId: userId,
      // Kept for the record, so a reader can tell a supervision alert from
      // something addressed to them personally. It is NOT consulted on read.
      targetRole: audienceRole as never,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
    })),
  });

  // STORED FIRST, PUSHED AFTER, and the order is the point: the feed is the
  // record and the push is a doorbell. A push that fails changes nothing about
  // what the console shows, and a deployment with no VAPID keys is fully
  // functional — it simply does not ring anybody's phone.
  await pushToUsers(db, targets, {
    title: input.title,
    body: input.body ?? "",
    url: "/console",
  }).catch((error) => {
    console.error("[notify] push failed", error);
    return 0;
  });

  return count;
}

/** `notify`, with any failure logged instead of raised. */
export async function notifyQuietly(
  db: TenantDb,
  tenantId: string,
  input: NotificationInput,
): Promise<number> {
  try {
    return await notify(db, tenantId, input);
  } catch (error) {
    // Logged, never silent: BUG-01 was a subsystem whose only symptom was that
    // nothing happened.
    console.error(`[notify] ${input.type} failed`, error);
    return 0;
  }
}

/* -----------------------------------------------------------------------------
 * Reading
 * -------------------------------------------------------------------------- */

const NOTIFICATION_SELECT = {
  id: true, product: true, type: true, title: true, body: true,
  targetRole: true, entity: true, entityId: true, readAt: true, createdAt: true,
} satisfies Prisma.NotificationSelect;

export interface NotificationView {
  id: string;
  product: string;
  type: string | null;
  title: string | null;
  body: string | null;
  targetRole: string | null;
  entity: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

/**
 * This account's own notifications, newest first.
 *
 * `targetUserId` is not a filter a caller may influence. The ERP accepted
 * `?agent=` on three separate endpoints and honoured it, which is why
 * `hardening.test.js §7` exists; there is no parameter here that could.
 *
 * The id is a BigInt in the database and a STRING on the wire.
 * `JSON.stringify(1n)` is a TypeError, not a fallback (see `toJson`), and the
 * cursor a client sends back has to survive the round trip.
 */
export async function listNotifications(
  db: TenantDb,
  userId: string,
  opts: { readonly limit?: number; readonly beforeId?: string | null } = {},
): Promise<NotificationView[]> {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const before = opts.beforeId ? BigInt(opts.beforeId) : null;

  const rows = await db.notification.findMany({
    where: {
      targetUserId: userId,
      ...(before !== null ? { id: { lt: before } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit,
    select: NOTIFICATION_SELECT,
  });

  return rows.map((row) => ({
    id: row.id.toString(),
    product: row.product,
    type: row.type,
    title: row.title,
    body: row.body,
    targetRole: row.targetRole as string | null,
    entity: row.entity,
    entityId: row.entityId,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Everything newer than `afterId`, OLDEST FIRST — the live stream's query.
 *
 * Ascending on purpose, unlike `listNotifications`: the stream replays in the
 * order things happened and moves its cursor to the last row it sent, so a
 * descending page would leave the cursor at the OLDEST of the batch and resend
 * the rest forever.
 *
 * Bounded, because a client reconnecting after a week must not be handed ten
 * thousand frames in one burst. It catches up over a few ticks instead.
 */
export async function since(
  db: TenantDb,
  userId: string,
  afterId: string,
  limit = 50,
): Promise<NotificationView[]> {
  const after = afterId ? BigInt(afterId) : null;
  const rows = await db.notification.findMany({
    where: {
      targetUserId: userId,
      ...(after !== null ? { id: { gt: after } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit,
    select: NOTIFICATION_SELECT,
  });

  return rows.map((row) => ({
    id: row.id.toString(),
    product: row.product,
    type: row.type,
    title: row.title,
    body: row.body,
    targetRole: row.targetRole as string | null,
    entity: row.entity,
    entityId: row.entityId,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** The badge. Exactly the rows this account can see and has not read. */
export async function unreadCount(db: TenantDb, userId: string): Promise<number> {
  return db.notification.count({ where: { targetUserId: userId, readAt: null } });
}

/**
 * Mark this account's notifications read, up to and including `upToId`.
 *
 * `upToId` is the newest id the client has actually DISPLAYED. Passing it —
 * rather than "mark everything" — means a notification that arrives between the
 * panel rendering and the click is not silently swallowed.
 *
 * IT CANNOT BE POISONED, and the ERP's version could: an unclamped
 * `{"upToId": 999999999}` parked the watermark in the future and suppressed that
 * account's badge until a million notifications had been raised. There is no
 * watermark here to park — marking read is an UPDATE over rows that exist, so an
 * id beyond the newest matches the rows that exist and nothing more, and the very
 * next notification is unread like any other. Junk values fall back to "all
 * currently visible", which is what the button means.
 */
export async function markRead(
  db: TenantDb,
  userId: string,
  upToId?: unknown,
): Promise<number> {
  let ceiling: bigint | null = null;
  if (typeof upToId === "string" || typeof upToId === "number") {
    try {
      const parsed = BigInt(upToId);
      // `> BigInt(0)` rather than `> 0n`: the tsconfig target predates BigInt
      // literals, and a literal here is a compile error rather than a runtime one.
      if (parsed > BigInt(0)) ceiling = parsed;
    } catch {
      // Not a number. Fall through to "everything", below.
    }
  }

  const { count } = await db.notification.updateMany({
    where: {
      targetUserId: userId,
      readAt: null,
      ...(ceiling !== null ? { id: { lte: ceiling } } : {}),
    },
    data: { readAt: new Date() },
  });
  return count;
}

/**
 * Keep the newest `keep` rows for this tenant and delete the rest.
 *
 * A feed, not an audit record — `AuditEvent` is that, and it is append-only for
 * a reason. Without a retention policy this table grows forever; the ERP's own
 * ran hourly.
 */
export async function pruneNotifications(db: TenantDb, keep = 5000): Promise<number> {
  const cutoff = await db.notification.findMany({
    orderBy: { id: "desc" },
    skip: keep,
    take: 1,
    select: { id: true },
  });
  if (cutoff.length === 0) return 0;

  const { count } = await db.notification.deleteMany({
    where: { id: { lte: cutoff[0].id } },
  });
  return count;
}
