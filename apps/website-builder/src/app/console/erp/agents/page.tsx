import { notFound } from "next/navigation";

import { can } from "@landingos/auth";
import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { agentStrings } from "@/lib/console/erp-strings";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";
import { AgentRowActions } from "@/components/console/erp/agent-write";
import { readAllAgentConfigs, JOB_ROLES } from "@/lib/erp/agents";

export const dynamic = "force-dynamic";

/**
 * The staff roster and what each person is paid.
 *
 * SEC-02 LIVES HERE. `GET /api/agents` once returned every password in
 * cleartext and the agent PWA compared it in the browser. The select below
 * names the fields it wants rather than including the user record, so a hash
 * cannot arrive by accident the next time a column is added — which is exactly
 * how it arrived the first time.
 *
 * This is a VIEW over platform memberships, not a staff table. The ERP's
 * `agents` became User + Membership in M-02, and the pay configuration lives in
 * ProductSetting (D-05.4) because the platform must never learn what an ERP
 * payroll rate is.
 *
 * Adding a person is not on this screen and has no button, because it is a
 * platform action — the API answers 501 and says so.
 */
export default async function ErpAgentsScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/agents");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // `erp:agents:manage` is SENSITIVE: no role grants it implicitly, so this is
  // OWNER, ADMIN, or somebody granted it by name.
  if (!session.auth || !can(session.auth, "erp:agents:manage")) notFound();

  const { members, configs } = await withTenant(session.auth.tenantId, async (db) => ({
    members: await db.membership.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        userId: true, role: true, jobRole: true, suspended: true, createdAt: true,
        user: { select: { email: true, name: true } },
      },
    }),
    configs: await readAllAgentConfigs(db),
  }));

  const currency = session.tenant!.currency;
  const money = (v: string) => formatMoney(v, locale, currency);

  /* Phase 6.3d. Reaching this screen already required `erp:agents:manage`,
     which is the same permission every write route here checks — so unlike the
     other screens there is no narrower gate to apply, and the controls exist
     for everyone who can see the page. */
  const errors = actionErrors(t);
  const s = agentStrings(t);
  const jobRoles = JOB_ROLES.map((value) => ({ value, label: t(`erp.jobRole.${value}`) }));

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.agents.title")}</h1>

      <DataTable
        testId="erp-agents-table"
        empty={t("erp.agents.none")}
        rows={members}
        rowKey={(m) => m.userId}
        rowAttrs={(m) => ({ "data-user-id": m.userId })}
        columns={[
          {
            id: "member",
            header: t("erp.agents.member"),
            cell: (m) => (
              <>
                <span className="font-medium">{m.user.name || m.user.email}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground" dir="ltr">
                  {m.user.email}
                </span>
                {m.suspended && (
                  <span
                    data-testid="agent-suspended"
                    className="mt-1 inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {t("erp.agents.suspended")}
                  </span>
                )}
              </>
            ),
          },
          {
            id: "job",
            header: t("erp.agents.jobRole"),
            // The JOB, not the privilege. The ERP kept them separate so a
            // follow-up agent could also be a manager, and collapsing them
            // here would undo that.
            cell: (m) => <span className="text-muted-foreground">{m.jobRole ?? "—"}</span>,
          },
          {
            id: "access",
            header: t("erp.agents.accessRole"),
            cell: (m) => <span className="text-muted-foreground">{m.role}</span>,
          },
          {
            id: "salary",
            header: t("erp.agents.salary"),
            numeric: true,
            align: "end",
            cell: (m) => money(configs.get(m.userId)?.baseSalaryMonthly ?? "0"),
          },
          {
            id: "confirmed",
            header: t("erp.agents.perConfirmed"),
            numeric: true,
            align: "end",
            cell: (m) => money(configs.get(m.userId)?.payPerConfirmedOrder ?? "0"),
          },
          {
            id: "delivered",
            header: t("erp.agents.perDelivered"),
            numeric: true,
            align: "end",
            cell: (m) => money(configs.get(m.userId)?.payPerDeliveredOrder ?? "0"),
          },
          {
            id: "days-off",
            header: t("erp.agents.daysOff"),
            cell: (m) => {
              const days = configs.get(m.userId)?.weeklyDaysOff ?? [];
              return (
                <span className="text-muted-foreground tabular-nums" dir="ltr">
                  {days.length ? days.join(", ") : "—"}
                </span>
              );
            },
          },
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (m) => {
              const config = configs.get(m.userId);
              return (
                <AgentRowActions
                  // Keyed on what the server holds, so a save that changed a
                  // value remounts the form on the stored answer rather than
                  // leaving it showing what was typed.
                  key={`${m.jobRole ?? ""}/${m.suspended}/${(config?.weeklyDaysOff ?? []).join(",")}`}
                  userId={m.userId}
                  suspended={Boolean(m.suspended)}
                  jobRole={m.jobRole ?? ""}
                  pay={{
                    baseSalaryMonthly: config?.baseSalaryMonthly ?? "0",
                    payPerConfirmedOrder: config?.payPerConfirmedOrder ?? "0",
                    payPerDeliveredOrder: config?.payPerDeliveredOrder ?? "0",
                  }}
                  daysOff={config?.weeklyDaysOff ?? []}
                  jobRoles={jobRoles}
                  // Both refusals the API makes are unreachable from here,
                  // because neither control is rendered.
                  isSelf={m.userId === session.user.id}
                  isOwner={m.role === "OWNER"}
                  errors={errors}
                  s={s}
                />
              );
            },
          },
        ]}
      />
    </ConsoleShell>
  );
}
