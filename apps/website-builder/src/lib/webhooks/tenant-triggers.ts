import "server-only";

import { withTenant } from "@landingos/db";

import { dispatchWebhook } from "./deliver";
import { buildOrderPayload, buildDraftOrderPayload } from "./payloads";
import type { WebhookEvent } from "./events";

/* =============================================================================
 * Outgoing webhooks, tenant-scoped.
 *
 * This replaces the legacy triggers, which read through the pre-tenant client
 * and were called only from the legacy order route. Deleting that route left
 * order.created firing nowhere — which is how an integration dies quietly: the
 * feature still exists, the endpoints are still configured, and nothing is ever
 * sent.
 *
 * FIRE AND FORGET, deliberately. Call these WITHOUT await. A customer's order
 * must not fail, or even slow down, because a receiving CRM is down — the
 * delivery log records what happened and the tenant can see it in the console.
 *
 * Everything is bound to the tenant, so a webhook can only ever carry that
 * tenant's data to that tenant's endpoints. Under the old global model those
 * were the same thing; they are not any more.
 * ========================================================================== */

export function triggerOrderWebhook(
  event: WebhookEvent,
  tenantId: string,
  orderId: string,
): void {
  void (async () => {
    try {
      const order = await withTenant(tenantId, (db) =>
        (db as any).salesOrder.findUnique({
          where: { id: orderId },
          include: {
            landingPage: { select: { id: true, title: true, slug: true, currency: true } },
          },
        }),
      );
      if (!order) return;

      await dispatchWebhook(event, orderId, await buildOrderPayload(order), tenantId);
    } catch (error) {
      // Logged, never rethrown: this runs detached from the request that
      // started it, so a throw here would be an unhandled rejection.
      console.error(`[webhooks] ${event} failed for order ${orderId}:`, error);
    }
  })();
}

export function triggerDraftOrderWebhook(
  event: WebhookEvent,
  tenantId: string,
  draftId: string,
): void {
  void (async () => {
    try {
      const draft = await withTenant(tenantId, (db) =>
        (db as any).draftOrder.findUnique({
          where: { id: draftId },
          include: {
            landingPage: { select: { id: true, title: true, slug: true, currency: true } },
          },
        }),
      );
      if (!draft) return;

      await dispatchWebhook(event, draftId, await buildDraftOrderPayload(draft), tenantId);
    } catch (error) {
      console.error(`[webhooks] ${event} failed for draft ${draftId}:`, error);
    }
  })();
}
