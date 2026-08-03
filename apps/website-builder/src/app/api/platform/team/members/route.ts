import { tenantRoute, apiOk } from "@/lib/api/route";
import { ASSIGNABLE_ROLES, listMembers } from "@/lib/platform/team";

export const dynamic = "force-dynamic";

/**
 * Everybody in this company.
 *
 * `assignableRoles` rides along with the list for the same reason every ERP
 * write surface ships its vocabulary from the server (D-06.2): a screen that
 * hardcodes its own set of roles goes stale silently the first time the platform
 * grows one, and the version that matters is the one the write routes validate
 * against.
 */
export const GET = tenantRoute("platform:team:read", async ({ db }) => {
  return apiOk({
    items: await listMembers(db),
    assignableRoles: ASSIGNABLE_ROLES,
  });
});
