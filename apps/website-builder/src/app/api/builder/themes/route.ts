import { tenantRoute, apiOk } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/**
 * Storefront themes available to this tenant.
 *
 * Built-in themes are COPIED into a tenant rather than shared, so editing one
 * can never alter another tenant's pages — which is why this is a plain
 * tenant-scoped read with no platform fallback.
 */
export const GET = tenantRoute("website-builder:read", async ({ db }) => {
  const items = await (db as any).landingTheme.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return apiOk({ items });
});
