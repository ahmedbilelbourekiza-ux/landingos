import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { normalizePhone } from "./phone";
// Directive-free, like the same import in orders.ts: a control descriptor with
// no behaviour, nameable from a server module and from the bar alike.
import type { FilterField as FilterFieldSpec } from "@/components/console/filter-field";

/* =============================================================================
 * The permanent customer registry.
 *
 * Ported from `upsertClientFromOrder` in apps/erp/lib/db.js. Two properties
 * came across unchanged because they are the design, not an implementation
 * detail, and both are easy to "fix" into something wrong:
 *
 * 1. THESE ARE LIFETIME EVENT COUNTS, NOT LIVE SNAPSHOTS.
 *    `confirmedOrders` means "how many times has one of this customer's orders
 *    ever reached confirmed". It does NOT go back down when one is later
 *    cancelled — that cancellation is its own event and increments
 *    `cancelledOrders` instead. Making them agree with a live COUNT(*) looks
 *    like a bug fix and destroys the history the manager actually asked for.
 *
 * 2. DELETING AN ORDER NEVER TOUCHES THEM.
 *    A customer's identity and history outlive any individual order. The ERP
 *    was explicit about this and its tests assert it.
 *
 * WHAT CHANGED: the counters are updated with Prisma `increment`, which is
 * `SET x = x + 1` in SQL rather than a read-modify-write in JavaScript. The
 * ERP read the row, added one, and wrote the total back — safe under SQLite's
 * single writer, a lost update the moment two orders for the same customer are
 * processed concurrently. Two webhook deliveries landing together is the
 * ordinary case, not a rare one.
 * ========================================================================== */

/** The order fields the counters key off. */
export interface OrderStatsView {
  readonly status: string | null;
  readonly deliveryOutcome: string | null;
  readonly price: Prisma.Decimal | null;
  readonly phone: string | null;
  readonly client: string | null;
  readonly wilaya: string | null;
  readonly commune: string | null;
  readonly createdAt: Date;
}

/**
 * Bring the customer record for this order's phone number up to date.
 *
 * `before` is the order's state prior to the write, or null for a brand new
 * order. Called from inside the same transaction as every create and update, so
 * the counters cannot drift from what actually happened.
 */
export async function syncClientFromOrder(
  db: TenantDb,
  tenantId: string,
  before: OrderStatsView | null,
  after: OrderStatsView,
): Promise<void> {
  const phone = normalizePhone(after.phone);
  if (!phone) return;

  const isNewOrder = !before;
  const became = (field: "status" | "deliveryOutcome", value: string) =>
    after[field] === value && (!before || before[field] !== value);

  const nowConfirmed = became("status", "confirmed");
  const nowCancelled = became("status", "cancelled");
  const nowDelivered = became("deliveryOutcome", "delivered");

  // Lifetime spend counts the order ONCE, at the moment the carrier settles it.
  // Under cash on delivery a confirmation is not a sale — a large fraction of
  // confirmed parcels are refused at the door — so counting at `confirmed`
  // would book revenue for money nobody ever collected.
  const spendDelta = nowDelivered ? (after.price ?? new Prisma.Decimal(0)) : new Prisma.Decimal(0);

  const existing = await db.client.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
    select: { id: true, firstOrderAt: true, lastOrderAt: true },
  });

  if (!existing) {
    await db.client.create({
      data: {
        tenantId,
        phone,
        phoneDisplay: after.phone || phone,
        name: after.client ?? "",
        wilaya: after.wilaya ?? "",
        commune: after.commune ?? "",
        firstOrderAt: after.createdAt,
        lastOrderAt: after.createdAt,
        totalOrders: isNewOrder ? 1 : 0,
        confirmedOrders: nowConfirmed ? 1 : 0,
        cancelledOrders: nowCancelled ? 1 : 0,
        deliveredOrders: nowDelivered ? 1 : 0,
        totalSpent: spendDelta,
      },
    });
    return;
  }

  await db.client.update({
    where: { id: existing.id },
    data: {
      // Last write wins on the display fields: the newest order carries the
      // most recent spelling of a name and the address they last used.
      ...(after.phone ? { phoneDisplay: after.phone } : {}),
      ...(after.client ? { name: after.client } : {}),
      ...(after.wilaya ? { wilaya: after.wilaya } : {}),
      ...(after.commune ? { commune: after.commune } : {}),
      // An order can be backdated by an import, so the earliest wins here and
      // the latest wins below — neither is simply "now".
      ...(!existing.firstOrderAt || after.createdAt < existing.firstOrderAt
        ? { firstOrderAt: after.createdAt }
        : {}),
      ...(!existing.lastOrderAt || after.createdAt > existing.lastOrderAt
        ? { lastOrderAt: after.createdAt }
        : {}),
      ...(isNewOrder ? { totalOrders: { increment: 1 } } : {}),
      ...(nowConfirmed ? { confirmedOrders: { increment: 1 } } : {}),
      ...(nowCancelled ? { cancelledOrders: { increment: 1 } } : {}),
      ...(nowDelivered
        ? { deliveredOrders: { increment: 1 }, totalSpent: { increment: spendDelta } }
        : {}),
    },
  });
}

