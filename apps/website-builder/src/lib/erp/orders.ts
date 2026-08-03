import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { nextReference } from "./ids";
import { normalizePhone } from "./phone";
import { toDecimal } from "./serialize";
import { syncClientFromOrder, type OrderStatsView } from "./clients";

/* =============================================================================
 * The order repository.
 *
 * Ported from queryOrders / insertOrder / saveOrder / patchOrder / addCall in
 * apps/erp/lib/db.js.
 *
 * The vocabularies below are stored as free-form strings, exactly as the ERP
 * stored them, and validated at the edge. That is deliberate: an enum column
 * would need a migration every time the call-centre invents a new outcome, and
 * "tentative3" was invented after the schema was written.
 * ========================================================================== */

export const ORDER_STATUSES = [
  "pending", "no_answer", "callback", "confirmed", "cancelled",
  "tentative1", "tentative2", "tentative3", "unreachable", "abandoned",
] as const;

/** `pending` is NOT a call result — it is where an order starts, not an outcome. */
export const CALL_RESULTS = [
  "no_answer", "callback", "confirmed", "cancelled",
  "tentative1", "tentative2", "tentative3", "unreachable",
] as const;

export const NOTE_TYPES = [
  "client_called_back", "complaint", "address_change", "client_instructions", "other",
] as const;

export const CLASSIFICATIONS = ["", "fake"] as const;

/**
 * Statuses an order does not move on from by being called again.
 *
 * `abandoned` belongs here with the other two: it is a cart nobody completed,
 * not a customer waiting for a phone call.
 */
export const TERMINAL_STATUSES = ["confirmed", "cancelled", "abandoned"] as const;

/**
 * What the agent's queue holds — Phase 6.4.
 *
 * DERIVED by subtraction rather than listed. The ERP wrote the seven out by hand
 * in three separate places (`agent.html` twice, `index.js` once), which is three
 * places to forget when the call-centre invents an outcome — and "tentative3"
 * proves they do. Subtracting the terminal set means a status added later lands
 * in the queue by default, which is the safe direction: an agent seeing an order
 * they need not have called is a moment's confusion, an order that silently
 * never appears is a customer nobody rings.
 */
export const ACTIVE_STATUSES = ORDER_STATUSES.filter(
  (s) => !(TERMINAL_STATUSES as readonly string[]).includes(s),
);

/* -----------------------------------------------------------------------------
 * Which fields a client may write, and who counts as a client
 * -------------------------------------------------------------------------- */

/**
 * Writable by anyone who may touch the order at all.
 *
 * Everything absent from this list and the manager list below is dropped, which
 * is the whole of audit §4: `PUT /api/orders/:id` used to spread the request
 * body straight into storage, and one request carrying
 * `{"deliveryOutcome":"delivered","price":999999}` fabricated 999,999 of
 * customer lifetime revenue out of nothing.
 *
 * An allow-list rather than a deny-list on purpose. A deny-list is wrong the
 * next time a column is added, and it is wrong silently.
 */
const AGENT_WRITABLE = [
  "client", "phone", "wilaya", "commune", "city",
  "product", "productVariant", "quantity",
  "note", "shippingNote", "deliveryMethod", "expressDelivery",
  "status",
] as const;

/**
 * Additionally writable by someone who may see the whole book.
 *
 * `price` is here because it is what payroll and the profit calculator are
 * computed from — correcting the address on your own order is the job, editing
 * the money on it is not.
 */
const MANAGER_WRITABLE = [
  "managerNote", "marketer", "brand",
  "price", "unitPrice", "subtotal", "discount", "shippingCost",
  "carrierCode", "carrierId",
  "orderType", "lineItems",
] as const;

/**
 * Reassignment is a manager action and is refused LOUDLY rather than dropped.
 *
 * The difference matters: silently ignoring `agentUserId` would let an agent
 * believe they had picked up work, and the ERP's own test asserts a 403 with
 * `FORBIDDEN_FIELD` so the UI can say why.
 */
