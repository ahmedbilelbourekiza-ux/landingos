import { withTenant } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { getAdapter } from "@/lib/erp/carriers";
import { logIntegration } from "@/lib/erp/integration-log";
import { refreshShipmentForOrder } from "@/lib/erp/shipments";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * How many parcels one manual sync may ask about.
 *
 * The same bound the scheduled poll uses, and for the same reason: this is N
 * round trips to somebody else's server behind one button press, and a company
 * with two thousand open parcels must not be able to turn a click into a
 * twenty-minute request. Whatever is left is picked up by the next press or by
 * the scheduled poll.
 */
const SYNC_BATCH = 25;

/* =============================================================================
 * Ask a carrier about everything currently in its hands — LP.14, restoring R3.
 *
 * `Carrier.lastSyncAt` is on the schema and was **written by nothing**. The only
 * way to refresh a parcel was to open its order and press refresh, one at a
 * time — which is the operation an operator wants least, because the question is
 * always "what has moved since yesterday" across the whole day's book.
 *
 * D-LP.5.1 AGAIN, and more sharply than anywhere else: this is up to 25 HTTP
 * round trips. Every one happens OUTSIDE the transaction —  plan, call, record,
 * per parcel — through the same three exported functions the booking route and
 * the scheduled poll compose. Doing it inside `withTenant` would blow the
 * 15-second timeout on the second slow carrier response and roll back the
 * shipment events already ingested.
 *
 * AN ADAPTER THAT CANNOT BE POLLED IS REFUSED BY NAME. ZR declares
 * `canPoll: false` because it publishes no tracking endpoint at all — every
 * update arrives on its webhook. Answering "0 parcels updated" would be
 * indistinguishable from "nothing has moved", which is the LP.2 distinction.
 * ========================================================================== */

export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, session, params, afterCommit }) => {
  const carrier = await db.carrier.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, adapter: true, apiEnabled: true },
  });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  const adapter = getAdapter(carrier.adapter);
  if (!adapter) {
    return apiError(
      422,
      "UNKNOWN_ADAPTER",
      "This carrier is configured with an integration this deployment does not have.",
    );
  }
  if (!carrier.apiEnabled) {
    return apiError(422, "API_DISABLED", "This carrier's API is switched off, so nothing can be asked of it.");
  }
  if (!adapter.canPoll) {
    return apiError(
      422,
      "CARRIER_CANNOT_BE_POLLED",
      `${adapter.label} publishes no tracking endpoint — every update arrives on its webhook, so there is nothing to ask.`,
    );
  }

  // The parcels still in the carrier's hands. A settled one is not asked about
  // again: its outcome is permanent by design, and re-asking would spend a round
  // trip to be told what the ledger already says.
  const open = await db.shipment.findMany({
    where: { carrierId: params.id, crmStatus: { notIn: ["delivered", "returned", "cancelled"] } },
    orderBy: { createdAt: "asc" },
    take: SYNC_BATCH,
    select: { orderId: true },
  });

  const tenantId = session.auth!.tenantId;

  afterCommit(async () => {
    let refreshed = 0;
    let inserted = 0;
    let errors = 0;
    const failures: string[] = [];

    for (const { orderId } of open) {
      // `refreshShipmentForOrder` IS the three phases — plan in a binding, call
      // in none, ingest in a binding — and it is the same function the manual
      // "ask the carrier" button uses. One ingest path, so a synced parcel
      // raises follow-up tasks and settles its outcome exactly as a pushed one
      // does. Reimplementing the loop here would be a second ingest path and
      // the half nobody tested.
      const outcome = await refreshShipmentForOrder(tenantId, orderId);
      if (!outcome) continue;

      if (outcome.error) {
        errors += 1;
        const message = outcome.message ?? outcome.error;
        failures.push(message);
        await withTenant(tenantId, (tx) =>
          logIntegration(tx, tenantId, {
            entity: "carrier",
            entityId: params.id,
            event: "sync_error",
            result: "failure",
            message,
            request: { orderId },
          }),
        );
        continue;
      }

      refreshed += 1;
      inserted += outcome.events?.length ?? 0;
    }

    const syncedAt = new Date();
    await withTenant(tenantId, async (tx) => {
      await tx.carrier.update({ where: { id: params.id }, data: { lastSyncAt: syncedAt } });
      await logIntegration(tx, tenantId, {
        entity: "carrier",
        entityId: params.id,
        event: "manual_sync",
        result: errors ? "failure" : "success",
        message: `Asked about ${open.length} parcel(s); ${inserted} new event(s), ${errors} error(s).`,
        request: { asked: open.length, limit: SYNC_BATCH },
        response: { refreshed, inserted, errors, failures: failures.slice(0, 5) },
      });
    });

    return apiOk({
      asked: open.length,
      refreshed,
      inserted,
      errors,
      // Said explicitly, because "25" looks like "all of them" to somebody with
      // 200 open parcels and the next press is what finishes the job.
      capped: open.length === SYNC_BATCH,
      syncedAt: syncedAt.toISOString(),
    });
  });

  return apiOk({ asked: open.length, refreshed: 0, inserted: 0, errors: 0 });
});