/** The shape the client list and detail screens read. */
export const CLIENT_SELECT = {
  id: true,
  phone: true,
  phoneDisplay: true,
  name: true,
  wilaya: true,
  commune: true,
  address: true,
  firstOrderAt: true,
  lastOrderAt: true,
  totalOrders: true,
  confirmedOrders: true,
  cancelledOrders: true,
  deliveredOrders: true,
  totalSpent: true,
  importedTotalOrders: true,
  importedConfirmedOrders: true,
  importedCancelledOrders: true,
  importedDeliveredOrders: true,
  importedTotalSpent: true,
  importedSource: true,
  importedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

/** Search across the fields a manager actually types into the box. */
export function clientFilter(search?: string): Prisma.ClientWhereInput {
  if (!search) return {};
  const q = search.trim();
  if (!q) return {};
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: normalizePhone(q) || q } },
      { phoneDisplay: { contains: q } },
      { wilaya: { contains: q, mode: "insensitive" } },
    ],
  };
}

/**
 * `avgOrderValue` is derived on read, never stored.
 *
 * A stored average is a third number that can disagree with the two it comes
 * from, and it would have to be recomputed on every counter change. Note the
 * divisor is DELIVERED orders, not all of them: it answers "what does this
 * customer spend when they actually take the parcel", which is the number that
 * decides whether to keep calling them.
 */
export function withDerived<T extends { totalSpent: Prisma.Decimal; deliveredOrders: number }>(
  client: T,
): T & { avgOrderValue: Prisma.Decimal } {
  return {
    ...client,
    avgOrderValue: client.deliveredOrders
      ? client.totalSpent.dividedBy(client.deliveredOrders)
      : new Prisma.Decimal(0),
  };
}

/* =============================================================================
 * LP.10 / R5 — the registry stops being read-only
 *
 * Until this slice the customer registry was ONE SEARCHABLE LIST and nothing
 * else: no detail, no correction, no export, and eight of the legacy's twelve
 * filters missing. It is the most valuable asset in a COD business — repeat
 * purchase campaigns run on it — and the schema was already carrying five
 * `imported*` columns and an `address` for features that did not exist, which is
 * a standing invitation to assume they work.
 * ========================================================================== */

/**
 * Every filter the registry accepts, in the module that validates them.
 *
 * The same rule as `orderFilters` (D-LP.3): a screen with its own list of
 * fields is a second vocabulary that goes stale the moment a filter is added,
 * and it shows up not as an error but as a capability nobody can find.
 *
 * ONE OF THE LEGACY'S IS NOT HERE: `sort` is a separate concern and stays where
 * sorting belongs.
 *
 * `niche` WAS the other one — it needed `CatalogProduct.niche`, which LP.18
 * added, and it is now offered like the rest.
 *
 * The legacy's `store` IS here, under the platform's own name
 * `salesChannelName`, because that is the denormalised column the channel
 * webhooks write.
 *
 * `product` and `salesChannelName` correlate against the customer's ENTIRE order
 * history rather than a column on the client, because a customer buys many
 * products from many channels over a lifetime and no single value on the client
 * row could be right. The legacy joined `orders.phoneNormalized = clients.phone`
 * and so does this — see `clientHistoryPhones`.
 */
