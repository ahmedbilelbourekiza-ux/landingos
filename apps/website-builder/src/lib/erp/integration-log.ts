import "server-only";

import type { TenantDb } from "@landingos/db";

/* =============================================================================
 * The integration log gets its first writer — LP.14, restoring R3.
 *
 * `IntegrationLog` was migrated in Phase 3.2 with its indexes and its comment,
 * and **nothing has ever read or written a row**. It is the record of what
 * happened between this system and somebody else's: which credentials were
 * tried, what a carrier answered, why a sync gave up. Without it the only
 * evidence of a failing integration is a parcel that did not book, and the only
 * diagnosis available to an operator is "try again".
 *
 * WHAT GOES IN, AND WHAT DELIBERATELY DOES NOT.
 *
 * `request` and `response` are `Json` and this module is the only writer, so
 * this is the one place to state the rule: **no secret is ever logged.** The
 * carrier's API key, its secret key and its webhook secret are what make the
 * log worth stealing; the URL, the method, the HTTP status and the carrier's
 * own message are what make it worth keeping. `redact` enforces that on the way
 * in rather than trusting each caller, because a caller that forgets is a
 * credential in a table any manager can read.
 *
 * IT IS APPEND-ONLY, like every other ledger here (assumption 8). There is no
 * update and no delete: a log somebody can edit is not evidence. Retention is a
 * prune, and it is bounded by the same `pruneNotifications` shape.
 * ========================================================================== */

/**
 * What the log is about.
 *
 * `carrier` (LP.14) and `salesChannel` (LP.15) are what the schema named;
 * `aiProvider` is AUDIT.5's, and the legacy logs it to the same table under
 * `'ai_provider'` for the same reason — it is a credentialed call to somebody
 * else's server, which is the only thing this table is for.
 */
export type LogEntity = "carrier" | "salesChannel" | "aiProvider";

/** Keys whose VALUE never reaches the table, whatever a caller passes. */
const SECRET_KEYS = new Set([
  "apikey", "api_key", "secretkey", "secret_key", "secret",
  "webhooksecret", "webhook_secret", "password", "token", "authorization",
  "x-api-key", "x-tenant",
]);

/**
 * Strip anything that looks like a credential, at any depth.
 *
 * By KEY rather than by value shape: a redactor that looks for
 * "things that look like keys" misses a short one and mangles an order
 * reference. Depth-limited because this is called on a carrier's response and a
 * hostile or merely enormous payload must not be walked forever.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export interface LogInput {
  readonly entity: LogEntity;
  readonly entityId: string;
  /** test_connection | manual_sync | sync_error | auth_error | webhook_received | … */
  readonly event: string;
  readonly result: "success" | "failure";
  readonly message?: string | null;
  readonly request?: unknown;
  readonly response?: unknown;
}

/**
 * Record one interaction.
 *
 * NEVER THROWS. It is called from the failure branch of the thing it is
 * recording, and a logger that can fail the operation it is describing turns a
 * carrier hiccup into a 500. A log line lost is a log line lost.
 */
export async function logIntegration(
  db: TenantDb,
  tenantId: string,
  input: LogInput,
): Promise<void> {
  try {
    await db.integrationLog.create({
      data: {
        tenantId,
        entity: input.entity,
        entityId: input.entityId,
        event: input.event,
        result: input.result,
        message: input.message?.slice(0, 2000) ?? null,
        request: redact(input.request) as never,
        response: redact(input.response) as never,
      },
    });
  } catch (error) {
    console.error("[integration-log] could not record an interaction", error);
  }
}

export interface LogView {
  id: string;
  entity: string;
  entityId: string;
  event: string;
  result: string | null;
  message: string | null;
  request: unknown;
  response: unknown;
  ts: string;
}

/** The most recent interactions with one integration, newest first. */
export async function readIntegrationLogs(
  db: TenantDb,
  entity: LogEntity,
  entityId: string,
  limit = 100,
): Promise<LogView[]> {
  const rows = await db.integrationLog.findMany({
    where: { entity, entityId },
    orderBy: { ts: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
  return rows.map((row) => ({
    // BigInt id — a string on the wire, because `JSON.stringify(1n)` throws.
    id: row.id.toString(),
    entity: row.entity,
    entityId: row.entityId,
    event: row.event,
    result: row.result,
    message: row.message,
    request: row.request,
    response: row.response,
    ts: row.ts.toISOString(),
  }));
}
