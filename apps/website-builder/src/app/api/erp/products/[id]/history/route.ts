import { tenantRoute, apiOk, pagination } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * The product timeline. APPEND-ONLY, and deliberately NOT a copy of the stock
 * ledger.
 *
 * Stock changes already have a permanent record in InventoryMovement and
 * StockLot. Duplicating them here would mean two histories that can disagree.
 * This is everything else: price and cost changes, variants added or removed,
 * and the created/archived/unarchived lifecycle.
 */
export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams, 50);

  const [items, total] = await Promise.all([
    db.catalogProductEvent.findMany({
      where: { productId: params.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true, eventType: true, field: true, oldValue: true, newValue: true,
        actorUserId: true, createdAt: true,
      },
    }),
    db.catalogProductEvent.count({ where: { productId: params.id } }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});
