import "server-only";

import crypto from "node:crypto";

import type { TenantDb } from "@landingos/db";

import { normalizePhone } from "./phone";
import { toDecimal } from "./serialize";
import { autoAssignOnCreate } from "./assign";
import { notifyNewOrder } from "./notify";

/* =============================================================================
 * Inbound webhooks from external sales channels.
 *
 * This is the most exposed surface on the platform and the only one where a
 * tenant is resolved from something a stranger sent. Two things therefore get
 * more care here than anywhere else: how the tenant is found, and whether the
 * signature check can be skipped.
 *
 * -----------------------------------------------------------------------------
 * D-05.5 — WHY THE TENANT IS IN THE URL
 *
 * The ERP's endpoint was `/webhook/store/:storeId`, with no tenant, because
 * there was exactly one company. Phase 5.1 wrote the contract test in that
 * shape without knowing what would make it impossible.
 *
 * It is impossible because `SalesChannel` is tenant-scoped and carries RLS. An
 * unbound client reads NOTHING from it — that is the whole design, and
 * `packages/db` asserts it — so a channel id alone cannot be looked up before a
 * tenant is bound. The lookup and the binding are circular.
 *
 * Three ways out were considered:
 *
 *   1. Read the channel with the migration role, which bypasses RLS. Rejected
 *      outright: the application never runs as the owner, and making an
 *      exception for the one endpoint a stranger can reach is the worst
 *      possible place to make it.
 *
 *   2. An unscoped token table, the way `Session` is looked up by token hash
 *      before a tenant is known. Genuinely good — unguessable and rotatable —
 *      and it costs a migration, an entry in EXPECTED_UNSCOPED, and a second
 *      mechanism doing what the URL already can.
 *
 *   3. The tenant in the path, exactly like `/api/storefront/[tenant]/...`.
 *      Chosen. It is the shape this platform already uses for every anonymous
 *      tenant-scoped endpoint, it needs no schema change, and the tenant slug
 *      is not a secret — it is in every storefront URL already.
 *
 * The slug identifies; it does not authorise. Knowing it gets a caller as far
 * as the signature check and no further.
 *
 * -----------------------------------------------------------------------------
 * SEC-04 — FAIL CLOSED
 *
 * Every signature check in the ERP was:
 *
 *     if (secret && sig) { verify }
 *
 * so OMITTING the header skipped verification entirely. The check was there, it
 * read as careful, and it was worth nothing. `verifySignature` below returns a
 * decision for every combination rather than falling through any of them.
 * ========================================================================== */

/** Where each platform puts its signature. */
const SIGNATURE_HEADERS: Record<string, string> = {
  lightfunnels: "lightfunnels-hmac",
  shopify: "x-shopify-hmac-sha256",
  woocommerce: "x-wc-webhook-signature",
};

// Defined with the carrier contract, because carriers and sales channels answer
// the same four things and two copies of that union would eventually disagree.
export type { SignatureVerdict } from "./carrier-contract";
import type { SignatureVerdict } from "./carrier-contract";

/**
 * Decide whether this raw body may be trusted.
 *
 * `raw` is the body EXACTLY as it arrived. Re-serialising parsed JSON changes
 * key order and whitespace, and the HMAC is over bytes — so a re-serialised
 * body fails verification for a genuine webhook, and the usual fix for that is
 * to stop verifying.
 */
export function verifySignature(
  platform: string | null,
  secret: string | null,
  raw: string,
  headers: Headers,
): SignatureVerdict {
  // A channel with no secret configured accepts unsigned payloads, because
  // existing integrations predate the secret and breaking them silently loses
  // real orders. REQUIRE_WEBHOOK_SIGNATURES closes that door for a deployment
  // that has finished migrating.
  if (!secret) {
    return process.env.REQUIRE_WEBHOOK_SIGNATURES === "1" ? "missing" : "unsigned-allowed";
  }

  const header = SIGNATURE_HEADERS[platform ?? ""] ?? SIGNATURE_HEADERS.lightfunnels;
  const provided = headers.get(header);
  // Empty string as well as absent. `if (secret && sig)` was false for both,
  // which is why they are one branch here.
  if (!provided) return "missing";

  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");

  // Length check first: timingSafeEqual throws on a length mismatch, and an
  // exception here would be caught somewhere and turned into a skip.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return "invalid";
  return crypto.timingSafeEqual(a, b) ? "ok" : "invalid";
}

