import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { mayTouchOrder, seesWholeBook } from "@/lib/erp/scope";
import { ORDER_STATUSES, updateOrder } from "@/lib/erp/orders";

export const dynamic = "force-dynamic";

const Bulk = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
  action: z.enum(["status", "delete", "assign"]),
  value: z.string().trim().max(64).optional(),
});

/* =============================================================================
 * Bulk actions over a caller-supplied list of ids.
 *
 * The most valuable endpoint on the surface to point somewhere it should not
 * go, because it takes a list of primary keys straight from the request — which
 * is precisely the shape that invites pasting ids you were never given.
 *
 * Three things therefore hold, and each is asserted by a test that violates it:
 *
 *   - Ids from another TENANT do not resolve. The binding and row-level
 *     security see to that; nothing here filters by tenant.
 *   - Ids outside the caller's RECORD scope do not resolve either — the same
 *     ownership check the per-order routes use, applied per id.
 *   - A partial failure is reported PER ID rather than failing the batch. Fifty
 *     orders where one id is stale should move forty-nine, and the caller needs
 *     to know which one did not.
 * ========================================================================== */

export const POST = tenantRoute("erp:orders:write", async ({ db, req, session }) => {
  const parsed = Bulk.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { ids, action, value } = parsed.data;

  if (action === "status" && !ORDER_STATUSES.includes(value as (typeof ORDER_STATUSES)[number])) {
    return apiError(422, "INVALID_INPUT", `"${value}" is not a valid status.`);
  }
  if (action !== "status" && !seesWholeBook(session)) {
    return apiError(403, "FORBIDDEN", "You do not have access to this.");
  }

  const tenantId = session.auth!.tenantId;
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  // Sequential rather than Promise.all. These are writes on one interactive
  // transaction — the one `withTenant` opened — and issuing two hundred of them
  // concurrently on a single pinned connection is how P2028 timeouts start.
  for (const id of ids) {
    const order = await db.fulfillmentOrder.findUnique({
      where: { id },
      select: { id: true, agentUserId: true, followupUserId: true },
    });
    if (!order || !mayTouchOrder(session, order)) {
      results.push({ id, ok: false, error: "not found" });
      continue;
    }

    try {
      if (action === "delete") {
        // The customer record is deliberately left alone. A customer's identity
        // and lifetime history outlive any individual order.
        await db.fulfillmentOrder.delete({ where: { id } });
      } else if (action === "status") {
        await updateOrder(db, tenantId, id, { status: value! });
      } else {
        await updateOrder(db, tenantId, id, { agentUserId: value || null });
      }
      results.push({ id, ok: true });
    } catch {
      results.push({ id, ok: false, error: "failed" });
    }
  }

  return apiOk({
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    results,
  });
});
