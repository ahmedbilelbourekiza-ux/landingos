import { tenantRoute, apiOk, pagination } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * The movement ledger for one product. APPEND-ONLY.
 *
 * There is no PATCH and no DELETE here, and their absence is the guarantee:
 * every row carries prevQty and newQty as well as the delta, so the whole
 * history can be reconstructed and none of it can be argued with. A route that
 * edited a movement would make the reconstruction a fiction.
 *
 * `?variant=all` is the default because a product's stock story only makes
 * sense across its variants — reading one variant's ledger in isolation shows
 * a total that never matches the grid.
 */
export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams, 50);
  const variant = searchParams.get("variant");

  const where = {
    productId: params.id,
    ...(variant && variant !== "all" ? { variantName: variant } : {}),
  };

  const [items, total] = await Promise.all([
    db.inventoryMovement.findMany({
      where,
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true, variantName: true, orderId: true, delta: true,
        prevQty: true, newQty: true, reason: true,
        unitCost: true, packagingCost: true, actorUserId: true, ts: true,
      },
    }),
    db.inventoryMovement.count({ where }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});
