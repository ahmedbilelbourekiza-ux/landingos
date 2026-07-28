import { db } from "@/lib/db";
import { dispatchWebhook } from "./deliver";
import {
  buildOrderPayload,
  buildProductPayload,
  buildDraftOrderPayload,
  toNumericId,
} from "./payloads";
import type { WebhookEvent } from "./events";

// Thin trigger helpers used by the API routes. Each one re-reads the record
// with exactly the relations the payload builder needs, then dispatches.
//
// All of these are fire-and-forget: call them WITHOUT await from a request
// handler. They never throw — a webhook problem must never surface as a
// failed order or a failed admin save.

export function triggerOrderWebhook(event: WebhookEvent, orderId: string): void {
  void (async () => {
    try {
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          landingPage: { select: { id: true, title: true, slug: true, currency: true } },
        },
      });
      if (!order) return;

      const payload = await buildOrderPayload(order);
      await dispatchWebhook(event, orderId, payload);
    } catch (error) {
      console.error(`[webhooks] ${event} trigger failed for order ${orderId}:`, error);
    }
  })();
}

export function triggerDraftOrderWebhook(event: WebhookEvent, draftId: string): void {
  void (async () => {
    try {
      const draft = await db.draftOrder.findUnique({
        where: { id: draftId },
        include: {
          landingPage: { select: { id: true, title: true, slug: true, currency: true } },
        },
      });
      if (!draft) return;

      const payload = await buildDraftOrderPayload(draft);
      await dispatchWebhook(event, draftId, payload);
    } catch (error) {
      console.error(`[webhooks] ${event} trigger failed for draft ${draftId}:`, error);
    }
  })();
}

export function triggerProductWebhook(event: WebhookEvent, productId: string): void {
  void (async () => {
    try {
      const product = await db.landingPage.findUnique({
        where: { id: productId },
        include: {
          media: { orderBy: { displayOrder: "asc" } },
          variants: { orderBy: { displayOrder: "asc" } },
          category: { select: { name: true } },
        },
      });
      if (!product) return;

      const payload = buildProductPayload(product);
      await dispatchWebhook(event, productId, payload);
    } catch (error) {
      console.error(`[webhooks] ${event} trigger failed for product ${productId}:`, error);
    }
  })();
}

// product.deleted is a special case: by the time we fire, the row is gone,
// so the payload has to be built from a snapshot captured before deletion.
export function triggerProductDeletedWebhook(snapshot: {
  id: string;
  title: string;
  slug: string;
}): void {
  void (async () => {
    try {
      await dispatchWebhook("product.deleted", snapshot.id, {
        id: snapshot.id,
        id_numeric: toNumericId(snapshot.id),
        title: snapshot.title,
        handle: snapshot.slug,
        landingos: { landing_page_id: snapshot.id, slug: snapshot.slug },
      });
    } catch (error) {
      console.error(`[webhooks] product.deleted trigger failed for ${snapshot.id}:`, error);
    }
  })();
}
