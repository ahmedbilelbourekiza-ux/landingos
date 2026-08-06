import { tenantRoute, apiOk } from "@/lib/api/route";
import { readAllAgentConfigs, computePayroll, type Payroll } from "@/lib/erp/agents";

export const dynamic = "force-dynamic";

/**
 * Payroll for the whole roster over one window.
 *
 * A static segment, so it resolves ahead of `agents/[id]/payroll` rather than
 * being looked up as a member called "payroll" — the same file-layout answer
 * `orders/stats` uses, and the reason neither needs an exemption list.
 */
export const GET = tenantRoute("erp:agents:manage", async ({ db, searchParams }) => {
  const since = Number(searchParams.get("since")) || 0;
  const until = Number(searchParams.get("until")) || Date.now();
  // See the per-member route: one proration rule, keyed on the period, shared
  // with the fixed-cost side so a salary and a rent scale identically (LP.16b).
  const periodType = searchParams.get("periodType");

  const [memberships, configs] = await Promise.all([
    db.membership.findMany({
      select: { userId: true, jobRole: true, suspended: true, user: { select: { email: true, name: true } } },
    }),
    readAllAgentConfigs(db),
  ]);

  // Sequential rather than Promise.all: these are queries on the one
  // interactive transaction withTenant opened, and firing a roster's worth
  // concurrently at a single pinned connection is how P2028 timeouts start.
  const items: Array<Payroll & { email: string; name: string; jobRole: string | null; suspended: boolean }> = [];
  for (const m of memberships) {
    const config = configs.get(m.userId) ?? {
      baseSalaryMonthly: "0", payPerConfirmedOrder: "0", payPerDeliveredOrder: "0",
      weeklyDaysOff: [], missedOrders: 0,
    };
    const payroll = await computePayroll(db, m.userId, config, since, until, periodType);
    items.push({ ...payroll, email: m.user.email, name: m.user.name, jobRole: m.jobRole, suspended: m.suspended });
  }

  return apiOk({ items, since, until, periodType: periodType ?? "custom" });
});