export function clientFilters(params: URLSearchParams): Prisma.ClientWhereInput {
  const get = (k: string) => params.get(k)?.trim() || undefined;
  const and: Prisma.ClientWhereInput[] = [];

  const search = get("search");
  if (search) and.push(clientFilter(search));

  const wilaya = get("wilaya");
  if (wilaya) and.push({ wilaya });

  const minOrders = Number(get("minOrders"));
  if (Number.isFinite(minOrders) && minOrders > 0) and.push({ totalOrders: { gte: minOrders } });

  const minDelivered = Number(get("minDelivered"));
  if (Number.isFinite(minDelivered) && minDelivered > 0) {
    and.push({ deliveredOrders: { gte: minDelivered } });
  }

  // Bounded on `lastOrderAt`, as the legacy did: "customers who have bought in
  // the last thirty days" is the campaign question. `createdAt` would answer
  // "customers whose RECORD was created", which is a different set entirely for
  // a registry that can be populated by import.
  const since = get("since");
  const until = get("until");
  if (since || until) {
    and.push({
      lastOrderAt: {
        ...(since ? { gte: clientBound(since) } : {}),
        ...(until ? { lte: clientBound(until, true) } : {}),
      },
    });
  }

  return and.length === 0 ? {} : and.length === 1 ? and[0] : { AND: and };
}

/** Both shapes the two callers send, exactly as `orderFilters` accepts. */
function clientBound(value: string, endOfDay = false): Date {
  if (/^\d+$/.test(value)) return new Date(Number(value));
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return new Date(Number(value));
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d);
}

/**
 * The order-history filters, which cannot be expressed on `Client` at all.
 *
 * `product` and `salesChannelName` are properties of a customer's ORDERS, and
 * `Client` carries no relation to `FulfillmentOrder` — the join is by
 * normalised phone, which Prisma cannot express as a relation filter. So they
 * resolve to a phone set first and are ANDed into the client query.
 *
 * Returns `null` when neither is asked for. The caller must not add a phone
 * predicate over every number in the tenant just because it could.
 */
export async function clientHistoryPhones(
  db: TenantDb,
  params: URLSearchParams,
): Promise<string[] | null> {
  const get = (k: string) => params.get(k)?.trim() || undefined;
  const product = get("product");
  const channel = get("salesChannelName");
  const niche = get("niche");
  if (!product && !channel && !niche) return null;

  /* LP.18 — the NICHE filter, and the join the legacy used, with its own
   * caveat carried over verbatim because it is a real limitation rather than an
   * implementation detail:
   *
   *   an order stores the product NAME, not a product id, so this matches
   *   `orders.product = products.name`. If a product was renamed after orders
   *   were placed, the older orders will not match its niche.
   *
   * It is best-effort and stated rather than silently assumed. `product-match.ts`
   * exists for the money path (LP.16a) where an approximate match would move
   * revenue between products; a campaign filter that misses a renamed product is
   * a smaller wrong answer than no filter at all, which is what R12 left. */
  let nicheNames: string[] | null = null;
  if (niche) {
    const products = await db.catalogProduct.findMany({
      where: { niche },
      select: { name: true },
    });
    nicheNames = products.map((p) => p.name ?? "").filter(Boolean);
    // No product carries this niche: the filter matched nothing, which is an
    // empty result rather than an ignored filter.
    if (nicheNames.length === 0) return [];
  }

  const rows = await db.fulfillmentOrder.findMany({
    where: {
      ...(product ? { product: { contains: product, mode: "insensitive" } } : {}),
      ...(channel ? { salesChannelName: channel } : {}),
      ...(nicheNames ? { product: { in: nicheNames } } : {}),
      phoneNormalized: { not: null },
    },
    distinct: ["phoneNormalized"],
    select: { phoneNormalized: true },
  });
  return rows.map((r) => r.phoneNormalized!).filter(Boolean);
}

/**
 * The controls the client filter bar offers.
 *
 * Beside `clientFilters` for the reason `orderFilterFields` is beside
 * `orderFilters`, and the test asserts it in both directions: every offered
 * control names a key `clientFilters` (or `clientHistoryPhones`) reads, and each
 * offered value narrows a real list.
 */
