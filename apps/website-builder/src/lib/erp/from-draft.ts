import "server-only";

import type { TenantDb } from "@landingos/db";

import { nextReference } from "./ids";
import { normalizePhone } from "./phone";
import { autoAssignOnCreate } from "./assign";
import { notifyNewOrder } from "./notify";
import { variantLabelFromSnapshot } from "./variant-label";

/* =============================================================================
 * Abandoned cart → ERP, the counterpart of `from-sale.ts` (LB.57).
 *
 * WHAT THIS CLOSES.
 *
 * The storefront captured abandoned carts into `DraftOrder` and stopped there.
 * Every read of that table lived under `console/builder` — there was not one
 * reference to it anywhere beneath `api/erp`, `console/erp` or `lib/erp`. So a
 * lead the merchant paid an ad platform to produce sat in a list nobody in the
 * call-centre works from, while the SAME record arriving from a Shopify store
 * became a callable order (`api/erp/webhooks/.../lead-capture`). The platform
 * treated its own storefront worse than somebody else's.
 *
 * `fulfilmentFromSale` already had the shape for this: a domain event inside
 * the caller's transaction, not a network hop between two products that share a
 * database. This is the same move for the record that never completed.
 *
 * WHAT A DRAFT IS, AND THEREFORE WHAT THE ROW MAY CLAIM.
 *
 * A draft is a half-filled form, not a purchase. `DraftBody` accepts no price
 * fields at all, so there is no money to copy and `price` is FORCED to zero —
 * the same rule the lead-capture endpoint states: nothing raised from a lead
 * may look like a sale or reach a revenue figure.
 *
 * Client and product lifetime counters are deliberately NOT touched here, which
 * is what `lead-capture` does too. An uncalled lead has not bought anything.
 * That choice is also what makes PROMOTION correct: because the abandoned row
 * was never counted, the sale it becomes counts once, as a first order, with no
 * double-count to unwind. See `fulfilmentFromSale`.
 * ========================================================================== */

/**
 * How many digits make a number worth handing an agent.
 *
 * The same threshold `lead-capture` uses, and it is load-bearing rather than
 * decorative. `use-draft-capture` fires at SIX digits (`isWorthSaving`), while
 * an Algerian mobile is ten — so the first capture carrying a phone very often
 * carries a partial one. Creating the ERP row on that capture would hand the
 * call-centre a dead number and call the feature done.
 *
 * This is why the bridge is not gated on the route's `leadArrived` flag alone:
 * that flag marks the first capture with ANY phone, which is frequently the
 * unusable one. Gating on "no row yet AND the number is callable" catches the
 * visitor whose first debounce caught half a number and whose second caught the
 * rest — precisely the lead the readiness audit found was being lost when the
 * Lead event fired on `draft_order.created` alone.
 */
export const CALLABLE_PHONE_MIN = 8;

export const isCallablePhone = (input: unknown): boolean =>
  normalizePhone(input).length >= CALLABLE_PHONE_MIN;

/** What the capture route knows about a visitor, at the moment it knows it. */
export interface DraftSnapshot {
  readonly id: string;
  readonly customerName: string | null;
  readonly phone: string | null;
  readonly wilaya: string | null;
  readonly baladia: string | null;
  readonly quantity: number | null;
  /** The landing page's title — the only product name a draft can name. */
  readonly productTitle: string;
  /* INV.2 — the options this visitor had chosen when the cart was captured,
   * as the stored `[{name, value}]` snapshot. An abandoned cart names a
   * variant for the same reason a sale does: the agent phoning it needs to
   * know WHICH one to talk about and whether it is in stock, and if the cart
   * is later promoted (LB.57) the order must not arrive variantless. Nullable
   * because a draft is captured mid-typing and the visitor may not have
   * chosen yet. */
  readonly variants?: unknown;
}

const trimmed = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Raise the call-centre's record for an abandoned cart, in the caller's
 * transaction. Returns null when the draft is not yet callable.
 *
 * IDEMPOTENCY IS THE DATABASE'S JOB, NOT THIS FUNCTION'S. `draftOrderId` is
 * unique, so two captures racing each other cannot both succeed however they
 * interleave. The loser's transaction aborts and its capture is lost — which is
 * the correct trade and self-healing besides: the client re-sends every couple
 * of seconds, and by then the row exists, so the next capture takes the top-up
 * branch. A check-then-insert in here would look safer and be racy.
 *
 * DECISION 1 — `status: "pending"`, NOT `"abandoned"`.
 *
 * These leads are meant to be worked, so they must sit in the agent queue, and
 * the queue is `ACTIVE_STATUSES` — everything that is not terminal. `abandoned`
 * IS terminal, so storing it as the status would file the lead exactly where
 * nobody would call it.
 *
 * This needed NO change to `TERMINAL_STATUSES`, which matters: that constant is
 * shared, and editing it would have silently promoted every `lead-capture` row
 * into the queue as well — rows created by an UNAUTHENTICATED public endpoint,
 * deliberately kept passive because anyone knowing the URL can create them.
 *
 * The pattern used here is not new. A Shopify `checkouts/*` webhook already
 * lands as `orderType: "abandoned"` + `status: "pending"` (`webhook-route.ts`
 * marks the type, `webhooks.ts` sets the status), and `orderRowFacts` flags a
 * row as abandoned on `orderType` ALONE. So the badge, the `orderType=abandoned`
 * filter and the queue all behave, and `lead-capture` is untouched.
 */
