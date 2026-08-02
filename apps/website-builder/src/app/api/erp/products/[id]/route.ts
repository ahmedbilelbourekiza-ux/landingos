import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { PRODUCT_SELECT } from "../route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params }) => {
  const product = await db.catalogProduct.findUnique({
    where: { id: params.id }, select: PRODUCT_SELECT,
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");
  return apiOk(toJson(product));
});

/**
 * Archive, not delete.
 *
 * A product is referenced by every order that ever contained it, by its own
 * movement ledger, and by its event timeline. Deleting the row would either
 * cascade that history away or leave it pointing at nothing, and both lose the
 * answer to "what did we sell last year".
 *
 * DELETE is the verb because that is what the console button means to the
 * person pressing it. What it does is set a flag.
 */
export const DELETE = tenantRoute<Params>("erp:products:write", async ({ db, session, params }) => {
  const product = await db.catalogProduct.findUnique({
    where: { id: params.id }, select: { id: true, archived: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");

  await db.catalogProduct.update({ where: { id: params.id }, data: { archived: true } });
  await db.catalogProductEvent.create({
    data: {
      tenantId: session.auth!.tenantId, productId: params.id,
      eventType: "archived", actorUserId: session.user.id,
    },
  });

  return apiOk({ id: params.id, archived: true });
});
