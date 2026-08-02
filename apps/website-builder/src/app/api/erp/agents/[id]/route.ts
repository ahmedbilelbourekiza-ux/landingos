import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { writeAgentConfig, readAgentConfig, JOB_ROLES } from "@/lib/erp/agents";

export const dynamic = "force-dynamic";

type Params = { id: string };

const PatchAgent = z.object({
  jobRole: z.string().trim().optional(),
  baseSalaryMonthly: z.union([z.string(), z.number()]).optional(),
  payPerConfirmedOrder: z.union([z.string(), z.number()]).optional(),
  payPerDeliveredOrder: z.union([z.string(), z.number()]).optional(),
});

/**
 * Update one member's ERP configuration.
 *
 * Two stores, on purpose. `jobRole` is a column on Membership because the
 * platform models it — the JOB (confirmation, follow-up) is not the PRIVILEGE,
 * and the ERP kept them separate so a follow-up agent could also be a manager.
 * The pay rates go to ProductSetting, because a payroll rate is ERP data and
 * the platform must not learn what one is. See D-05.4 in lib/erp/agents.ts.
 *
 * The platform ROLE is deliberately not settable here. Changing who is an
 * admin is a platform action with its own screen; routing it through a product
 * would give every product a way to grant privileges in every other product.
 */
export const PATCH = tenantRoute<Params>("erp:agents:manage", async ({ db, req, session, params }) => {
  const parsed = PatchAgent.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const input = parsed.data;

  const membership = await db.membership.findFirst({
    where: { userId: params.id },
    select: { id: true, userId: true },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "No such team member.");

  if (input.jobRole !== undefined) {
    if (!JOB_ROLES.includes(input.jobRole as (typeof JOB_ROLES)[number])) {
      return apiError(422, "INVALID_JOB_ROLE", `"${input.jobRole}" is not a job role.`, {
        valid: [...JOB_ROLES],
      });
    }
    await db.membership.update({ where: { id: membership.id }, data: { jobRole: input.jobRole } });
  }

  const tenantId = session.auth!.tenantId;
  const pay: Record<string, string> = {};
  for (const field of ["baseSalaryMonthly", "payPerConfirmedOrder", "payPerDeliveredOrder"] as const) {
    if (input[field] !== undefined) pay[field] = String(input[field]);
  }
  const config = Object.keys(pay).length
    ? await writeAgentConfig(db, tenantId, params.id, pay)
    : await readAgentConfig(db, tenantId, params.id);

  const after = await db.membership.findFirst({
    where: { userId: params.id },
    select: { userId: true, role: true, jobRole: true, suspended: true },
  });

  return apiOk({ ...after, ...config });
});
