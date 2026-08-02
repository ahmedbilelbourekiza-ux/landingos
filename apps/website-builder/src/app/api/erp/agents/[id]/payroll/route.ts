import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { readAgentConfig, computePayroll } from "@/lib/erp/agents";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = tenantRoute<Params>("erp:agents:manage", async ({ db, session, params, searchParams }) => {
  const membership = await db.membership.findFirst({
    where: { userId: params.id }, select: { userId: true, jobRole: true },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "No such team member.");

  const since = Number(searchParams.get("since")) || 0;
  const until = Number(searchParams.get("until")) || Date.now();

  const config = await readAgentConfig(db, session.auth!.tenantId, params.id);
  const payroll = await computePayroll(db, params.id, config, since, until);

  return apiOk({ ...payroll, jobRole: membership.jobRole });
});