export function clientFilterFields(opts: {
  readonly t: (key: string) => string;
  readonly wilayas: readonly { value: string; label: string }[];
  readonly channels: readonly { value: string; label: string }[];
  /** LP.18. The niches this tenant's catalogue actually uses. */
  readonly niches?: readonly { value: string; label: string }[];
}): FilterFieldSpec[] {
  const { t } = opts;
  const fields: FilterFieldSpec[] = [
    { name: "search", label: t("erp.filters.search"), kind: "text", wide: true },
    { name: "wilaya", label: t("erp.orders.wilaya"), kind: "select", options: opts.wilayas },
    { name: "product", label: t("erp.orders.product"), kind: "text" },
  ];
  if (opts.channels.length) {
    fields.push({
      name: "salesChannelName",
      label: t("erp.row.channel"),
      kind: "select",
      options: opts.channels,
    });
  }
  if (opts.niches?.length) {
    fields.push({
      name: "niche",
      label: t("erp.products.niche"),
      kind: "select",
      options: opts.niches,
    });
  }
  fields.push(
    { name: "minOrders", label: t("erp.clients.minOrders"), kind: "text" },
    { name: "minDelivered", label: t("erp.clients.minDelivered"), kind: "text" },
    { name: "since", label: t("erp.filters.from"), kind: "date" },
    { name: "until", label: t("erp.filters.to"), kind: "date" },
  );
  return fields;
}

/**
 * What a manager may correct by hand, and nothing else.
 *
 * THE LIFETIME COUNTERS ARE NOT HERE AND MUST NEVER BE. They move only through
 * `syncClientFromOrder`, one order event at a time; a hand-edited
 * `deliveredOrders` is a number with no events behind it, and this whole
 * registry rests on the claim that every counter is the sum of things that
 * actually happened. Neither are the `imported*` columns: an import is a record
 * of what a spreadsheet said, and editing it makes it a record of nothing.
 *
 * `phone` is absent too, and that is the load-bearing one — it is the identity
 * key (`@@unique([tenantId, phone])`). Editing it would either collide with
 * another customer or silently detach this record from every order carrying the
 * old number, because the join is by value.
 */
const CLIENT_EDITABLE = ["name", "wilaya", "commune", "address"] as const;

/** A named 422, never a silent drop — the D-LP.1 rule. */
export const CLIENT_UNEDITABLE = [
  "phone", "phoneDisplay",
  "totalOrders", "confirmedOrders", "cancelledOrders", "deliveredOrders", "totalSpent",
  "importedTotalOrders", "importedConfirmedOrders", "importedCancelledOrders",
  "importedDeliveredOrders", "importedTotalSpent", "importedSource", "importedAt",
] as const;

export interface ClientPatchResult {
  readonly data: Prisma.ClientUpdateInput;
  /** A field the caller believed they were setting. Refused by name. */
  readonly refused: string | null;
}

export function buildClientPatch(body: unknown): ClientPatchResult {
  const input = (body ?? {}) as Record<string, unknown>;

  // Refused rather than dropped, for D-LP.1's reason: a caller sending
  // `totalSpent` believes they are correcting a customer's lifetime spend, and
  // a 200 that does nothing is worse than a refusal that names the field.
  for (const field of CLIENT_UNEDITABLE) {
    if (input[field] !== undefined) return { data: {}, refused: field };
  }

  const data: Record<string, unknown> = {};
  for (const field of CLIENT_EDITABLE) {
    const value = input[field];
    if (value === undefined) continue;
    data[field] = value === null ? null : String(value).trim();
  }
  return { data: data as Prisma.ClientUpdateInput, refused: null };
}

/**
 * One customer's complete order history.
 *
 * Joined by normalised phone, which is the same key `syncClientFromOrder` uses
 * to maintain the counters — so the history and the counters cannot describe
 * different sets of orders.
 *
 * The parcel timeline the legacy attached per order is deliberately NOT here.
 * Its version issued two extra queries PER ORDER (the carrier name and the event
 * list), so a customer with forty orders cost eighty round trips on a screen
 * somebody opens to read a phone number. The delivery outcome and the tracking
 * number are already on the order row, and the order detail — one click away —
 * has the full timeline.
 */
export const CLIENT_HISTORY_SELECT = {
  id: true, reference: true, createdAt: true,
  product: true, productVariant: true, quantity: true, price: true,
  status: true, deliveryOutcome: true, deliveryStatus: true, trackingNumber: true,
  carrierCode: true, agentUserId: true, followupUserId: true,
  salesChannelName: true, platform: true, brand: true,
} satisfies Prisma.FulfillmentOrderSelect;

export async function clientOrderHistory(db: TenantDb, phone: string, take = 200) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  return db.fulfillmentOrder.findMany({
    where: { phoneNormalized: normalized },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Bounded. A registry entry for a wholesaler can carry hundreds of orders
    // and this is a screen, not an export — the export is the unbounded answer
    // and it has its own named limit.
    take,
    select: CLIENT_HISTORY_SELECT,
  });
}
