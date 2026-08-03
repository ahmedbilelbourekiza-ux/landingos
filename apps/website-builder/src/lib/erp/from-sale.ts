import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";
import { productRegistry } from "@landingos/product-registry";

import { nextReference } from "./ids";
import { normalizePhone } from "./phone";
import { syncClientFromOrder } from "./clients";
import { autoAssignOnCreate } from "./assign";

/* =============================================================================
 * Builder → ERP, as a domain event rather than a network call (M-05).
 *
 * WHAT THIS REPLACES.
 *
 * A storefront checkout wrote a `SalesOrder` and then fired an `order.created`
 * webhook, deliberately unawaited, which the ERP received over HTTP and turned
 * into its own order. That was right when the ERP was a separate Express
 * application with its own database. It is wrong now: both records live in the
 * same Postgres, reachable from the same transaction, and going out over the
 * network to get from one to the other means the sale can be recorded while the
 * fulfilment record is not — with nothing to reconcile them and no error
 * anybody sees, because the call was fire-and-forget by design.
 *
 * Now it is one transaction. Either the customer has an order and the
 * call-centre has something to confirm, or neither happened.
 *
 * WHAT STAYS.
 *
 * The `order.created` webhook. It becomes purely the TENANT-FACING integration
 * feature it was always also serving as — a company subscribing their own
 * endpoint to their own events — and that has to keep being fire-and-forget,
 * because somebody else's server being down is not a reason to fail a
 * customer's checkout.
 *
 * ENTITLEMENT, NOT ASSUMPTION.
 *
 * A tenant with the builder and not the ERP must still be able to sell. The
 * fulfilment record simply is not created, checked through the registry so
 * nothing here enumerates products.
 * ========================================================================== */

/**
 * Does this tenant hold this product? **Read inside the caller's transaction.**
 *
 * `db` is not optional and cannot be `asPlatform()`. `Subscription` is one of
 * the 47 RLS-scoped tables, so an unbound client reads NOTHING from it and every
 * caller comes back `false` — silently, because row-level security denies by
 * returning zero rows rather than by erroring. That is exactly how the worker's
 * tick shipped in 6.5b reporting "0 jobs over 0 tenants" as though it were a
 * quiet day; see the note on `POST /api/jobs/tick`.
 */
export async function hasProduct(db: TenantDb, productId: string): Promise<boolean> {
  const subscription = await db.subscription.findFirst({
    select: { status: true, entitlements: true },
  });
  if (!subscription) return false;
  // A lapsed subscription stops producing work for a product nobody is paying
  // for, without anyone editing a membership — the same rule `can()` applies.
  if (subscription.status !== "ACTIVE" && subscription.status !== "TRIALING") return false;

  const entitlements = Array.isArray(subscription.entitlements)
    ? (subscription.entitlements as unknown[]).map(String)
    : [];
  return productRegistry.isEnabled(productId, entitlements);
}

/** Does this tenant hold the ERP? Read inside the caller's transaction. */
export const hasErp = (db: TenantDb): Promise<boolean> => hasProduct(db, "erp");

export interface SaleSnapshot {
  readonly id: string;
  readonly customerName: string;
  readonly phone: string;
  readonly wilaya: string;
  readonly baladia: string;
  readonly address: string | null;
  readonly notes: string | null;
  readonly quantity: number;
  readonly productPrice: Prisma.Decimal;
  readonly shippingPrice: Prisma.Decimal;
  readonly totalPrice: Prisma.Decimal;
  readonly shippingMethod: string;
  readonly productTitle: string;
  readonly variants: unknown;
}

/**
 * Create the operational record for a sale, in the caller's transaction.
 *
 * Idempotent on `salesOrderId`, which is unique: a retried checkout, or a
 * replayed event, produces one fulfilment order rather than two parcels for one
 * payment.
 *
 * The customer registry is updated here too, from the same function every other
 * order path uses — so a storefront customer accumulates lifetime history in
 * exactly the same way a phoned-in one does, rather than existing as a separate
 * kind of customer nobody counted.
 */
export async function fulfilmentFromSale(
  db: TenantDb,
  tenantId: string,
  sale: SaleSnapshot,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.fulfillmentOrder.findUnique({
    where: { salesOrderId: sale.id },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const phone = normalizePhone(sale.phone);

  // The storefront is where most orders come from, so it is the door that
  // matters most for assignment. It must never be the door that FAILS a
  // purchase, though: a roster problem is not a reason to lose a sale, so the
  // order is created unassigned if this cannot answer.
  let agentUserId: string | null = null;
  try {
    agentUserId = await autoAssignOnCreate(db, tenantId);
  } catch (error) {
    console.error("[erp] auto-assign on checkout failed; order left unassigned", error);
  }

  const created = await db.fulfillmentOrder.create({
    data: {
      tenantId,
      reference: await nextReference(db, tenantId, "order"),
      salesOrderId: sale.id,
      // Provenance, so a manager can tell a storefront sale from a phone order
      // or a Shopify import at a glance.
      source: "storefront",
      platform: "landingos",
      client: sale.customerName,
      phone,
      phoneNormalized: phone,
      wilaya: sale.wilaya,
      commune: sale.baladia,
      product: sale.productTitle,
      quantity: sale.quantity,
      // The money is copied from the SNAPSHOT, never recomputed. The sale is
      // what the customer agreed to pay; recalculating it here would let a
      // later price change alter an order that has already been placed.
      unitPrice: sale.productPrice,
      price: sale.totalPrice,
      subtotal: sale.productPrice.times(sale.quantity),
      shippingCost: sale.shippingPrice,
      lineItems: [
        {
          title: sale.productTitle,
          quantity: sale.quantity,
          price: sale.productPrice.toString(),
          variants: sale.variants,
        },
      ] as never,
      deliveryMethod: sale.shippingMethod,
      note: sale.notes ?? "",
      // Arrives unconfirmed, like every other order: a storefront submission is
      // a request to buy, and the call-centre confirming it is the product.
      status: "pending",
      agentUserId,
    },
    select: {
      id: true, status: true, deliveryOutcome: true, price: true,
      phone: true, client: true, wilaya: true, commune: true, createdAt: true,
    },
  });

  await syncClientFromOrder(db, tenantId, null, created);
  return { id: created.id, created: true };
}