/* -----------------------------------------------------------------------------
 * Payload → order
 * -------------------------------------------------------------------------- */

/* =============================================================================
 * AUDIT.7 — THE THREE FIELDS THE PARSER THREW AWAY.
 *
 * `FulfillmentOrder.externalProductId`, `externalVariantId` and
 * `externalOrderAt` exist in the schema, and **nothing has ever written any of
 * them.** Two consequences, and the first is the expensive one:
 *
 * 1. `resolveProduct` (product-stats.ts) reads `externalProductId` FIRST, and
 *    its own comment says "a link that resolves DECIDES, including deciding
 *    'this one and not the name match'". That branch has been dead for every
 *    order ever written. Every channel order falls through to matching by NAME
 *    — and AUDIT.3 has just made name matching REFUSE when two catalogue rows
 *    share one. So a tenant selling through Shopify with two products called
 *    "Montre" gets no lifetime counters on either, while the payload was
 *    carrying the `product_id` that resolves it exactly.
 *
 *    AUDIT.1 built `CatalogProductLink`'s display and AUDIT.3 made the fallback
 *    honest. This is the identifier that makes the fallback unnecessary.
 *
 * 2. `externalOrderAt` is when the CUSTOMER ordered; `createdAt` is when this
 *    system heard about it. They are the same second in the good case and hours
 *    or days apart in the ones that matter — a replayed backlog when a store is
 *    first connected, a retried webhook, an outage. The legacy stored it
 *    (`shopifyCreatedAt`) and the schema comment says so. Losing it means a
 *    connected store's whole history lands on the day it was connected.
 *
 * The fields are OPTIONAL on this shape, because a platform that does not send
 * them is normal and must not stop producing an order.
 * ========================================================================== */

interface ExternalOrder {
  readonly externalId: string;
  readonly externalName: string;
  readonly client: string;
  readonly phone: string;
  readonly wilaya: string;
  readonly commune: string;
  readonly product: string;
  readonly quantity: number;
  readonly price: string | null;
  readonly lineItems: unknown;
  /** The catalogue identity on the platform. What makes the link exact. */
  readonly externalProductId?: string | null;
  readonly externalVariantId?: string | null;
  /** When the customer ordered, not when we heard. ISO or epoch-ms. */
  readonly externalOrderAt?: string | null;
}

/**
 * A platform date, or null.
 *
 * Never throws and never returns an Invalid Date: a malformed timestamp must
 * leave the column null rather than poison every date range the order appears
 * in. Accepts ISO (what Shopify sends) and epoch-ms (what the legacy's own
 * `createdAt` was), because both are in this codebase's history.
 */
