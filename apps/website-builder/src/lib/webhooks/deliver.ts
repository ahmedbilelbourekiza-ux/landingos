import { createHmac } from "crypto";

import { withTenant } from "@landingos/db";
import { decryptToken } from "@/lib/meta/crypto";
import type { WebhookEvent } from "./events";

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
  events: string;
}

function subscribesTo(endpoint: EndpointRow, event: WebhookEvent): boolean {
  try {
    const events = JSON.parse(endpoint.events) as unknown;
    return Array.isArray(events) && events.includes(event);
  } catch {
    return false;
  }
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
    secret = decryptToken(endpoint.secret);
  } catch (error) {
    console.error(`[webhooks] endpoint "${endpoint.label}": cannot decrypt secret`, error);
    await logDelivery(tenantId, endpoint.id, event, resourceId, false, null, 1, "Secret could not be decrypted");
    return;
  }

  const signature = signPayload(body, secret);
  let lastStatus: number | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
  await logDelivery(tenantId, endpoint.id, event, resourceId, false, lastStatus, MAX_ATTEMPTS, lastError);
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
