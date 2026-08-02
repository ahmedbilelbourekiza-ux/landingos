import { tenantRoute, apiOk } from "@/lib/api/route";
import { readAllAgentConfigs } from "@/lib/erp/agents";

export const dynamic = "force-dynamic";

/**
 * The ERP's staff roster.
 *
 * This is a VIEW over platform memberships, not a second staff table — the
 * ERP's `agents` table became User + Membership in M-02, and re-creating it
 * here would stand up the second identity system that migration removed.
 *
 * SEC-02 lives here. `GET /api/agents` used to return every password in
 * cleartext, and the agent PWA compared it in the browser. The select below
 * names the fields it wants rather than spreading the user record, so a hash
 * cannot arrive by accident the next time a column is added — which is exactly
 * how it arrived the first time.
 */
export const GET = tenantRoute("erp:agents:manage", async ({ db }) => {
  const memberships = await db.membership.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      role: true,
      jobRole: true,
      suspended: true,
      permissions: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true, locale: true } },
    },
  });

  const configs = await readAllAgentConfigs(db);

  return apiOk({
    items: memberships.map((m) => {
      const config = configs.get(m.userId);
      return {
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        jobRole: m.jobRole,
        suspended: m.suspended,
        permissions: m.permissions,
        baseSalaryMonthly: config?.baseSalaryMonthly ?? "0",
        payPerConfirmedOrder: config?.payPerConfirmedOrder ?? "0",
        payPerDeliveredOrder: config?.payPerDeliveredOrder ?? "0",
        weeklyDaysOff: config?.weeklyDaysOff ?? [],
        missedOrders: config?.missedOrders ?? 0,
        createdAt: m.createdAt.toISOString(),
      };
    }),
  });
});
