import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { nextReference } from "./ids";
import { normalizePhone } from "./phone";
import { toDecimal } from "./serialize";
import { syncClientFromOrder, type OrderStatsView } from "./clients";
import { syncProductStatsFromOrder } from "./product-stats";
// A type-only import from a directive-free module. `FilterField` describes a
// control; it carries no behaviour and no directive, so both this server module
// and the client-free bar can name it.
import type { FilterField as FilterFieldSpec } from "@/components/console/filter-field";

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
 * How many parcels one bulk request may book — LP.9.
 *
 * Lives here rather than in the route because the ORDER LIST renders the number
 * beside its own control: an operator who ticks 200 rows should be told the
 * ceiling, not discover it as a 422. One constant, one answer — the same reason
 * `orderFilterFields` sits beside `orderFilters`.
 *
 * Refused by name above this rather than silently capped, exactly as
 * `EXPORT_LIMIT` is (LP.6): a manager who ticks 200 rows and gets 50 parcels
 * plus a success message has 150 orders they believe are booked.
 */
export const BULK_BOOK_LIMIT = 50;

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
  /* AUDIT.7. The identity the platform sent, which the webhook used to drop.
     `externalProductId` is what lets `resolveProduct` take its exact link
     branch rather than matching by name; `externalOrderAt` is when the customer
     ordered, which is not `createdAt` whenever a backlog is replayed. */
  externalProductId: true, externalVariantId: true, externalOrderAt: true,
  overdueFlaggedAt: true, pendingCallStart: true,
  createdAt: true, updatedAt: true,
  /* LP.8 / N21 — THE FACTS THE ROW WAS MISSING.
   *
   * The measured gap was 8 facts against 14, and the four that decide what to
   * do next were all absent: whether an order is overdue, whether anybody has
   * called it, whether there is a note on it, and whether it is flagged. Three
   * of those were already derivable from columns above (`_count.calls`,
   * `createdAt`, `classification`); these are the rest of the legacy row.
   *
   * The MONEY BREAKDOWN is here because a total alone cannot be checked. A
   * customer disputing "4,900" is disputing one of three numbers — the items,
   * the delivery or the discount — and the legacy row shows all three. They are
   * scalars on the same table, so this costs nothing.
   *
   * `salesChannelName`, `platform` and `brand` are the denormalised display
   * columns the channel webhooks already write. Reading them here rather than
   * joining `SalesChannel` per row is why they are denormalised at all. */
  unitPrice: true, subtotal: true, discount: true, shippingCost: true,
  expressDelivery: true,
  /* `callReminderStatus` and `callReminderDue` are NOT selected, and are not
   * read anywhere: the audit found LP.8 rendering a badge from the first of
   * them while **nothing on this platform writes either**. `FollowupTask` is
   * the record — `POST /followup/tasks/[id]/resolve` states that decision — so
   * the order list asks the task. The two columns survive from the ERP's schema
   * and are dead; they are named here so the next reader knows before adding
   * one. */
  salesChannelName: true, platform: true, brand: true,
  /* LP.9 — WHY an order is flagged, not only THAT it is.
   *
   * `POST /orders/[id]/classify` has written `fakeReason`, `fakeResponsible`
   * and `fakeAt` since Phase 5 and **nothing read any of them back**: the order
   * read did not return them and the detail screen showed a bare "fake" pill.
   * Marking an order fake is an accusation — it removes it from the confirmed
   * count, and `fakeResponsible` names a colleague — so "why" and "who says"
   * are the parts somebody disputes. Found by building the bulk action that
   * writes them fifty at a time. */
  fakeReason: true, fakeResponsible: true, fakeAt: true,
  _count: { select: { calls: true } },
} satisfies Prisma.FulfillmentOrderSelect;

/* -----------------------------------------------------------------------------
 * What a row says about itself — LP.8, closing N10 and N21
 * -------------------------------------------------------------------------- */

/**
 * The row facts the legacy derived and the platform did not show.
 *
 * Ported from `isDraftOrder` / `isAbandonedOrder` / the overdue expression in
 * `apps/erp/index.html`'s `renderListView`. Derived HERE rather than in the
 * page for the same reason `orderFilterFields` lives beside `orderFilters`: the
 * order list, the board and the queue all need the same answer, and three
 * copies of "is this abandoned" is three chances for one screen to disagree
 * with another about the same order.
 *
 * `overdue` takes the threshold as an argument rather than reading settings,
 * because the caller has already read them once for the whole page — and
 * because the tenant's own `alertMinutes` is the threshold the dashboard banner
 * and the queue badge use. A number invented here would be a fourth opinion.
 */
export interface OrderRowFacts {
  readonly draft: boolean;
  readonly abandoned: boolean;
  readonly fake: boolean;
  readonly overdue: boolean;
  readonly neverCalled: boolean;
}

