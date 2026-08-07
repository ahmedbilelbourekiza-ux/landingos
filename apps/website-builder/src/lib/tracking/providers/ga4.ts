import type { ServerTrackingEvent, TrackingDestination } from "../events.ts";

/* =============================================================================
 * GA4 Measurement Protocol adapter (LB.5).
 *
 * GA4's vocabulary is snake_case recommended events; the map is the whole
 * difference. `transaction_id` is GA4's own purchase dedup key, so a browser
 * `purchase` and this server event with the same id count once.
 *
 * `client_id` is required by the protocol. When the browser's _ga cookie was
 * captured it is used (sessions join up in reports); otherwise a stable id is
 * derived from the EVENT id — the event still lands rather than being dropped,
 * it just cannot be joined to the browsing session that produced it.
 * ========================================================================== */

const EVENT_NAMES: Record<string, string> = {
  PageView: "page_view",
  ViewContent: "view_item",
  AddToCart: "add_to_cart",
  InitiateCheckout: "begin_checkout",
  Lead: "generate_lead",
  Purchase: "purchase",
};

function apiBase(): string {
  return process.env.GA4_API_BASE ?? "https://www.google-analytics.com";
}

export function ga4EventName(name: string): string {
  // GA4 event names must be alphanumeric/underscore; a custom name is
  // normalised rather than refused so a typo degrades instead of vanishing.
  return EVENT_NAMES[name] ?? name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
}

export function buildGa4Payload(event: ServerTrackingEvent) {
  const params: Record<string, unknown> = {};
  if (event.currency) params.currency = event.currency;
  if (event.value != null) params.value = event.value;
  if (event.name === "Purchase") params.transaction_id = event.eventId;
  if (event.contentId) {
    params.items = [
      {
        item_id: event.contentId,
        ...(event.contentName ? { item_name: event.contentName } : {}),
        ...(event.quantity != null ? { quantity: event.quantity } : {}),
        ...(event.value != null && event.quantity ? { price: event.value / event.quantity } : {}),
      },
    ];
  }
  if (event.context?.url) params.page_location = event.context.url;

  return {
    client_id: event.context?.gaClientId || `landingos.${event.eventId}`,
    events: [{ name: ga4EventName(event.name), params }],
  };
}

export async function sendGa4Event(
  destination: TrackingDestination,
  event: ServerTrackingEvent,
): Promise<void> {
  if (!destination.serverToken) return; // api_secret required for MP
  const url =
    `${apiBase()}/mp/collect?measurement_id=${encodeURIComponent(destination.publicId)}` +
    `&api_secret=${encodeURIComponent(destination.serverToken)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGa4Payload(event)),
    signal: AbortSignal.timeout(10000),
  });
  // The MP endpoint answers 2xx even for malformed hits; only transport-level
  // failures are detectable here.
  if (!res.ok) {
    throw new Error(`GA4 Measurement Protocol ${res.status}`);
  }
}
