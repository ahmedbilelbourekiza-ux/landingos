import { tenantRoute, apiOk } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * The values that actually appear in this tenant's customer list.
 *
 * Derived from the data rather than from the 58-wilaya reference table on
 * purpose: a filter dropdown listing every province in the country, 54 of which
 * match nothing, is a worse filter than one listing the six a company actually
 * ships to.
 */
export const GET = tenantRoute("erp:clients:read", async ({ db }) => {
  const [wilayas, communes] = await Promise.all([
    db.client.groupBy({ by: ["wilaya"], _count: { _all: true }, orderBy: { wilaya: "asc" } }),
    db.client.groupBy({ by: ["commune"], _count: { _all: true }, orderBy: { commune: "asc" } }),
  ]);

  const clean = (rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string) =>
    rows
      .map((r) => ({ value: String(r[key] ?? ""), count: r._count._all }))
      .filter((r) => r.value !== "");

  return apiOk({
    wilayas: clean(wilayas, "wilaya"),
    communes: clean(communes, "commune"),
  });
});
