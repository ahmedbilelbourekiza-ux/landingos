import { tenantRoute, apiOk } from "@/lib/api/route";
import { toJson } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/**
 * The assistants this caller may actually use.
 *
 * Gated on `erp:ai:use` rather than the manager permission the configuration
 * routes need: an agent cannot set up a provider, but the agent console still
 * has to list the assistants available to them, and refusing that would make
 * the whole feature manager-only for no reason.
 *
 * Carries no prompt and no permission list — those are configuration. This
 * answers "what can I pick from".
 */
export const GET = tenantRoute("erp:ai:use", async ({ db }) => {
  const items = await db.aiAgent.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, role: true },
  });
  return apiOk({ items: items.map(toJson) });
});
