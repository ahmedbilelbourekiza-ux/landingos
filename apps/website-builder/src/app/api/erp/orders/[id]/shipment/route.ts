import { withTenant } from "@landingos/db";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { bookShipment, SHIPMENT_SELECT, EVENT_SELECT } from "@/lib/erp/shipments";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:orders:read", async ({ db, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const shipment = await db.shipment.findFirst({
    where: { orderId: params.id }, select: SHIPMENT_SELECT,
  });
  if (!shipment) return apiOk({ shipment: null, events: [] });

  const events = await db.shipmentEvent.findMany({
    where: { shipmentId: shipment.id },
    orderBy: [{ eventTime: "asc" }, { id: "asc" }],
    select: EVENT_SELECT,
  });

  return apiOk({ shipment: toJson(shipment), events: events.map(toJson) });
});

/**
 * Book the parcel. Idempotent — a second call returns the existing shipment.
 *
 * THE CARRIER IS ASKED AFTER THIS REQUEST'S TRANSACTION COMMITS (D-LP.5.1).
 * `tenantRoute` runs a handler inside an interactive transaction whose timeout
 * is 15 seconds; a real carrier is three HTTP round trips to somebody else's
 * server, and holding a database connection across them turns their latency
 * into this tenant's rolled-back writes. The ownership check needs the binding
 * and stays inside it; the booking does not and does not.
 */
export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, session, params, afterCommit }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const tenantId = session.auth!.tenantId;

  afterCommit(async () => {
    const result = await bookShipment(tenantId, params.id);

    if (!result.shipment) {
      // Four different problems and four different fixes, so four codes.
      // "Unknown adapter" means the carrier row names an integration this
      // deployment does not have; "address unresolved" means the carrier does
      // not recognise the wilaya or commune ON THE ORDER, which is a spelling
      // correction somebody can make in a minute — and could not make at all
      // from a generic failure.
      switch (result.error) {
        case "UNKNOWN_ADAPTER":
          return apiError(
            422,
            "UNKNOWN_ADAPTER",
            "This carrier is configured with an integration this deployment does not have, so no parcel can be booked with it.",
          );
        case "ADDRESS_UNRESOLVED":
          return apiError(422, "ADDRESS_UNRESOLVED", result.message ?? "The carrier does not recognise this address.");
        case "CARRIER_REJECTED":
          return apiError(422, "CARRIER_REJECTED", result.message ?? "The carrier refused the parcel.");
        case "CARRIER_UNREACHABLE":
          return apiError(502, "CARRIER_UNREACHABLE", result.message ?? "The carrier could not be reached.");
        default:
          return apiError(422, "NO_CARRIER", "No carrier is configured for this order.");
      }
    }

    const events = await withTenant(tenantId, (fresh) =>
      fresh.shipmentEvent.findMany({
        where: { shipmentId: result.shipment!.id },
        orderBy: [{ eventTime: "asc" }, { id: "asc" }],
        select: EVENT_SELECT,
      }),
    );

    return apiOk(
      { shipment: toJson(result.shipment), events: events.map(toJson) },
      { status: result.created ? 201 : 200 },
    );
  });

  // Replaced by the step above in every ordinary case. Reached only if it threw
  // — which `tenantRoute` logs — and a booking whose outcome is unknown must
  // not read as one that succeeded.
  return apiError(502, "CARRIER_UNREACHABLE", "The carrier could not be reached.");
});
