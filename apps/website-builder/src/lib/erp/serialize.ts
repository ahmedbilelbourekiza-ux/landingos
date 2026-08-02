import "server-only";

import { Prisma } from "@landingos/db";

/* =============================================================================
 * Making a Prisma row safe to hand to JSON.stringify.
 *
 * Two of the three conversions here are not cosmetic.
 *
 * BIGINT THROWS. `JSON.stringify(1n)` is a TypeError, not a fallback. Six ERP
 * models use BigInt ids — ShipmentEvent, InventoryMovement, StockLot,
 * CatalogProductEvent, IntegrationLog, AiConversationMessage — so any route
 * returning one of those rows raises 500 the first time it is called with real
 * data. It is the kind of defect that passes review, passes a build, and fails
 * on the first request, which is the exact failure mode PROJECT_STATE warns
 * about twice.
 *
 * DECIMAL MUST STAY A STRING. 37 money columns became `numeric` in M-06 and
 * none are `double precision`. Prisma's Decimal already serialises to a string
 * through its own toJSON, so this is mostly belt-and-braces — but converting to
 * Number "to make the client simpler" is a one-character change that quietly
 * gives back the binary-float bug the migration existed to remove, and it needs
 * to be somewhere a reviewer can see and refuse.
 *
 * Date is the ordinary case: JSON.stringify already produces ISO-8601 and the
 * contract tests parse it with `new Date(...)`.
 * ========================================================================== */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Deep-convert a Prisma result into something `JSON.stringify` accepts.
 *
 * Recursive rather than a shallow field list because these rows nest: an order
 * carries its calls, a shipment carries its events, a product carries its lots.
 * A shallow version works on every row it is tested against and fails on the
 * first one with a relation loaded.
 */
export function toJson<T>(value: T): Json {
  if (value === null || value === undefined) return null;

  if (typeof value === "bigint") return value.toString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(toJson);

  if (typeof value === "object") {
    // Buffer and friends are not ERP data; passing them through unchanged
    // would produce a byte-array blob nobody wants to see in a response.
    if (Buffer.isBuffer(value)) return value.toString("base64");
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJson(v);
    }
    return out;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  return null;
}

/**
 * Parse a money value arriving from a client.
 *
 * Goes through the string form on purpose. `new Prisma.Decimal(4999.99)` takes
 * the JS double first and inherits whatever it already lost; going via the
 * string keeps the digits the caller actually sent.
 *
 * Returns null for anything unparseable rather than throwing — the caller
 * decides whether a missing price is a validation error or simply absent, and
 * that answer differs between "create an order" and "patch one field".
 */
export function toDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  try {
    return new Prisma.Decimal(text);
  } catch {
    return null;
  }
}

/** Epoch-ms or ISO-8601 in, Date out. The ERP sent epoch-ms everywhere. */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = typeof value === "number" || /^\d+$/.test(String(value))
    ? new Date(Number(value))
    : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}
