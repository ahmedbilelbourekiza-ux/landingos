import { tenantRoute, apiOk, pagination } from "@/lib/api/route";
import { ERP_PRODUCT } from "@/lib/erp/settings";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/**
 * The ERP's slice of the platform audit trail.
 *
 * The ERP had its own `audit_log` table. It did not survive the port (M-02):
 * the platform's AuditEvent carries a tenant AND a product, so one table serves
 * every product, and a second per-product trail would mean a manager reviewing
 * "what changed" has two places to look and no way to interleave them.
 *
 * Filtered to this product here, which is why the route lives under /api/erp
 * rather than /api/platform — the platform-wide view is a different screen for
 * a different question.
 */
export const GET = tenantRoute("erp:audit:read", async ({ db, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);

  const where = {
    product: ERP_PRODUCT,
    ...(searchParams.get("entity") ? { entity: searchParams.get("entity")! } : {}),
    ...(searchParams.get("entityId") ? { entityId: searchParams.get("entityId")! } : {}),
    ...(searchParams.get("action") ? { action: searchParams.get("action")! } : {}),
  };

  const [items, total] = await Promise.all([
    db.auditEvent.findMany({
      where,
      // Newest first: the question is almost always "what just changed", and an
      // audit trail that opens on the oldest entry answers a question nobody
      // asked and needs paging to reach the one they did.
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true, userId: true, entity: true, entityId: true,
        action: true, payload: true, createdAt: true,
      },
    }),
    db.auditEvent.count({ where }),
  ]);

  return apiOk({ items: items.map(toJson), page, pageSize, total });
});