export function orderRowFacts(
  order: {
    orderType?: string | null;
    status?: string | null;
    source?: string | null;
    classification?: string | null;
    createdAt: Date;
    _count: { calls: number };
  },
  alertMinutes: number,
  now: number = Date.now(),
): OrderRowFacts {
  const neverCalled = order._count.calls === 0;
  return {
    // `source` matters as much as `orderType`: a Shopify draft arrives with
    // `source: "shopify_draft"` and an orderType the channel adapter never set.
    draft: order.orderType === "draft" || order.source === "shopify_draft",
    abandoned:
      order.orderType === "abandoned" ||
      order.status === "abandoned" ||
      order.source === "shopify_abandoned",
    fake: order.classification === "fake",
    neverCalled,
    // NEVER CALLED **and** older than the threshold — not "old". An order
    // somebody has phoned three times is being worked, however old it is, and
    // colouring it red teaches operators to ignore the colour.
    overdue: neverCalled && now - order.createdAt.getTime() > alertMinutes * 60_000,
  };
}

const ORDER_SORT_COLUMNS: Record<string, keyof Prisma.FulfillmentOrderOrderByWithRelationInput> = {
  createdAt: "createdAt",
  price: "price",
  client: "client",
  status: "status",
  updatedAt: "updatedAt",
};

/**
 * The sort keys a control may offer — D-LP.3's rule, applied to ordering.
 *
 * `orderSort` has read `?sort=` since Phase 5 and **no control anywhere set
 * it**: an operator could not sort the order book by value, by date or by
 * customer, though the query has always supported it. That is the shape of
 * defect this project has now caught six times — a capability computed,
 * whitelisted and reachable by nothing.
 *
 * Exported from the module that VALIDATES it, beside `orderFilterFields`, so a
 * column header cannot offer a key `orderSort` would ignore and a key added
 * here cannot go unoffered. A header bound to a key outside this list is a
 * control that silently reorders by `createdAt` and says it did something else.
 */
export const ORDER_SORT_FIELDS = Object.keys(ORDER_SORT_COLUMNS) as readonly string[];

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

/**
 * The named date windows an operator actually asks for.
 *
 * The legacy CRM had exactly these five plus "custom", and they are the whole
 * vocabulary of a call-centre day: what came in today, what is left from
 * yesterday, how the week is going. `since`/`until` still work and still WIN,
 * so nothing that used them changes.
 *
 * Resolved HERE rather than on the screen, and that is the load-bearing part.
 * If the page turned `range=today` into a pair of timestamps itself, the screen
 * and the API would interpret the same URL differently the first time one of
 * them changed — and "differently" here means a manager and an export
 * disagreeing about what "today" contained. One function, one answer.
 */
export const DATE_RANGES = ["today", "yesterday", "week", "month"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

/**
 * A date bound from either shape the two callers send.
 *
 * The API's callers send epoch milliseconds — that is what the ERP always sent
 * and what `orderFilters` has always parsed. An `<input type="date">` sends
 * `YYYY-MM-DD`, and `Number("2026-08-06")` is `NaN`, so the filter bar's own
 * values would have produced an Invalid Date and a query nobody could explain.
 * Both are accepted; neither caller had to change.
 *
 * `endOfDay` is why `until` is inclusive: a person choosing 6 August as the end
 * of a range means the whole of the 6th, and `lte 2026-08-06T00:00` silently
 * drops a day's orders. The legacy did the same thing by appending
 * `T23:59:59.999`.
 */
function toBound(value: string, endOfDay = false): Date {
  if (/^\d+$/.test(value)) return new Date(Number(value));
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return new Date(Number(value));
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d);
}

