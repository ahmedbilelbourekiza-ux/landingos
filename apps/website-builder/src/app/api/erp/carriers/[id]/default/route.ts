import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Make this the tenant's default carrier.
 *
 * Clearing the previous default first, in the same transaction, is what keeps
 * "the default" singular. Two rows flagged default means shipment creation
 * picks whichever the database returns first, which is stable right up until it
 * is not.
 */
export const POST = tenantRoute<Params>("erp:shipments:write", async ({ db, params }) => {
  const carrier = await db.carrier.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!carrier) return apiError(404, "NOT_FOUND", "No such carrier.");

  await db.carrier.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  await db.carrier.update({ where: { id: params.id }, data: { isDefault: true, active: true } });

  return apiOk({ id: params.id, isDefault: true });
});
