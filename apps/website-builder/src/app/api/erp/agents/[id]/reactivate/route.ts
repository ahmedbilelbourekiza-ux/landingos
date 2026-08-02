import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** The other half of suspension. Their existing session works again at once. */
export const POST = tenantRoute<Params>("erp:agents:manage", async ({ db, params }) => {
  const membership = await db.membership.findFirst({
    where: { userId: params.id }, select: { id: true },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "No such team member.");

  await db.membership.update({ where: { id: membership.id }, data: { suspended: false } });
  return apiOk({ userId: params.id, suspended: false });
});
