import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { refreshShipment } from "@/lib/erp/shipments";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Poll the carrier for this parcel and store whatever it reports.
 *
 * Manual here; M-15 moves the scheduled version into `services/worker`, because
 * an in-process poller runs once per instance and would double every event on a
 * scaled deployment.
 *
 * Safe to call repeatedly: intake is idempotent on
 * (shipment, eventTime, originalStatus), and the outcome settles once.
 */
export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const result = await refreshShipment(db, session.auth!.tenantId, params.id);
  if (!result) return apiError(404, "NOT_FOUND", "This order has no shipment.");
  if (result.error === "UNKNOWN_ADAPTER") {
    // Said out loud rather than answered 200 with an unchanged timeline. A
    // refresh that quietly does nothing reads as "the carrier has no news",
    // which is a different fact from "we cannot ask this carrier anything".
    return apiError(
      422,
      "UNKNOWN_ADAPTER",
      "This carrier is configured with an integration this deployment does not have, so its tracking cannot be polled.",
    );
  }

  return apiOk({
    shipment: toJson(result.shipment),
    events: result.events.map(toJson),
  });
});
