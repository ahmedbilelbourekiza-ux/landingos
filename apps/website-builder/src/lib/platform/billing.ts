import "server-only";

import { productRegistry, type ProductManifest } from "@landingos/product-registry";

import type { TenantDb } from "@landingos/db";

/* =============================================================================
 * Billing — Phase 7.2.
 *
 * The domain is finished: `Subscription` holds `status` and `entitlements`, and
 * every gate in the platform reads them fresh on every call (`can()`, the worker
 * tick, `hasProduct`, `assign`, `notifications`). This module is the management
 * half — read what the tenant has, change it, and watch access follow.
 *
 * NOT a payment integration. The first slice is entitlement management only:
 * the valuable, testable property is "drop `product.erp` and every ERP route
 * 403s on the next request", and that needs no Stripe webhook. A provider
 * integration is a second slice that writes the SAME row this one does.
 * ========================================================================== */

/** The product id these audit rows carry. Not a registry product — the platform. */
export const PLATFORM_PRODUCT = "platform";

/**
 * Every product entitlement the platform recognises, from the registry.
 *
 * The source of truth for what a tenant MAY hold — a write is validated against
 * this set, so a typo or an invented key is refused rather than silently stored
 * (and then doing nothing, which is worse). A tenth product joins this set by
 * registering, not by editing this file.
 */
export const KNOWN_ENTITLEMENTS: readonly string[] = productRegistry
  .list()
  .map((p) => p.entitlement);

/** A product in the catalog, with the entitlement string that toggles it. */
export interface BillingProduct {
  readonly id: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly entitlement: string;
}

/** The catalog the screen renders — every registered product, in switcher order. */
export function billingCatalog(): readonly BillingProduct[] {
  return productRegistry.list().map((p: ProductManifest) => ({
    id: p.id,
    nameKey: p.nameKey,
    descriptionKey: p.descriptionKey,
    entitlement: p.entitlement,
  }));
}

export interface BillingView {
  /** The plan string (free/starter/…). Display only — no gate reads it. */
  readonly plan: string;
  /** The subscription status. ACTIVE/TRIALING grant access; others do not. */
  readonly status: string;
  /** The entitlement keys the tenant currently holds. */
  readonly entitlements: readonly string[];
  /** Every registered product, for the toggle UI. */
  readonly catalog: readonly BillingProduct[];
}

/**
 * Read the tenant's subscription as a billing view.
 *
 * No `where` clause: `db` is bound, and RLS is what scopes the read. A tenant
 * with no subscription row (deleted in a test, or never created) reads back
 * empty entitlements rather than erroring — the surface is not
 * entitlement-gated, so a company can manage its billing before it has any.
 */
export async function readBilling(db: TenantDb): Promise<BillingView> {
  const sub = await db.subscription.findFirst({
    select: { plan: true, status: true, entitlements: true },
  });
  const entitlements = sub && Array.isArray(sub.entitlements)
    ? (sub.entitlements as unknown[]).map(String)
    : [];
  return {
    plan: sub?.plan ?? "free",
    status: sub?.status ?? "TRIALING",
    entitlements,
    catalog: billingCatalog(),
  };
}

/**
 * Validate an entitlements array against the catalog.
 *
 * Returns the normalised set (deduped, known only) or null if any element is
 * not a recognised product entitlement. Unknown keys are refused rather than
 * dropped: a caller sending `product.nope` has made a mistake worth naming,
 * and silently storing it (then having it do nothing) hides the mistake.
 */
export function normaliseEntitlements(
  raw: unknown,
): readonly string[] | null {
  if (!Array.isArray(raw)) return null;
  const known = new Set(KNOWN_ENTITLEMENTS);
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    if (!known.has(entry)) return null;
    out.add(entry);
  }
  return [...out];
}

/**
 * Set the tenant's entitlements.
 *
 * Writes `Subscription.entitlements` inside the caller's binding. Every gate
 * re-reads the subscription fresh, so the change takes effect on the next
 * request — `resolveSession` on the next HTTP call, `hasProduct` on the next
 * worker tick, `entitlementsOf` on the next assignment. No cache, no event.
 *
 * Returns the resulting view, so the route can answer with what is now true
 * rather than asking the caller to re-read.
 *
 * `tenantId` is passed explicitly (the route has it from `session.auth`) rather
 * than read back from the binding setting: the upsert's `where` needs a stable
 * key and threading it is clearer than a `$queryRaw` round-trip.
 */
export async function setEntitlements(
  db: TenantDb,
  tenantId: string,
  entitlements: readonly string[],
  actorUserId: string,
): Promise<BillingView> {
  // Upsert, not update: a tenant may legitimately have no subscription row yet
  // (the gate-no-sub test deletes it), and the surface must still work so a
  // company can set its entitlements before it has any. The unique key is
  // `tenantId`.
  await db.subscription.upsert({
    where: { tenantId },
    update: { entitlements: [...entitlements] },
    create: { tenantId, entitlements: [...entitlements] },
  });

  await db.auditEvent.create({
    data: {
      tenantId,
      userId: actorUserId,
      product: PLATFORM_PRODUCT,
      entity: "subscription",
      entityId: "current",
      action: "update_entitlements",
      payload: { entitlements: [...entitlements] },
    },
  });

  return readBilling(db);
}
