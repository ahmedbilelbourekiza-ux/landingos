import {
  sha256Lower,
  phoneCandidates,
  splitName,
  normalizeName,
  normalizeLocation,
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
 * Advanced matching: phone, first/last name, city (commune), state (wilaya)
 * and country are hashed per Meta's normalisation spec; fbc/fbp/ip/user-agent travel unhashed as the spec
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
    const { first, last } = splitName(normalizeName(event.customer.name));
    if (first) userData.fn = [sha256Lower(first)];
    if (last) userData.ln = [sha256Lower(last)];
  }
  // ct/st: normalised BEFORE hashing (no spaces, no punctuation) — a hash of
  // "Bordj Bou Arreridj" matches nothing; "bordjbouarreridj" is Meta's key.
  const city = event.customer?.city ? normalizeLocation(event.customer.city) : "";
  if (city) userData.ct = [sha256Lower(city)];
  const state = event.customer?.state ? normalizeLocation(event.customer.state) : "";
  if (state) userData.st = [sha256Lower(state)];
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

/**
 * POST one payload and return Meta's answer (`events_received`, `messages`,
 * `fbtrace_id`). Throws on a non-2xx with Meta's error text, which names the
 * problem precisely (expired token, wrong dataset id, missing permission).
 * The token travels as a query parameter, Meta's documented form; it is never
 * logged — only the response body is.
 */
export async function postMetaEvents(
  pixelId: string,
  accessToken: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const url =
    `${graphBase()}/${GRAPH_API_VERSION}/${encodeURIComponent(pixelId)}/events` +
    `?access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Meta CAPI ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** One send, caught by the dispatcher — a tracking failure never surfaces. */
export async function sendMetaEvent(
  destination: TrackingDestination,
  event: ServerTrackingEvent,
): Promise<void> {
  if (!destination.serverToken) return; // browser-pixel-only configuration
  await postMetaEvents(
    destination.publicId,
    destination.serverToken,
    buildMetaPayload(event, destination.testCode),
  );
}
