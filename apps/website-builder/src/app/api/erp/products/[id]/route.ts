import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { PRODUCT_SELECT } from "../route";
import { buildProductPatch, productChangeEvents } from "@/lib/erp/catalog";
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
 * Correct a product.
 *
 * The ERP had `PUT /api/products/:id` and the port lost it, so until now a
 * product could be created and archived and never fixed. That mattered most for
 * money: `costPrice` and `packagingCost` are the cost basis every FIFO lot,
 * every delivered-order payment, `/sales-summary` and every saved P&L record is
 * computed from, and a typo at creation was permanent.
 *
 * PATCH, not PUT — see the note on `PATCH /api/erp/orders/[id]`, and
 * `lib/erp/catalog.ts` for the two fields this refuses (`stock`, `variants`)
 * and why refusing them is stricter than the ERP rather than weaker.
 *
 * An archived product can still be edited. Archiving means "stop selling it",
 * not "freeze it": a cost basis discovered to be wrong is discovered from a
 * report about last year, and the row it needs to fix is usually one nobody
 * sells any more.
 */
export const PATCH = tenantRoute<Params>("erp:products:write", async ({ db, session, req, params }) => {
  const before = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { id: true, price: true, costPrice: true, packagingCost: true, brand: true },
  });
  if (!before) return apiError(404, "NOT_FOUND", "No such product.");

  const patch = buildProductPatch(await req.json().catch(() => ({})));
  if (patch.invalid) return apiError(422, "INVALID_INPUT", patch.invalid);

  // An empty patch is a successful no-op, not a 422. A form that submits only
  // the fields a person touched sends nothing when they touched nothing, and
  // refusing that would make "save" fail for doing exactly what was asked.
  const events = productChangeEvents(before, patch.data);

  const updated = await db.catalogProduct.update({
    where: { id: params.id },
    data: patch.data,
    select: PRODUCT_SELECT,
  });

  // Append-only, and written in the same transaction `withTenant` opened, so a
  // product can never end up changed with no record of what changed.
  if (events.length) {
    await db.catalogProductEvent.createMany({
      data: events.map((e) => ({
        tenantId: session.auth!.tenantId,
        productId: params.id,
        eventType: e.eventType,
        field: e.field,
        oldValue: e.oldValue,
        newValue: e.newValue,
        actorUserId: session.user.id,
      })),
    });
  }

  return apiOk(toJson(updated));
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
