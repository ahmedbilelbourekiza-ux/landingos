import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const DELETE = tenantRoute<Params>("erp:finance:write", async ({ db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return apiError(404, "NOT_FOUND", "No such charge.");

  // Read first, so an id belonging to another tenant is a 404 rather than a
  // deleteMany that silently reports zero rows and looks like success.
  const charge = await db.unexpectedCharge.findUnique({ where: { id }, select: { id: true } });
  if (!charge) return apiError(404, "NOT_FOUND", "No such charge.");

  await db.unexpectedCharge.delete({ where: { id } });
  return apiOk({ id, deleted: true });
});
