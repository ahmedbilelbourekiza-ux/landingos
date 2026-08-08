import {
  sha256Lower,
  phoneCandidates,
  splitName,
  type ServerTrackingEvent,
  type TrackingDestination,
} from "../events.ts";

/* =============================================================================
 * Meta Conversions API adapter (LB.5).
 *
 * Replaces lib/meta/capi.ts, which referenced an out-of-scope `tenantId`
 * (a guaranteed ReferenceError swallowed by its own catch) and had zero
 * callers — no server-side Meta event was ever sent (BUILDER_AUDIT §2).
 *
 * Advanced matching: phone, first/last name and country are hashed per Meta's
 * normalisation spec; fbc/fbp/ip/user-agent travel unhashed as the spec
 * requires. `event_id` carries the caller's dedup key so a browser pixel event
 * with the same id is deduplicated in Events Manager rather than counted
 * twice. `test_event_code` is passed through when the integration carries one,
 * which is how a customer verifies delivery in Events Manager before go-live.
 * ========================================================================== */

const GRAPH_API_VERSION = "v25.0";

/** Overridable so the contract tests can stand up a local receiver. */
function graphBase(): string {
  return process.env.META_GRAPH_BASE ?? "https://graph.facebook.com";
}

export function buildMetaPayload(event: ServerTrackingEvent, testCode: string | null) {
  const userData: Record<string, unknown> = {
    country: [sha256Lower("dz")],
  };
  // `ph` accepts several hashes; the E.164 candidate (see phoneCandidates) is
  // the one Meta's matching actually recognises for a local number.
  if (event.customer?.phone) {
    const candidates = phoneCandidates(event.customer.phone);
    if (candidates.length) userData.ph = candidates.map(sha256Lower);
  }
  if (event.customer?.name) {
    const { first, last } = splitName(event.customer.name);
    if (first) userData.fn = [sha256Lower(first)];
    if (last) userData.ln = [sha256Lower(last)];
  }
  const ctx = event.context ?? {};
  if (ctx.fbc) userData.fbc = ctx.fbc;
  if (ctx.fbp) userData.fbp = ctx.fbp;
  if (ctx.ip) userData.client_ip_address = ctx.ip;
  if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;

  const customData: Record<string, unknown> = {};
  if (event.currency) customData.currency = event.currency;
  if (event.value != null) customData.value = String(event.value);
  if (event.contentId) {
    customData.content_ids = [event.contentId];
    customData.content_type = "product";
  }
  if (event.contentName) customData.content_name = event.contentName;
  if (event.quantity != null) customData.num_items = event.quantity;

  return {
    data: [
      {
        event_name: event.name,
        event_time: event.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: "website",
        ...(ctx.url ? { event_source_url: ctx.url } : {}),
        user_data: userData,
        ...(Object.keys(customData).length ? { custom_data: customData } : {}),
      },
    ],
    ...(testCode ? { test_event_code: testCode } : {}),
  };
}

/** One send, caught by the dispatcher — a tracking failure never surfaces. */
export async function sendMetaEvent(
  destination: TrackingDestination,
  event: ServerTrackingEvent,
): Promise<void> {
  if (!destination.serverToken) return; // browser-pixel-only configuration
  const url =
    `${graphBase()}/${GRAPH_API_VERSION}/${encodeURIComponent(destination.publicId)}/events` +
    `?access_token=${encodeURIComponent(destination.serverToken)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMetaPayload(event, destination.testCode)),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Meta CAPI ${res.status}: ${body.slice(0, 300)}`);
  }
}
