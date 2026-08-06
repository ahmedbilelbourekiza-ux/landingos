import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { maskCarrier, preserveSecrets, isKnownAdapter } from "@/lib/erp/carriers";
import { CARRIER_SELECT, unknownAdapterMessage } from "../route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:shipments:write", async ({ db, params }) => {
  const carrier = await db.carrier.findUnique({ where: { id: params.id }, select: CARRIER_SELECT });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");
  return apiOk(maskCarrier(toJson(carrier) as Record<string, unknown>));
});

/**
 * Update a carrier.
 *
 * PUT because the console reads the whole object, edits it and sends it back —
 * which is exactly the flow that would otherwise destroy the stored
 * credentials. `preserveSecrets` drops any field whose value came back as the
 * mask, so the real key survives a round trip through a form that never saw it.
 */
export const PUT = tenantRoute<Params>("erp:shipments:write", async ({ db, req, params }) => {
  const carrier = await db.carrier.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Same gate as create. Editing a working carrier to name an integration this
  // deployment does not have is the same defect arriving through the other door.
  if (typeof body.adapter === "string" && !isKnownAdapter(body.adapter)) {
    return apiError(422, "UNKNOWN_ADAPTER", unknownAdapterMessage(body.adapter));
  }

  const updated = await db.carrier.update({
    where: { id: params.id },
    data: {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.adapter === "string" ? { adapter: body.adapter } : {}),
      ...(typeof body.apiUrl === "string" ? { apiUrl: body.apiUrl } : {}),
      ...(body.apiEnabled !== undefined ? { apiEnabled: Boolean(body.apiEnabled) } : {}),
      ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      ...preserveSecrets(body),
    },
    select: CARRIER_SELECT,
  });

  return apiOk(maskCarrier(toJson(updated) as Record<string, unknown>));
});

/**
 * Deactivate, not delete.
 *
 * Shipments reference their carrier, and the relation is SetNull — deleting the
 * row would leave historical parcels with no carrier and no way to say who
 * carried them.
 */
export const DELETE = tenantRoute<Params>("erp:shipments:write", async ({ db, params }) => {
  const carrier = await db.carrier.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  await db.carrier.update({ where: { id: params.id }, data: { active: false, isDefault: false } });
  return apiOk({ id: params.id, active: false });
});