/** Start-of-day in the server's zone; `null` for a value that names no window. */
function rangeBounds(range: string, now = new Date()): { gte?: Date; lte?: Date } | null {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(now);

  switch (range) {
    case "today":
      return { gte: today };
    case "yesterday": {
      const from = new Date(today);
      from.setDate(from.getDate() - 1);
      // Exclusive of today, so "yesterday" is one day and not two.
      return { gte: from, lte: new Date(today.getTime() - 1) };
    }
    case "week": {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { gte: from };
    }
    case "month": {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { gte: from };
    }
    default:
      // Unknown values are IGNORED, not refused. A stale bookmark carrying a
      // range that no longer exists should render the list, exactly as
      // `orderSort` treats an unknown sort column.
      return null;
  }
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

  // Explicit bounds win over a named window: `since`/`until` are what the API's
  // callers already send, and a caller who states both a range and a bound
  // means the bound.
  const since = get("since");
  const until = get("until");
  const range = get("range");
  if (since || until) {
    where.createdAt = {
      ...(since ? { gte: toBound(since) } : {}),
      ...(until ? { lte: toBound(until, true) } : {}),
    };
  } else if (range) {
    const bounds = rangeBounds(range);
    if (bounds) where.createdAt = bounds;
  }

  /* LP.12 / R11 — ORDERS CARRYING A SUSPICIOUS CALL.
   *
   * `OrderCall.suspicious` is computed and stored on every logged call — a call
   * shorter than the tenant's `minCallSeconds` that was nevertheless marked
   * confirmed — and **nothing surfaced it**. The whole point of that setting is
   * catching an agent who marks orders confirmed without really phoning, and the
   * data was being collected where nobody could see it.
   *
   * It goes in `orderFilters` rather than on a screen of its own so it shares
   * one filter vocabulary with the list, the export and the analytics (D-LP.3):
   * "suspicious calls for Alger this week" is then a filter somebody can narrow
   * further, hand to an export, or open in analytics — none of which a separate
   * Alerts screen could do. */
  if (get("suspicious") === "true") {
    where.calls = { some: { suspicious: true } };
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

/**
 * The controls a filter bar should offer, described HERE.
 *
 * In the same module as `orderFilters` and deliberately so: a bar with its own
 * list of fields is a second vocabulary, and it goes stale the moment a filter
 * is added to the API — showing up not as an error but as a capability nobody
 * can find. Every `name` below is a key `orderFilters` reads, and the test for
 * this slice asserts that in both directions.
 *
 * `agentUserId` is offered only when the caller sees the whole book.
 * `scopedWhere` ANDs the scope in regardless, so for an agent the control would
 * be one that cannot change anything — worse than absent, because pressing it
 * teaches the wrong model of what they can see.
 *
 * Two of the nine are deliberately left off: `followupUserId` belongs to the
 * follow-up screen's own bar, and `salesChannelId` needs the channel list,
 * which this screen does not read. Both are named here rather than silently
 * missing, so the next person adding them knows they were a choice.
 */
export function orderFilterFields(opts: {
  readonly t: (key: string) => string;
  readonly statuses: readonly { value: string; label: string }[];
  readonly members?: readonly { value: string; label: string }[];
}): FilterFieldSpec[] {
  const { t } = opts;
  const fields: FilterFieldSpec[] = [
    { name: "search", label: t("erp.filters.search"), kind: "text", wide: true },
    { name: "status", label: t("erp.orders.status"), kind: "select", options: opts.statuses },
  ];

  if (opts.members) {
    fields.push({
      name: "agentUserId",
      label: t("erp.orders.agent"),
      kind: "select",
      options: opts.members,
    });
  }

  fields.push(
    { name: "wilaya", label: t("erp.orders.destination"), kind: "text" },
    {
      name: "orderType",
      label: t("erp.filters.orderType"),
      kind: "select",
      options: [
        { value: "normal", label: t("erp.filters.typeNormal") },
        { value: "abandoned", label: t("erp.filters.typeAbandoned") },
      ],
    },
    {
      name: "classification",
      label: t("erp.filters.classification"),
      kind: "select",
      options: [{ value: "fake", label: t("erp.filters.fake") }],
    },
    {
      name: "suspicious",
      label: t("erp.filters.suspicious"),
      kind: "select",
      options: [{ value: "true", label: t("erp.filters.suspiciousOnly") }],
    },
    {
      name: "deliveryOutcome",
      label: t("erp.filters.outcome"),
      kind: "select",
      options: [
        { value: "delivered", label: t("erp.filters.delivered") },
        { value: "returned", label: t("erp.filters.returned") },
      ],
    },
    {
      name: "range",
      label: t("erp.filters.period"),
      kind: "select",
      options: DATE_RANGES.map((value) => ({ value, label: t(`erp.filters.range.${value}`) })),
    },
    // Kept alongside the presets rather than hidden behind a "custom" choice.
    // The legacy hid them and it costs a click for the one case — a date range
    // somebody was given — where the operator already knows both ends.
    { name: "since", label: t("erp.filters.from"), kind: "date" },
    { name: "until", label: t("erp.filters.to"), kind: "date" },
  );

  return fields;
}

/* -----------------------------------------------------------------------------
 * Writing
 * -------------------------------------------------------------------------- */

const STATS_VIEW = {
  status: true, deliveryOutcome: true, price: true,
  phone: true, client: true, wilaya: true, commune: true, createdAt: true,
  /* The audit's finding. `CatalogProduct`'s lifetime counters said
   * "maintained by the order pipeline" and were maintained by nothing, so
   * every product reported zero orders and zero revenue. These four are what
   * `syncProductStatsFromOrder` needs to decide WHICH product an order is —
   * through `product-match.ts`, so the counters and the revenue attribution
   * cannot disagree. */
  product: true, externalProductId: true, salesChannelId: true, platform: true,
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
  await syncProductStatsFromOrder(db, null, created);
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
  if (!after) return;
  await syncClientFromOrder(db, tenantId, before as OrderStatsView, after);
  // The product's counters move on the same transitions the customer's do, and
  // in the same transaction, so the two can never describe different events.
  await syncProductStatsFromOrder(db, before, after);
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