export const REASSIGNMENT_FIELDS = ["agentUserId", "followupUserId"] as const;

const MONEY_FIELDS = new Set(["price", "unitPrice", "subtotal", "discount", "shippingCost"]);
const NUMBER_FIELDS = new Set(["quantity"]);
const BOOLEAN_FIELDS = new Set(["expressDelivery"]);

export interface PatchResult {
  readonly data: Prisma.FulfillmentOrderUpdateInput;
  /** A field that must produce a 403 rather than being quietly dropped. */
  readonly forbiddenField: string | null;
  readonly invalid: string | null;
}

/**
 * Turn a request body into an update payload.
 *
 * Anything not named is dropped without comment — including `id`, `tenantId`,
 * `deliveryOutcome`, `phoneNormalized`, `shipmentId`, `overdueFlaggedAt` and
 * `__proto__`. They are not enumerated as exclusions because the allow-list
 * already excludes everything; listing them would imply the list is exhaustive
 * and invite additions.
 */
export function buildPatch(
  body: unknown,
  opts: { readonly isManager: boolean; readonly current: { agentUserId: string | null; followupUserId: string | null } },
): PatchResult {
  const input = (body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  for (const field of REASSIGNMENT_FIELDS) {
    if (input[field] === undefined) continue;
    const next = input[field] === null ? null : String(input[field]);
    if (next === opts.current[field]) continue;
    if (!opts.isManager) return { data: {}, forbiddenField: field, invalid: null };
    data[field] = next;
  }

  const allowed: readonly string[] = opts.isManager
    ? [...AGENT_WRITABLE, ...MANAGER_WRITABLE]
    : AGENT_WRITABLE;

  for (const field of allowed) {
    const value = input[field];
    if (value === undefined) continue;

    if (field === "status") {
      if (!ORDER_STATUSES.includes(String(value) as (typeof ORDER_STATUSES)[number])) {
        return { data: {}, forbiddenField: null, invalid: `invalid status "${value}"` };
      }
      data.status = String(value);
      continue;
    }

    if (MONEY_FIELDS.has(field)) {
      const decimal = toDecimal(value);
      if (decimal === null && value !== null) {
        return { data: {}, forbiddenField: null, invalid: `"${field}" must be a number` };
      }
      data[field] = decimal;
      continue;
    }

    if (NUMBER_FIELDS.has(field)) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return { data: {}, forbiddenField: null, invalid: `"${field}" must be a number` };
      }
      data[field] = Math.trunc(n);
      continue;
    }

    if (BOOLEAN_FIELDS.has(field)) {
      data[field] = Boolean(value);
      continue;
    }

    if (field === "lineItems") {
      data[field] = value as Prisma.InputJsonValue;
      continue;
    }

    data[field] = value === null ? null : String(value);
  }

  // Both written from one place, so they cannot disagree — see the note on the
  // create route for why the stored phone is the normalised form too.
  if (typeof data.phone === "string") {
    const normalized = normalizePhone(data.phone);
    data.phone = normalized;
    data.phoneNormalized = normalized;
  }

  return { data: data as Prisma.FulfillmentOrderUpdateInput, forbiddenField: null, invalid: null };
}

/* -----------------------------------------------------------------------------
 * Reading
 * -------------------------------------------------------------------------- */

/**
 * What a list page returns.
 *
 * Call history is deliberately absent and `_count` is used instead. Attaching
 * it per row is what made the old endpoint quadratic — 3,006 ms on 5,000
 * orders — and the list only ever rendered the number.
 */
export const ORDER_LIST_SELECT = {
  id: true, reference: true, client: true, phone: true, phoneNormalized: true,
  wilaya: true, commune: true, city: true,
  product: true, productVariant: true, quantity: true,
  price: true, status: true, orderType: true, classification: true,
  agentUserId: true, followupUserId: true, followupAssignedAt: true,
  carrierCode: true, deliveryStatus: true, deliveryOutcome: true, deliveryOutcomeAt: true,
  trackingNumber: true, shipmentId: true,
  marketer: true, managerNote: true, note: true,
  externalId: true, externalName: true, source: true, salesChannelId: true,
  overdueFlaggedAt: true, pendingCallStart: true,
  createdAt: true, updatedAt: true,
  _count: { select: { calls: true } },
} satisfies Prisma.FulfillmentOrderSelect;

