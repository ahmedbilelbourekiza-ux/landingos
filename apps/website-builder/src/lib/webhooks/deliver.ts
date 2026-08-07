import { createHmac } from "crypto";

import { withTenant } from "@landingos/db";
import { decryptToken } from "@/lib/meta/crypto";
import type { WebhookEvent } from "./events";

/**
 * The stored signing secret, whichever way it was stored. Secrets are
 * encrypted at rest on every write path NOW — but the first platform port
 * wrote them as plaintext (encryptToken had zero callers, BUILDER_AUDIT), so
 * rows from that era do not carry the `iv:tag:ciphertext` shape and
 * decryptToken throws on them. A value that does not look encrypted IS the
 * secret. It came from the same column either way, so this widens nothing.
 */
function revealSecret(stored: string): string {
  if (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(stored)) {
    return decryptToken(stored);
  }
  return stored;
}

// Outgoing webhook delivery: signing, retries, and logging.
//
// Every payload is signed with HMAC-SHA256 over the exact JSON body using the
// endpoint's secret, sent as `X-LandingOS-Hmac-SHA256` (base64). The receiver
// should recompute the HMAC over the RAW request body and compare — parsing
// and re-serializing the JSON first will produce a different string and the
// signature will not match.
//
// Delivery is fire-and-forget from the caller's perspective: dispatch() is
// never awaited on a customer-facing request path, and it swallows all
// errors. A broken CRM must never prevent a real order from being placed.

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 4000]; // waits before attempt 2 and attempt 3
const REQUEST_TIMEOUT_MS = 10000;

export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A 4xx (other than 429) means the receiver understood us and rejected it —
// retrying an identical body will not help. 5xx, 429, timeouts, and network
// errors are transient and worth retrying.
function isRetryable(statusCode: number | null): boolean {
  if (statusCode === null) return true; // network error / timeout
  if (statusCode === 429) return true;
  return statusCode >= 500;
}

interface EndpointRow {
  id: string;
  label: string;
  url: string;
  secret: string;
  /** Prisma Json column — an ARRAY at runtime, or a string on legacy rows. */
  events: unknown;
}

/**
 * The subscribed-events column is Json, so Prisma returns the VALUE — an
 * array. The first platform build called JSON.parse on it, which throws on an
 * array, was caught, and answered false: every endpoint therefore "subscribed
 * to nothing" and no webhook was ever delivered (BUILDER_AUDIT W-01). Strings
 * are still parsed for rows written by the pre-platform app, which stored the
 * list serialized.
 */
export function subscribedEvents(events: unknown): string[] {
  let value = events;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.map(String) : [];
}

function subscribesTo(endpoint: EndpointRow, event: WebhookEvent): boolean {
  return subscribedEvents(endpoint.events).includes(event);
}

async function deliverToEndpoint(
  tenantId: string,
  endpoint: EndpointRow,
  event: WebhookEvent,
  resourceId: string,
  body: string,
): Promise<void> {
  let secret: string;
  try {
    secret = revealSecret(endpoint.secret);
  } catch (error) {
    console.error(`[webhooks] endpoint "${endpoint.label}": cannot decrypt secret`, error);
    await logDelivery(tenantId, endpoint.id, event, resourceId, false, null, 1, "Secret could not be decrypted");
    return;
  }

  const signature = signPayload(body, secret);
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LandingOS-Topic": event,
          "X-LandingOS-Hmac-SHA256": signature,
          "X-LandingOS-Resource-Id": resourceId,
          "X-LandingOS-Delivery-Attempt": String(attempt),
          "User-Agent": "LandingOS-Webhooks/1.0",
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      lastStatus = res.status;

      if (res.ok) {
        await logDelivery(tenantId, endpoint.id, event, resourceId, true, res.status, attempt, null);
        return;
      }

      lastError = `HTTP ${res.status}`;
      if (!isRetryable(res.status)) break;
    } catch (error) {
      lastStatus = null;
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
    }
  }

  console.error(
    `[webhooks] endpoint "${endpoint.label}" failed ${event} for ${resourceId}: ${lastError}`,
  );
  // The attempts ACTUALLY made — a 4xx breaks after one, and a log claiming
  // three would tell the operator their receiver was hammered when it was not.
  await logDelivery(tenantId, endpoint.id, event, resourceId, false, lastStatus, attemptsMade, lastError);
}

