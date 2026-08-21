import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* =============================================================================
 * SEC.9 (LB.23 review) — the disconnect that was documented but never built.
 *
 * The intake route's own comment promised it: "Clearing a token is a separate,
 * explicit act (DELETE the row), not an accidental side effect of an edit."
 * No such route existed, so a compromised or expiring credential could only be
 * OVERWRITTEN from the console, never removed — revoking the stored copy
 * required database access, which is the LB.23c dead-end shape applied to the
 * exit instead of the entrance.
 *
 * DELETE removes the row, and with it — by the schema's own
 * `onDelete: Cascade` — every AdSpendDaily row that hangs off it. That is
 * what disconnecting means here and it is stated rather than discovered:
 * spend history belongs to the account it was pulled for, and keeping orphan
 * numbers attached to no credential would be the silent-zeros defect with
 * extra steps. Re-connecting re-pulls the window (the sync is an idempotent
 * upsert over a 90-day window on demand).
 *
 * `deleteMany` + count, the tracking `[id]` route's shape: under RLS another
 * tenant's id deletes zero rows and answers 404 — the same answer a
 * nonexistent id gets, so the route is not an existence oracle.
 * ========================================================================== */

export const DELETE = tenantRoute<Params>("platform:integrations:manage", async ({ db, params }) => {
  const { count } = await (db as any).adAccount.deleteMany({ where: { id: params.id } });
  if (count === 0) return apiError(404, "NOT_FOUND", "That advertising account does not exist.");
  return apiOk({ id: params.id, deleted: true });
});
