import { tenantRoute, apiOk, pagination } from "@/lib/api/route";
import {
  CLIENT_SELECT, clientFilters, clientHistoryPhones, withDerived,
} from "@/lib/erp/clients";
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
 *
 * LP.10 widened the filters from ONE (search) to eight, through `clientFilters`
 * in the module that describes the controls for them. The legacy had twelve and
 * the screen offered all of them; this had nine registered on `Client` and a
 * screen offering `search`, which is the LP.3 shape of defect — a capability
 * that exists and cannot be found.
 */
export const GET = tenantRoute("erp:clients:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);

  // Resolved first, because `product` and `salesChannelName` are properties of
  // the customer's ORDERS and `Client` has no relation to reach them through.
  const phones = await clientHistoryPhones(db, searchParams);
  const where = {
    ...clientFilters(searchParams),
    // `null` means neither history filter was asked for. An empty ARRAY is a
    // different answer — "the filter matched no orders" — and must narrow to
    // nothing rather than being ignored.
    ...(phones === null ? {} : { phone: { in: phones } }),
  };

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
