// The full catalogue of outgoing webhook events. Each endpoint subscribes to
// any subset of these; the delivery layer filters on it.
//
// Note on draft orders: unlike Shopify, where a draft order is created by
// STAFF in the admin, a landingos draft is created by the CUSTOMER — it is an
// abandoned checkout, captured progressively as they fill the order form.
// draft_order.created fires as soon as a callable phone number is captured,
// even though the customer never pressed the buy button.
export const WEBHOOK_EVENTS = [
  "order.created",
  "order.updated",
  "order.cancelled",
  "draft_order.created",
  "draft_order.updated",
  "product.created",
  "product.updated",
  "product.deleted",
  // The page lifecycle. Distinct from product.updated because going live is
  // the one change with a public consequence — an automation that reacts to
  // "my page is selling now" must not have to diff product payloads to see it.
  "page.published",
  "page.unpublished",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

// Human-readable labels for the admin settings screen.
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "order.created": "Order created",
  "order.updated": "Order status changed",
  "order.cancelled": "Order cancelled",
  "draft_order.created": "Abandoned lead captured (phone, no order yet)",
  "draft_order.updated": "Abandoned lead added more details",
  "product.created": "Product created",
  "product.updated": "Product updated (incl. price)",
  "product.deleted": "Product deleted",
  "page.published": "Landing page published (went live)",
  "page.unpublished": "Landing page unpublished (taken down)",
};
