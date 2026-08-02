import "server-only";

import { can } from "@landingos/auth";
import type { ConsoleSession } from "@/lib/console/session";

/* =============================================================================
 * The AI surface's permission model (SEC-03).
 *
 * The original defect: `/api/ai/chat/stream` was unauthenticated and, with
 * `agentId` omitted, fell back to an assistant holding EVERY permission —
 * including `read_customers`. A stranger could have the model read out the
 * customer database on the owner's token budget. `actor` and `scopedAgent` were
 * plain query parameters, so naming somebody else read their history.
 *
 * THE CLAMP IS THE BOUNDARY.
 *
 * A configured assistant row carries a permission list, and that list is a
 * REQUEST, not a grant. What the assistant actually gets is the intersection of
 * what the row asks for and what the CALLER already holds. Without that, an
 * assistant becomes a way to exceed your own access by asking a model to fetch
 * something you could not fetch yourself — and it is a particularly bad one,
 * because the answer arrives as prose with no audit trail attached.
 * ========================================================================== */

/** What an assistant can be asked to do. */
export const ALL_AI_PERMISSIONS = [
  "read_orders",
  "read_customers",
  "read_products",
  "read_inventory",
  "read_shipments",
  "read_analytics",
] as const;

export type AiPermission = (typeof ALL_AI_PERMISSIONS)[number];

/**
 * Which ERP permission each AI capability requires of the CALLER.
 *
 * `read_analytics` maps to `erp:finance:read` deliberately. It aggregates
 * across every order in the tenant and ignores the record-level scope that
 * limits an agent to their own queue — so granting it to a confirmation agent
 * hands them the whole order book through the model instead of through the API,
 * which is the same exposure by a longer route. D-05.1 made that permission
 * sensitive, and this is one of the reasons.
 *
 * `read_customers` is NOT gated on `erp:clients:read`. An agent needs the
 * customer's phone number to do their job, and their orders are already scoped
 * server-side — the model can only reach the rows they could reach anyway.
 */
const REQUIRES: Record<AiPermission, string> = {
  read_orders: "erp:orders:read",
  read_customers: "erp:orders:read",
  read_products: "erp:products:read",
  read_inventory: "erp:products:read",
  read_shipments: "erp:orders:read",
  read_analytics: "erp:finance:read",
};

/** The most this caller could ever grant an assistant. */
export function ceilingFor(session: ConsoleSession): AiPermission[] {
  if (!session.auth) return [];
  return ALL_AI_PERMISSIONS.filter((p) => can(session.auth!, REQUIRES[p]));
}

/**
 * What an assistant actually gets: what it asked for, clamped to the ceiling.
 *
 * A null or absent request means "everything you are allowed", which is what
 * the ERP's default assistant meant — and is safe here precisely because the
 * ceiling is the caller's rather than the owner's.
 */
export function clampPermissions(
  requested: unknown,
  ceiling: readonly AiPermission[],
): AiPermission[] {
  if (!Array.isArray(requested)) return [...ceiling];
  const asked = new Set(requested.map(String));
  return ceiling.filter((p) => asked.has(p));
}