export async function fulfilmentFromDraft(
  db: TenantDb,
  tenantId: string,
  draft: DraftSnapshot,
): Promise<{ id: string; created: boolean } | null> {
  if (!isCallablePhone(draft.phone)) return null;

  const phoneNormalized = normalizePhone(draft.phone);

  // A roster problem must not cost the lead, exactly as it must not cost a
  // sale at checkout. Unassigned is a state the queue already renders.
  let agentUserId: string | null = null;
  try {
    agentUserId = await autoAssignOnCreate(db, tenantId);
  } catch (error) {
    console.error("[erp] auto-assign on abandoned cart failed; lead left unassigned", error);
  }

  const created = await db.fulfillmentOrder.create({
    data: {
      tenantId,
      reference: await nextReference(db, tenantId, "order"),
      draftOrderId: draft.id,
      // Provenance a manager can read at a glance, and distinct from the
      // `lead_capture` and `shopify_abandoned` rows that mean something else.
      source: "storefront_abandoned",
      platform: "landingos",
      client: trimmed(draft.customerName),
      phone: trimmed(draft.phone),
      phoneNormalized,
      wilaya: trimmed(draft.wilaya),
      commune: trimmed(draft.baladia),
      product: draft.productTitle,
      // INV.2 — see `SaleSnapshot`'s note. Empty when nothing was chosen yet,
      // which is the same "no variant" the column already means.
      productVariant: variantLabelFromSnapshot(draft.variants),
      quantity: draft.quantity ?? 1,
      // Forced. A draft carries no prices — the capture contract has no field
      // for one — so any figure here would be invented.
      price: 0,
      orderType: "abandoned",
      status: "pending",
      note: "Abandoned cart — captured from the storefront order form",
      agentUserId,
    },
    select: {
      id: true, reference: true, client: true, phone: true, agentUserId: true,
    },
  });

  // The `abandoned` sound family (LP.11): a cart that walked away is a
  // different urgency from a sale that landed, and the two are told apart by
  // ear before anybody reads the screen.
  await notifyNewOrder(db, tenantId, created, "abandoned_cart");

  return { id: created.id, created: true };
}

/**
 * Fill in what a later capture learned, WITHOUT overwriting what an earlier one
 * already knew — the same never-overwrite rule the import and `lead-capture`
 * follow.
 *
 * This is not a nicety. Customers type name, then phone, then wilaya, so the
 * row created the moment the number became callable usually has no wilaya at
 * all; without the top-up the call-centre gets a lead it cannot route.
 *
 * THE PHONE IS THE ONE DELIBERATE EXCEPTION. Every other field fills only when
 * blank, but a corrected number REPLACES the stored one. `lead-capture` cannot
 * do this because its rows are keyed by phone — a different number is a
 * different lead there. Here the link is `draftOrderId`, one row per visitor,
 * so the visitor who fixes their typo is the same lead and the old number is
 * simply wrong. Leaving it would hand an agent a number that does not ring,
 * which is the failure this whole slice exists to prevent.
 *
 * Quantity is not topped up. It is never blank (it defaults to 1), so it has no
 * "still unknown" state to fill, and a lead is confirmed by phone anyway — the
 * real figure arrives with the sale at promotion.
 */
export async function topUpFulfilmentFromDraft(
  db: TenantDb,
  fulfilmentId: string,
  draft: DraftSnapshot,
): Promise<boolean> {
  const existing = await db.fulfillmentOrder.findUnique({
    where: { id: fulfilmentId },
    select: {
      id: true, client: true, wilaya: true, commune: true, product: true,
      productVariant: true, phoneNormalized: true, salesOrderId: true,
    },
  });
  if (!existing) return false;
  // Promoted rows are real orders being worked. A background capture from a
  // stale tab must never edit one.
  if (existing.salesOrderId) return false;

  const patch: Record<string, string> = {};
  const fill = (
    field: "client" | "wilaya" | "commune" | "product" | "productVariant",
    value: string,
  ) => {
    if (value && !existing[field]) patch[field] = value;
  };

  fill("client", trimmed(draft.customerName));
  fill("wilaya", trimmed(draft.wilaya));
  fill("commune", trimmed(draft.baladia));
  fill("product", draft.productTitle);
  /* INV.2 — filled on the SAME "only if still empty" rule as everything else
   * here, and it matters more than it looks: the capture that first carries a
   * phone number usually fires BEFORE the visitor has picked a size, so the
   * lead is raised variantless and the choice arrives on a later capture. */
  fill("productVariant", variantLabelFromSnapshot(draft.variants));

  const phoneNormalized = normalizePhone(draft.phone);
  if (isCallablePhone(draft.phone) && phoneNormalized !== existing.phoneNormalized) {
    patch.phone = trimmed(draft.phone);
    patch.phoneNormalized = phoneNormalized;
  }

  if (Object.keys(patch).length === 0) return false;

  await db.fulfillmentOrder.update({ where: { id: fulfilmentId }, data: patch });
  return true;
}
