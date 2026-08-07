import Link from "next/link";
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
import { readAllAgentConfigs, computePayroll, JOB_ROLES } from "@/lib/erp/agents";
import { alignedRange } from "@/lib/erp/prorate";

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

  const { members, configs, flagged, payroll } = await withTenant(session.auth.tenantId, async (db) => {
    const members = await db.membership.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        userId: true, role: true, jobRole: true, suspended: true, createdAt: true,
        user: { select: { email: true, name: true } },
      },
    });
    const configs = await readAllAgentConfigs(db);

    /* R11 — THE FLAG NOBODY COULD SEE. `OrderCall.suspicious` is computed and
       stored on every logged call shorter than the tenant's `minCallSeconds`
       that was nevertheless marked confirmed. The whole point of that setting is
       catching somebody who marks orders confirmed without really phoning, and
       the data was being collected where no screen showed it. One `groupBy`. */
    const rows = await db.orderCall.groupBy({
      by: ["agentUserId"],
      where: { suspicious: true },
      _count: { _all: true },
    });
    const flagged = new Map(
      rows.map((r) => [r.agentUserId ?? "", (r._count as { _all: number })._all]),
    );

    /* N11 — the payroll report. `GET /api/erp/agents/payroll` existed and
       NOTHING RENDERED IT, so the numbers an agent is actually paid were
       reachable only by hand-typing a URL. Computed for the current calendar
       month, aligned, under the same proration rule LP.16b made shared — so the
       salary line here and on a saved P&L cannot disagree. */
    const month = alignedRange("month")!;
    const payroll = new Map<string, Awaited<ReturnType<typeof computePayroll>>>();
    for (const m of members) {
      const config = configs.get(m.userId) ?? {
        baseSalaryMonthly: "0", payPerConfirmedOrder: "0", payPerDeliveredOrder: "0",
        weeklyDaysOff: [], missedOrders: 0,
      };
      payroll.set(
        m.userId,
        await computePayroll(db, m.userId, config, month.start, month.end, "month"),
      );
    }

    return { members, configs, flagged, payroll };
  });

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

      {/* AUDIT.6. Adding a person genuinely is a platform action (M-02) and this
          screen was right not to have the button — but the reason lived in a
          source comment, and an operator standing on the staff roster with no
          button and no sentence has a workflow they cannot find. The legacy has
          "Add agent" right here.

          D-06.2 decides whether it is a LINK or just the sentence: `platform:team:*`
          is SENSITIVE, so `erp:agents:manage` does not carry it. Somebody granted
          the roster by name would otherwise be sent to a screen that 404s. */}
      <p className="mt-1 text-sm text-muted-foreground" data-testid="agents-add-hint">
        {t("erp.agents.addElsewhere")}
        {can(session.auth, "platform:team:read") && (
          <>
            {" "}
            <Link href="/console/settings/team" className="underline underline-offset-2">
              {t("erp.agents.goToTeam")}
            </Link>
          </>
        )}
      </p>

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
            // R11. The flag was computed, stored, and shown nowhere.
            id: "flagged",
            header: t("erp.agents.suspicious"),
            numeric: true,
            align: "end",
            cell: (m) => {
              const n = flagged.get(m.userId) ?? 0;
              return n === 0 ? (
                <span className="text-muted-foreground">0</span>
              ) : (
                <Link
                  href={`/console/erp/orders?suspicious=true&agentUserId=${m.userId}`}
                  data-flagged={n}
                  className="font-medium underline"
                >
                  {n}
                </Link>
              );
            },
          },
          {
            // R14. The counter only ever ROSE — the sweep increments it and
            // `autoSuspend` locks the account out at `suspendThreshold`, with no
            // way back except editing a ProductSetting row by hand.
            id: "missed",
            header: t("erp.agents.missed"),
            numeric: true,
            align: "end",
            cell: (m) => (
              <span data-missed={configs.get(m.userId)?.missedOrders ?? 0}>
                {configs.get(m.userId)?.missedOrders ?? 0}
              </span>
            ),
          },
          {
            // N11. `GET /api/erp/agents/payroll` existed and nothing rendered
            // it, so what somebody is actually paid was reachable only by
            // hand-typing a URL.
            id: "pay",
            header: t("erp.agents.payroll"),
            numeric: true,
            align: "end",
            cell: (m) => (
              <span data-pay={m.userId} title={t("erp.agents.payrollHint")}>
                {money(payroll.get(m.userId)?.totalPay ?? "0")}
              </span>
            ),
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
                  missedOrders={config?.missedOrders ?? 0}
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
