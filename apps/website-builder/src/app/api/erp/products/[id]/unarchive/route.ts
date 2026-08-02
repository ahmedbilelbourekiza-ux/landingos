import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** The other half of archive — see the DELETE route for why neither destroys. */
export const POST = tenantRoute<Params>("erp:products:write", async ({ db, session, params }) => {
  const product = await db.catalogProduct.findUnique({
    where: { id: params.id }, select: { id: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");

  await db.catalogProduct.update({ where: { id: params.id }, data: { archived: false } });
  await db.catalogProductEvent.create({
    data: {
      tenantId: session.auth!.tenantId, productId: params.id,
      eventType: "unarchived", actorUserId: session.user.id,
    },
  });

  return apiOk({ id: params.id, archived: false });
});
