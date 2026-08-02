import { tenantRoute, apiOk, pagination } from "@/lib/api/route";
import { CLIENT_SELECT, clientFilter, withDerived } from "@/lib/erp/clients";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/**
 * The permanent customer registry.
 *
 * Gated on `erp:clients:read`, which D-05.1 made sensitive: this is every
 * customer's name, phone number, address and lifetime spend, and no role grants
 * it implicitly. That is not a general rule about reads — it is a specific one
 * about this table and the finance screens, and the reasoning is in
 * packages/auth/src/rbac.ts.
 */
export const GET = tenantRoute("erp:clients:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const where = clientFilter(searchParams.get("search") ?? undefined);

  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      orderBy: [{ lastOrderAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: CLIENT_SELECT,
    }),
    db.client.count({ where }),
  ]);

  return apiOk({
    items: rows.map((c) => toJson(withDerived(c))),
    page,
    pageSize,
    total,
  });
});
