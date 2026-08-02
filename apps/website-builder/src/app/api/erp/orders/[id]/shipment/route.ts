import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { createShipment, SHIPMENT_SELECT, EVENT_SELECT } from "@/lib/erp/shipments";
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

/** Book the parcel. Idempotent — a second call returns the existing shipment. */
export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, session, params }) => {
  const { denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const order = await db.fulfillmentOrder.findUnique({
    where: { id: params.id }, select: { id: true, carrierCode: true },
  });
  if (!order) return apiError(404, "NOT_FOUND", "No such order.");

  const result = await createShipment(db, session.auth!.tenantId, order);
  if (!result.shipment) {
    return apiError(422, "NO_CARRIER", "No carrier is configured for this order.");
  }

  const events = await db.shipmentEvent.findMany({
    where: { shipmentId: result.shipment.id },
    orderBy: [{ eventTime: "asc" }, { id: "asc" }],
    select: EVENT_SELECT,
  });

  return apiOk(
    { shipment: toJson(result.shipment), events: events.map(toJson) },
    { status: result.created ? 201 : 200 },
  );
});