async function logDelivery(
  tenantId: string,
  endpointId: string,
  event: string,
  resourceId: string,
  success: boolean,
  statusCode: number | null,
  attempts: number,
  error: string | null,
) {
  try {
    await withTenant(tenantId, (db) =>
      (db as any).webhookDelivery.create({
      data: {
        tenantId,
        endpointId,
        event,
        resourceId,
        success,
        statusCode,
        attempts,
        // Truncate so a receiver echoing a huge HTML error page cannot bloat
        // the database.
        error: error ? error.slice(0, 500) : null,
      },
      }),
    );
  } catch (err) {
    console.error("[webhooks] failed to record delivery log:", err);
  }
}

/**
 * One signed delivery attempt, awaited, no retries — for the console's "send
 * test" button, where the operator is watching and owed the real answer now.
 * Runs OUTSIDE any tenant transaction (callers use afterCommit): it talks to
 * somebody else's server, and D-LP.5.1 applies to every outbound call.
 *
 * The payload says what it is. A receiver that treats `test` like a real
 * order was going to do that with a replayed real event too; sending a
 * clearly-marked ping is the honest way to prove connectivity + signature.
 */
export async function sendTestDelivery(
  tenantId: string,
  endpoint: { id: string; label: string; url: string; secret: string },
): Promise<{ ok: boolean; statusCode: number | null; error: string | null }> {
  let secret: string;
  try {
    secret = revealSecret(endpoint.secret);
  } catch {
    return { ok: false, statusCode: null, error: "The stored secret could not be decrypted." };
  }

  const body = JSON.stringify({
    event: "test",
    created_at: new Date().toISOString(),
    data: {
      message: "LandingOS webhook test — verify the HMAC over this exact raw body.",
      endpoint_id: endpoint.id,
    },
  });

  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LandingOS-Topic": "test",
        "X-LandingOS-Hmac-SHA256": signPayload(body, secret),
        "X-LandingOS-Resource-Id": endpoint.id,
        "X-LandingOS-Delivery-Attempt": "1",
        "User-Agent": "LandingOS-Webhooks/1.0",
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    statusCode = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ok = statusCode !== null && statusCode >= 200 && statusCode < 300;
  await logDelivery(tenantId, endpoint.id, "test", endpoint.id, ok, statusCode, 1, error);
  return { ok, statusCode, error };
}

// Fire-and-forget entry point. Callers must NOT await this on a
// customer-facing request path.
export async function dispatchWebhook(
  event: WebhookEvent,
  resourceId: string,
  payload: unknown,
  tenantId: string,
): Promise<void> {
  try {
    // Bound to the tenant. Under the old single-store model "every active
    // endpoint" and "this store's endpoints" were the same set; with several
    // tenants they are emphatically not, and an unbound read here would post
    // one company's orders to another company's CRM.
    const endpoints = await withTenant(tenantId, (db) =>
      (db as any).webhookEndpoint.findMany({
        where: { isActive: true },
        select: { id: true, label: true, url: true, secret: true, events: true },
      }),
    );

    const subscribed = endpoints.filter((e) => subscribesTo(e, event));
    if (subscribed.length === 0) {
      console.log(`[webhooks] ${event} for ${resourceId}: no subscribed endpoints, skipping`);
      return;
    }

    // Serialize once so every endpoint receives a byte-identical body — the
    // HMAC must be computed over exactly what is sent.
    const body = JSON.stringify({
      event,
      created_at: new Date().toISOString(),
      data: payload,
    });

    await Promise.all(
      subscribed.map((endpoint: EndpointRow) => deliverToEndpoint(tenantId, endpoint, event, resourceId, body)),
    );
  } catch (error) {
    console.error(`[webhooks] dispatch failed for ${event} ${resourceId}:`, error);
  }
}
