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
  // LP.16b. A monthly salary scaled onto a WEEK is a quarter of it, not
  // 7/30.44 of it — the same rule a rent is prorated by, so the two cannot
  // disagree. Absent, it stays the day-count answer this route already gave.
  const periodType = searchParams.get("periodType");

  const config = await readAgentConfig(db, session.auth!.tenantId, params.id);
  const payroll = await computePayroll(db, params.id, config, since, until, periodType);

  return apiOk({ ...payroll, jobRole: membership.jobRole });
});
