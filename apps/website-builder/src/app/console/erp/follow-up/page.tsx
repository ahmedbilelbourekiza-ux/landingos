import Link from "next/link";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { FollowupAssign, Countdown } from "@/components/console/erp/followup-assign";
import { followupAssignStrings, countdownStrings } from "@/lib/console/erp-strings";
import { seesWholeBook } from "@/lib/erp/scope";

export const dynamic = "force-dynamic";

/**
 * The Suivi queue.
 *
 * Record-scoped like the order book: a follow-up agent works their own tasks.
 * The five bucket counts are a whole-company view and are shown only to someone
 * who can already see the whole book — an agent gets their queue, which is what
 * they can act on.
 *
 * The buckets are the department's working states, not order statuses. An order
 * can be confirmed and still need chasing, which is the entire reason this
 * screen exists separately from the order list.
 *
 * LP.21 added the two things R13 and N14 named: a per-row assignment control
 * (the business case is a supervisor moving a difficult customer to a senior
 * agent) and a LIVE countdown. The second matters more than it sounds — this
 * screen's entire subject is a deadline, and "14:20" answers nothing without
 * knowing what time it is now.
 */
export default async function ErpFollowUpScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/follow-up");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const wholeBook = seesWholeBook(session);

  const { tasks, counts, followupMembers } = await withTenant(session.auth!.tenantId, async (db) => {
    const tasks = await db.followupTask.findMany({
      where: wholeBook ? {} : { agentUserId: session.user.id },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true, orderId: true, type: true, status: true,
        dueAt: true, agentUserId: true, reason: true,
      },
    });

    /* Only people the assignment rule would actually accept — the job role,
       which is the stable half of `eligibleAgents`. The rest of that rule
       (suspended, day off, holds `erp:orders:write`) is the ROUTE's and is
       deliberately not reimplemented here: it changes by the hour, and a screen
       that copied it would be a second opinion. Offered only where the route
       accepts an assignment at all (D-06.2) — `followupUserId` is a
       REASSIGNMENT field, so a non-manager gets a 403. */
    const followupMembers = wholeBook
      ? await db.membership.findMany({
          where: { suspended: false, jobRole: { in: ["followup", "both"] } },
          orderBy: { createdAt: "asc" },
          select: { userId: true, user: { select: { name: true, email: true } } },
        })
      : [];

    if (!wholeBook) return { tasks, counts: null, followupMembers };

    const [waiting, inDelivery, needsContact, problems, escalation] = await Promise.all([
      db.fulfillmentOrder.count({ where: { status: "confirmed", followupUserId: null } }),
      db.fulfillmentOrder.count({
        where: {
          deliveryStatus: { in: ["dispatched", "in_transit", "at_office", "out_for_delivery"] },
        },
      }),
      db.followupTask.count({ where: { status: "open", type: "call_customer" } }),
      db.fulfillmentOrder.count({ where: { deliveryOutcome: "returned" } }),
      db.followupTask.count({ where: { status: "overdue" } }),
    ]);
    return {
      tasks,
      counts: { waiting, inDelivery, needsContact, problems, escalation },
      followupMembers,
    };
  });

  const memberOptions = followupMembers.map((m) => ({
    value: m.userId,
    label: m.user.name || m.user.email,
  }));
  const errors = actionErrors(t);
  const assignStrings = followupAssignStrings(t);
  const tickStrings = countdownStrings(t);

  return (
    <ConsoleShell session={session} productId="erp">
      <PageBody>
      <PageHeader title={t("erp.followUp.title")} />

      {counts && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="followup-buckets">
          {[
            ["waiting", t("erp.followUp.waiting"), counts.waiting],
            ["in-delivery", t("erp.followUp.inDelivery"), counts.inDelivery],
            ["needs-contact", t("erp.followUp.needsContact"), counts.needsContact],
            ["problems", t("erp.followUp.problems"), counts.problems],
            ["escalation", t("erp.followUp.escalation"), counts.escalation],
          ].map(([id, label, value]) => (
            <div key={String(id)} data-bucket={String(id)} className="rounded-lg border border-border bg-surface-raised p-4">
              <span className="block text-xs text-muted-foreground">{label}</span>
              <span className="mt-1 block text-2xl font-semibold tabular-nums" dir="ltr">
                {String(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <DataTable
        testId="erp-followup-table"
        empty={t("erp.followUp.none")}
        rows={tasks}
        rowKey={(task) => task.id}
        rowAttrs={(task) => ({ "data-flash-id": task.orderId })}
        columns={[
          {
            id: "order",
            header: t("erp.orders.title"),
            cell: (task) => (
              <Link
                href={`/console/erp/orders/${task.orderId}`}
                className="font-mono text-xs underline-offset-2 hover:underline"
                dir="ltr"
              >
                {task.orderId}
              </Link>
            ),
          },
          {
            id: "type",
            header: t("erp.inventory.reason"),
            cell: (task) => <span className="text-muted-foreground">{task.type ?? "—"}</span>,
          },
          {
            id: "status",
            header: t("erp.orders.status"),
            cell: (task) => <span className="text-muted-foreground">{task.status ?? "—"}</span>,
          },
          {
            id: "due",
            header: t("erp.followUp.due"),
            /* N14 — LIVE. The absolute time is what the server rendered and is
               what shows until the first tick (and forever without JavaScript),
               so nothing is lost; the countdown is what somebody acts on. */
            cell: (task) =>
              task.dueAt ? (
                <Countdown
                  dueAt={task.dueAt.toISOString()}
                  absolute={formatDate(task.dueAt, locale)}
                  s={tickStrings}
                />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          /* R13 — the control. Offered only where the route accepts it, which
             is `seesWholeBook` AND `erp:orders:write`: `followupUserId` is a
             REASSIGNMENT field and the route refuses anybody else by name. */
          ...(wholeBook && can(session.auth!, "erp:orders:write")
            ? [
                {
                  id: "assign",
                  header: t("erp.followUp.assignTo"),
                  cell: (task: (typeof tasks)[number]) => (
                    <FollowupAssign
                      orderId={task.orderId}
                      current={task.agentUserId ?? ""}
                      members={memberOptions}
                      errors={errors}
                      s={assignStrings}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      </PageBody>
    </ConsoleShell>
  );
}
