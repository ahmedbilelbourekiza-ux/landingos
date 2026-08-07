import {
  sha256Phone,
  type ServerTrackingEvent,
  type TrackingDestination,
} from "../events.ts";

/* =============================================================================
 * TikTok Events API adapter (LB.5) — v1.3 `event/track`.
 *
 * The event names TikTok's pixel understands are close to Meta's but not
 * identical; the map below is the whole difference, so the rest of the
 * pipeline never learns TikTok exists. Unmapped (custom) names pass through
 * unchanged — TikTok accepts custom events by name.
 *
 * Dedup: `event_id` matches the browser pixel's event id, and TikTok
 * deduplicates on it exactly as Meta does. `test_event_code` routes events to
 * the Events Manager test tab.
 * ========================================================================== */

const EVENT_NAMES: Record<string, string> = {
  PageView: "Pageview",
  ViewContent: "ViewContent",
  AddToCart: "AddToCart",
  InitiateCheckout: "InitiateCheckout",
  Lead: "SubmitForm",
  Purchase: "PlaceAnOrder",
};

function apiBase(): string {
  return process.env.TIKTOK_API_BASE ?? "https://business-api.tiktok.com";
}

export function tiktokEventName(name: string): string {
  return EVENT_NAMES[name] ?? name;
}

export function buildTiktokPayload(event: ServerTrackingEvent, destination: TrackingDestination) {
  const ctx = event.context ?? {};
  const user: Record<string, unknown> = {};
  if (event.customer?.phone) user.phone = sha256Phone(event.customer.phone);
  if (ctx.ttclid) user.ttclid = ctx.ttclid;
  if (ctx.ttp) user.ttp = ctx.ttp;
  if (ctx.ip) user.ip = ctx.ip;
  if (ctx.userAgent) user.user_agent = ctx.userAgent;

  const properties: Record<string, unknown> = {};
  if (event.currency) properties.currency = event.currency;
  if (event.value != null) properties.value = event.value;
  if (event.contentId) {
    properties.contents = [
      {
        content_id: event.contentId,
        content_type: "product",
        ...(event.contentName ? { content_name: event.contentName } : {}),
        ...(event.quantity != null ? { quantity: event.quantity } : {}),
      },
    ];
  }

  return {
    event_source: "web",
    event_source_id: destination.publicId,
    ...(destination.testCode ? { test_event_code: destination.testCode } : {}),
    data: [
      {
        event: tiktokEventName(event.name),
        event_time: event.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        user,
        ...(Object.keys(properties).length ? { properties } : {}),
        ...(ctx.url ? { page: { url: ctx.url } } : {}),
      },
    ],
  };
}

export async function sendTiktokEvent(
  destination: TrackingDestination,
  event: ServerTrackingEvent,
): Promise<void> {
  if (!destination.serverToken) return;
  const res = await fetch(`${apiBase()}/open_api/v1.3/event/track/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Access-Token": destination.serverToken,
    },
    body: JSON.stringify(buildTiktokPayload(event, destination)),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TikTok Events API ${res.status}: ${body.slice(0, 300)}`);
  }
}
