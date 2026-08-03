import Link from "next/link";

import { withTenant } from "@landingos/db";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";
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
 */
export default async function ErpFollowUpScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/follow-up");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const wholeBook = seesWholeBook(session);

  const { tasks, counts } = await withTenant(session.auth!.tenantId, async (db) => {
    const tasks = await db.followupTask.findMany({
      where: wholeBook ? {} : { agentUserId: session.user.id },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true, orderId: true, type: true, status: true,
        dueAt: true, agentUserId: true, reason: true,
      },
    });

    if (!wholeBook) return { tasks, counts: null };

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
    return { tasks, counts: { waiting, inDelivery, needsContact, problems, escalation } };
  });

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.followUp.title")}</h1>

      {counts && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="followup-buckets">
          {[
            ["waiting", t("erp.followUp.waiting"), counts.waiting],
            ["in-delivery", t("erp.followUp.inDelivery"), counts.inDelivery],
            ["needs-contact", t("erp.followUp.needsContact"), counts.needsContact],
            ["problems", t("erp.followUp.problems"), counts.problems],
            ["escalation", t("erp.followUp.escalation"), counts.escalation],
          ].map(([id, label, value]) => (
            <div key={String(id)} data-bucket={String(id)} className="rounded-lg border border-border p-4">
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
            cell: (task) => (
              <span className="text-muted-foreground">
                {task.dueAt ? formatDate(task.dueAt, locale) : "—"}
              </span>
            ),
          },
        ]}
      />
    </ConsoleShell>
  );
}
