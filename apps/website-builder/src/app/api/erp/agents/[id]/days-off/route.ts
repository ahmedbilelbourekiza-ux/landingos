import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { writeAgentConfig, cleanDaysOff } from "@/lib/erp/agents";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Recurring weekly days off.
 *
 * Out-of-range values are DROPPED rather than refused, which is what the ERP
 * did and what its test asserts. That is unusual for this codebase — settings
 * reject a bad value outright — and the difference is deliberate: this comes
 * from a row of seven checkboxes, so junk in the array means a client bug, not
 * a person's intent, and refusing the whole request would lose the six correct
 * boxes along with the bad one.
 */
export const PUT = tenantRoute<Params>("erp:agents:manage", async ({ db, req, session, params }) => {
  const body = (await req.json().catch(() => ({}))) as { weeklyDaysOff?: unknown };

  const membership = await db.membership.findFirst({
    where: { userId: params.id }, select: { id: true },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "No such team member.");

  const config = await writeAgentConfig(db, session.auth!.tenantId, params.id, {
    weeklyDaysOff: cleanDaysOff(body.weeklyDaysOff),
  });

  return apiOk({ userId: params.id, ...config });
});
