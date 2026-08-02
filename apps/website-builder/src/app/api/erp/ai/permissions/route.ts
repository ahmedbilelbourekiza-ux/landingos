import { tenantRoute, apiOk } from "@/lib/api/route";
import { ceilingFor, clampPermissions, ALL_AI_PERMISSIONS } from "@/lib/erp/ai";

export const dynamic = "force-dynamic";

/**
 * What an assistant would actually be allowed to do, for THIS caller.
 *
 * The clamp made observable. The ERP could only assert it at unit level because
 * the HTTP surface never exposed the resolved set, which meant the one security
 * boundary in the AI feature was untestable from outside. It is a route now.
 */
export const GET = tenantRoute("erp:ai:use", async ({ db, session, searchParams }) => {
  const ceiling = ceilingFor(session);

  const agentId = searchParams.get("agentId");
  const agent = agentId
    ? await db.aiAgent.findUnique({ where: { id: agentId }, select: { permissions: true } })
    : null;

  return apiOk({
    permissions: clampPermissions(agent?.permissions ?? null, ceiling),
    ceiling,
    all: [...ALL_AI_PERMISSIONS],
  });
});