const ORDER_SORT_COLUMNS: Record<string, keyof Prisma.FulfillmentOrderOrderByWithRelationInput> = {
  createdAt: "createdAt",
  price: "price",
  client: "client",
  status: "status",
  updatedAt: "updatedAt",
};

/**
 * Resolve `?sort=` against a whitelist.
 *
 * An unknown column falls back to `createdAt` rather than erroring, which is
 * what the ERP did and what its test asserts: a stale bookmark carrying a sort
 * that no longer exists should render the list, not a 400. The whitelist is
 * what makes `?sort=price;DROP TABLE...` a no-op — the value never reaches SQL.
 */
export function orderSort(
  sort: string | null,
  dir: string | null,
): Prisma.FulfillmentOrderOrderByWithRelationInput[] {
  const column = ORDER_SORT_COLUMNS[sort ?? ""] ?? "createdAt";
  const direction: Prisma.SortOrder = String(dir).toLowerCase() === "asc" ? "asc" : "desc";
  // The id tiebreak keeps paging stable: without it, rows sharing a createdAt
  // can come back in a different order on each page and an order is then
  // either seen twice or missed entirely.
  return [{ [column]: direction }, { id: direction }];
}

/** Translate query parameters into a `where`. Every value is bound by Prisma. */
export function orderFilters(params: URLSearchParams): Prisma.FulfillmentOrderWhereInput {
  const where: Prisma.FulfillmentOrderWhereInput = {};
  const get = (k: string) => params.get(k)?.trim() || undefined;

  const status = get("status");
  if (status) where.status = status;
  const agentUserId = get("agentUserId");
  if (agentUserId) where.agentUserId = agentUserId;
  const followupUserId = get("followupUserId");
  if (followupUserId) where.followupUserId = followupUserId;
  const wilaya = get("wilaya");
  if (wilaya) where.wilaya = wilaya;
  const salesChannelId = get("salesChannelId");
  if (salesChannelId) where.salesChannelId = salesChannelId;
  const orderType = get("orderType");
  if (orderType) where.orderType = orderType;
  const classification = get("classification");
  if (classification) where.classification = classification;
  const deliveryOutcome = get("deliveryOutcome");
  if (deliveryOutcome) where.deliveryOutcome = deliveryOutcome;

  const since = get("since");
  const until = get("until");
  if (since || until) {
    where.createdAt = {
      ...(since ? { gte: new Date(Number(since)) } : {}),
      ...(until ? { lte: new Date(Number(until)) } : {}),
    };
  }

  const search = get("search");
  if (search) {
    // `mode: insensitive` is not optional here. Postgres LIKE is
    // case-sensitive where SQLite's was not, so without it the search box
    // keeps working for anyone who types the same capitalisation as the stored
    // value — which is most of the time, which is why it survives review.
    where.OR = [
      { client: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { phoneNormalized: { contains: normalizePhone(search) || search } },
      // The reference, not the id: "ORD-0042" is what a customer reads back
      // over the phone, and searching the cuid would match nothing a human
      // could have typed.
      { reference: { contains: search, mode: "insensitive" } },
      { product: { contains: search, mode: "insensitive" } },
      { externalName: { contains: search, mode: "insensitive" } },
      { trackingNumber: { contains: search } },
    ];
  }
  return where;
}

/* -----------------------------------------------------------------------------
 * Writing
 * -------------------------------------------------------------------------- */

const STATS_VIEW = {
  status: true, deliveryOutcome: true, price: true,
  phone: true, client: true, wilaya: true, commune: true, createdAt: true,
} satisfies Prisma.FulfillmentOrderSelect;

/**
 * Create an order and bring the customer registry with it.
 *
 * One transaction, because `withTenant` has already opened one — these
 * statements are atomic together without any `$transaction` call, and adding
 * one would throw: Prisma does not nest, so the client handed back here has no
 * `$transaction` at all.
 */
export async function createOrder(
  db: TenantDb,
  tenantId: string,
  // `id` is omitted rather than optional: it comes from the tenant sequence and
  // a caller supplying one would sidestep the counter, so the type refuses it.
  input: Omit<Prisma.FulfillmentOrderUncheckedCreateInput, "id">,
) {
  const created = await db.fulfillmentOrder.create({
    data: { ...input, tenantId, reference: await nextReference(db, tenantId, "order") },
    select: { ...STATS_VIEW, id: true },
  });
  await syncClientFromOrder(db, tenantId, null, created);
  return created.id;
}

/** The fields whose transitions the lifetime counters key off. */
const STAT_RELEVANT = ["status", "deliveryOutcome", "price", "phone", "product", "quantity"] as const;

/**
 * Apply a patch, and resync the customer registry only if something it depends
 * on actually moved (audit PERF-03).
 *
 * The ERP's version read the order five times for a single field change. This
 * reads it twice — once for the before-state the counters need, once after.
 */
export async function updateOrder(
  db: TenantDb,
  tenantId: string,
  id: string,
  data: Prisma.FulfillmentOrderUpdateInput,
): Promise<void> {
  const before = await db.fulfillmentOrder.findUnique({ where: { id }, select: STATS_VIEW });
  if (!before) return;

  await db.fulfillmentOrder.update({ where: { id }, data });

  const touched = STAT_RELEVANT.some((f) => f in (data as Record<string, unknown>));
  if (!touched) return;

  const after = await db.fulfillmentOrder.findUnique({ where: { id }, select: STATS_VIEW });
  if (after) await syncClientFromOrder(db, tenantId, before as OrderStatsView, after);
}

/**
 * Log a call attempt.
 *
 * `suspicious` is the point of this function. A call shorter than the
 * configured threshold, or one logged with no `call-start` at all, is flagged —
 * because the alternative is an agent clearing their queue by marking orders
 * confirmed without dialling, and being paid per confirmed order for it.
 *
 * It is a NULLABLE boolean and stays that way: null means "not evaluated",
 * which is what a standalone note is. Folding null to false would reclassify
 * every note as an assessed, clean call.
 */
export async function addCall(
  db: TenantDb,
  tenantId: string,
  order: { id: string; pendingCallStart: Date | null },
  input: {
    readonly result?: string | null;
    readonly note?: string | null;
    readonly noteType?: string | null;
    readonly agentUserId: string;
    readonly minCallSeconds: number;
  },
) {
  const now = new Date();
  const started = order.pendingCallStart;
  const duration = started ? Math.round((now.getTime() - started.getTime()) / 1000) : null;

  // A result with no call-start is flagged as such and separately from a short
  // call, so a manager reviewing the audit trail can tell "hung up in four
  // seconds" from "never dialled at all".
  const noStart = Boolean(input.result) && !started;
  const suspicious = input.result
    ? noStart || (duration !== null && duration < input.minCallSeconds)
    : null;

  const call = await db.orderCall.create({
    data: {
      tenantId,
      orderId: order.id,
      time: now,
      callStartTime: started,
      duration,
      threshold: input.minCallSeconds,
      suspicious,
      result: input.result ?? null,
      note: input.note ?? null,
      noteType: input.noteType ?? null,
      agentUserId: input.agentUserId,
    },
    select: { id: true, suspicious: true, result: true },
  });

  // Clearing the marker is what stops the next call inheriting this one's
  // start time and reporting an hour-long conversation.
  await db.fulfillmentOrder.update({
    where: { id: order.id },
    data: { pendingCallStart: null },
  });

  return { ...call, noStart };
}