export function externalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = typeof value === "number" ? value : String(value).trim();
  if (raw === "") return null;
  const date = typeof raw === "number" ? new Date(raw) : new Date(/^\d+$/.test(raw) ? Number(raw) : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Read what the platforms actually send.
 *
 * Deliberately forgiving. A malformed field should still produce an order
 * somebody can look at and fix — refusing the payload loses the sale rather
 * than the typo, and the customer has already paid attention once.
 */
export function parseOrder(body: Record<string, unknown>): ExternalOrder | null {
  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const shipping = (body.shipping_address ?? body.billing_address ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
  const first = (lineItems[0] ?? {}) as Record<string, unknown>;

  const externalId = String(body.id ?? body.order_id ?? "").trim();
  if (!externalId) return null;

  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  const phone = String(customer.phone ?? shipping.phone ?? body.phone ?? "").trim();

  return {
    externalId,
    externalName: String(body.name ?? body.order_number ?? "").trim(),
    client: name || String(body.customer_name ?? "").trim(),
    phone,
    wilaya: String(shipping.province ?? shipping.state ?? "").trim(),
    commune: String(shipping.city ?? "").trim(),
    product: String(first.title ?? first.name ?? "").trim(),
    quantity: Number(first.quantity) || 1,
    price: String(body.total_price ?? body.total ?? first.price ?? ""),
    lineItems,
    // AUDIT.7. Read by NAME across the several spellings the nine platforms
    // use, in the same forgiving spirit as the rest of this function: an
    // unrecognised shape leaves them null and still produces an order.
    externalProductId: str(first.product_id ?? first.productId ?? first.product ?? null),
    externalVariantId: str(first.variant_id ?? first.variantId ?? first.variant ?? null),
    externalOrderAt: str(body.created_at ?? body.createdAt ?? body.placed_at ?? null),
  };
}

/** A trimmed string, or null. `String(null)` is `"null"`, which is a real bug. */
function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Create the order, unless this delivery has already been seen.
 *
 * Platforms retry, and they replay backlogs. `externalId` is the dedup key and
 * it is indexed per tenant — per tenant because two companies will absolutely
 * both receive an order numbered #1001, and a global key would mean the second
 * one silently loses it.
 */
export async function ingestOrder(
  db: TenantDb,
  tenantId: string,
  channel: { id: string; name: string; platform: string | null },
  parsed: ExternalOrder,
  nextReference: () => Promise<string>,
): Promise<{ created: boolean; id: string | null }> {
  const existing = await db.fulfillmentOrder.findFirst({
    where: { externalId: parsed.externalId, salesChannelId: channel.id },
    select: { id: true },
  });
  if (existing) return { created: false, id: existing.id };

  const phone = normalizePhone(parsed.phone);

  // Assigned like every other inbound order. A carrier of orders that arrives
  // unassigned while the storefront's are assigned is a queue nobody owns half
  // of — and a failure here must never turn into a non-2xx, because a platform
  // that gets one disables the endpoint and the tenant stops receiving orders.
  let agentUserId: string | null = null;
  try {
    agentUserId = await autoAssignOnCreate(db, tenantId);
  } catch (error) {
    console.error("[webhook] auto-assign failed; order left unassigned", error);
  }

  const created = await db.fulfillmentOrder.create({
    data: {
      tenantId,
      reference: await nextReference(),
      externalId: parsed.externalId,
      externalName: parsed.externalName,
      /* AUDIT.7. The exact catalogue identity, so `resolveProduct` can take its
         link branch instead of matching by name — which is the branch that
         refuses when two products share one. And the customer's own order time,
         which `createdAt` is not whenever a backlog is replayed. */
      externalProductId: parsed.externalProductId ?? null,
      externalVariantId: parsed.externalVariantId ?? null,
      externalOrderAt: externalDate(parsed.externalOrderAt),
      // From the CHANNEL, never from the body. A payload that could name its
      // own tenant or channel would let a stranger file orders into any
      // company on the platform.
      salesChannelId: channel.id,
      salesChannelName: channel.name,
      platform: channel.platform,
      source: "webhook",
      client: parsed.client,
      phone,
      phoneNormalized: phone,
      wilaya: parsed.wilaya,
      commune: parsed.commune,
      product: parsed.product,
      quantity: parsed.quantity,
      price: toDecimal(parsed.price),
      lineItems: parsed.lineItems as never,
      status: "pending",
      agentUserId,
    },
    select: { id: true, reference: true, client: true, phone: true, agentUserId: true },
  });

  await notifyNewOrder(db, tenantId, created);
  return { created: true, id: created.id };
}
