import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { refreshShipmentForOrder } from "@/lib/erp/shipments";
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
 *
 * THE CARRIER IS ASKED OUTSIDE THIS REQUEST'S TRANSACTION (D-LP.5.1) — same
 * reason as booking, and the same three phases, composed in
 * `refreshShipmentForOrder`.
 */
export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, session, params, afterCommit }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const tenantId = session.auth!.tenantId;

  afterCommit(async () => {
    const result = await refreshShipmentForOrder(tenantId, params.id);
    if (!result) return apiError(404, "NOT_FOUND", "This order has no shipment.");

    // Each of these is said out loud rather than answered 200 with an unchanged
    // timeline. A refresh that quietly does nothing reads as "the carrier has no
    // news", which is a different fact from every one of the reasons below.
    switch (result.error) {
      case "UNKNOWN_ADAPTER":
        return apiError(
          422,
          "UNKNOWN_ADAPTER",
          "This carrier is configured with an integration this deployment does not have, so its tracking cannot be polled.",
        );
      case "NO_POLLING":
        return apiError(
          422,
          "CARRIER_NO_POLLING",
          "This carrier publishes no tracking endpoint — it reports by webhook only, so there is nothing to ask.",
        );
      case "CARRIER_UNREACHABLE":
      case "CARRIER_REJECTED":
      case "ADDRESS_UNRESOLVED":
        return apiError(502, "CARRIER_UNREACHABLE", result.message ?? "The carrier could not be reached.");
    }

    return apiOk({
      shipment: toJson(result.shipment),
      events: result.events.map(toJson),
    });
  });

  // Replaced by the step above in every ordinary case; see the note on the
  // booking route.
  return apiError(502, "CARRIER_UNREACHABLE", "The carrier could not be reached.");
});
