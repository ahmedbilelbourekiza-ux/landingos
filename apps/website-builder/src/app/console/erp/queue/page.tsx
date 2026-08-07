import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { QueueCard, type QueueStrings, type QueueOrder } from "@/components/console/erp/queue-card";
import { FollowupResolve } from "@/components/console/erp/followup-resolve";
import { scopedWhere, seesWholeBook, followupScope } from "@/lib/erp/scope";
import {
  ACTIVE_STATUSES, TERMINAL_STATUSES, ORDER_STATUSES,
  CALL_RESULTS, NOTE_TYPES, ORDER_LIST_SELECT, orderFilters,
} from "@/lib/erp/orders";
import { readSettings } from "@/lib/erp/settings";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The confirmation agent's queue — Phase 6.4a.
 *
 * This is the port of `apps/erp/agent.html`, the last thing that application
 * served with no replacement. It is deliberately a SCREEN on the console rather
 * than a second application: the platform session is a cookie on this origin, so
 * the ERP's own login screen and its stored server URL have nothing to port to,
 * and every control here calls the same routes the order detail calls.
 *
 * WHAT IT IS NOT. The ERP's app also carried a notification bell with Web Push
 * and an AI assistant. Neither ports today and neither is faked: notifications
 * are M-16 and have no platform transport, and the AI routes answer 501 by
 * design because calling a model is deployment configuration. Building either
 * against something that does not exist would encode a contract nobody has
 * designed — the same reasoning that deferred two test files in 5.1.
 *
 * OLDEST FIRST, IN THE QUERY. The ERP sorted client-side over every order it had
 * downloaded, by three keys — overdue, then pending, then newest. Oldest-first
 * gets the same order at the top for the same reason (the longest-waiting
 * customer has been waiting longest) and it is one `ORDER BY` rather than a sort
 * over a full table download, which is what PERF-02 was about. The overdue
 * badge is still computed and shown; it just is not what decides the order.
 * ========================================================================== */

const PAGE_SIZE = 100;

export default async function ErpQueueScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/queue");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // `erp:orders:write` is what every control on this screen calls. A queue you
  // cannot work is the order list, which already exists.
  if (!session.auth || !can(session.auth, "erp:orders:write")) notFound();

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") params.set(k, v);
  }

  /**
   * The follow-up queue, with the order each task is about.
   *
   * `FollowupTask.orderId` is a plain column with no relation — the ERP
   * referenced orders by value and M-06 did not invent a foreign key for it —
   * so the orders are fetched in one second query and joined here rather than by
   * Prisma. Both reads are inside the tenant binding, so neither can reach
   * another company's rows.
   *
   * Scoped with `followupScope`, the same function the follow-up ROUTE uses:
   * `hardening.test.js §7` exists because the ERP accepted `?agent=` here and
   * honoured it.
   */
  const followupWithOrders = async (db: Parameters<Parameters<typeof withTenant>[1]>[0]) => {
    const tasks = await db.followupTask.findMany({
      // `open | done | overdue` — the vocabulary the schema declares and the
      // follow-up dashboard already counts. Both unfinished states are shown:
      // an overdue task hidden from the agent's panel is precisely the one that
      // goes unactioned.
      where: { ...followupScope(session), status: { in: ["open", "overdue"] } },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true, orderId: true, type: true, dueAt: true, reason: true },
    });
    if (!tasks.length) return [];

    const orders = await db.fulfillmentOrder.findMany({
      where: { id: { in: tasks.map((t) => t.orderId) } },
      select: { id: true, reference: true, client: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    return tasks.map((task) => ({
      ...task,
      reference: byId.get(task.orderId)?.reference ?? "",
      client: byId.get(task.orderId)?.client ?? "",
    }));
  };

  const { orders, followup, settings, counts } = await withTenant(session.auth.tenantId, async (db) => {
    const filters = orderFilters(params);
    // A chosen status wins; otherwise the queue is everything still to be
    // worked. `scopedWhere` ANDs rather than spreads, so neither can widen the
    // caller's own scope.
    const where = scopedWhere(session, {
      ...filters,
      ...(filters.status ? {} : { status: { in: [...ACTIVE_STATUSES] } }),
    });

    return {
      orders: await db.fulfillmentOrder.findMany({
        where,
        // The longest-waiting customer first. This IS the work order.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: PAGE_SIZE,
        select: { ...ORDER_LIST_SELECT, calls: { select: { note: true }, orderBy: { time: "desc" }, take: 1 } },
      }),
      followup: await followupWithOrders(db),
      settings: await readSettings(db),
      counts: {
        active: await db.fulfillmentOrder.count({
          where: scopedWhere(session, { status: { in: [...ACTIVE_STATUSES] } }),
        }),
        confirmed: await db.fulfillmentOrder.count({
          where: scopedWhere(session, { status: "confirmed" }),
        }),
      },
    };
  });

  const currency = session.tenant!.currency;

  // The SAME threshold the overdue sweep uses, read from the tenant's own
  // settings rather than the ERP's hardcoded 60. A manager who shortens it on
  // the automation screen shortens it here too.
  const alertMinutes = Number(settings.alertMinutes) || 60;
  const overdueBefore = Date.now() - alertMinutes * 60_000;

  const results = CALL_RESULTS.map((value) => {
    const d = resolveStatus("confirmation", value);
    return { value, label: t(d.labelKey), vars: toneVars(d.tone) };
  });
  const noteTypes = NOTE_TYPES.map((value) => ({
    value,
    label: t(`erp.noteType.${value.replace(/_(.)/g, (_, c: string) => c.toUpperCase())}`),
  }));

  const strings: QueueStrings = {
    saving: t("common.saving"),
    call: t("erp.queue.call"),
    calling: t("erp.write.callRunning"),
    logResult: t("erp.write.logResult"),
    note: t("erp.write.notePanel"),
    noteKind: t("erp.write.noteKind"),
    addNote: t("erp.write.addNote"),
    cancel: t("common.cancel"),
    attempts: t("erp.order.attempts"),
    neverCalled: t("erp.queue.neverCalled"),
    overdue: t("erp.queue.overdue"),
    open: t("erp.queue.open"),
  };

  const cards: QueueOrder[] = orders.map((o) => ({
    id: o.id,
    reference: o.reference ?? "",
    client: o.client ?? "",
    phone: o.phone ?? "",
    destination: [o.wilaya, o.commune].filter(Boolean).join(" · "),
    product: o.product ?? "",
    price: formatMoney(o.price?.toString() ?? "0", locale, currency),
    placed: formatDate(o.createdAt, locale),
    status: o.status ?? "unknown",
    statusLabel: t(resolveStatus("confirmation", o.status ?? "").labelKey),
    statusVars: toneVars(resolveStatus("confirmation", o.status ?? "").tone),
    callCount: o._count.calls,
    // Never called AND waiting longer than the alert threshold — the ERP's
    // definition, with its constant replaced by the setting.
    overdue: o._count.calls === 0 && o.createdAt.getTime() < overdueBefore,
    callingSince: o.pendingCallStart
      ? formatDate(o.pendingCallStart, locale, { timeStyle: "short" })
      : null,
    lastNote: o.calls[0]?.note ?? null,
    // Only when a parcel exists. The full event timeline is on the order
    // detail; this is the one line a customer rings back to ask about.
    delivery: o.deliveryStatus || o.trackingNumber
      ? {
          label: t(resolveStatus("delivery", o.deliveryStatus ?? "").labelKey),
          tracking: o.trackingNumber ?? null,
        }
      : null,
    workable: !(TERMINAL_STATUSES as readonly string[]).includes(o.status ?? ""),
  }));

  const errors = actionErrors(t);
  const overdueCount = cards.filter((c) => c.overdue).length;

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.queue.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {seesWholeBook(session) ? t("erp.overview.wholeBook") : t("erp.overview.myQueue")}
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-3" data-testid="erp-queue-stats">
        <div className="rounded-lg border border-border p-3" data-tile="active">
          <dt className="text-xs text-muted-foreground">{t("erp.queue.toCall")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{counts.active}</dd>
        </div>
        <div className="rounded-lg border border-border p-3" data-tile="confirmed">
          <dt className="text-xs text-muted-foreground">{t("erp.overview.confirmed")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{counts.confirmed}</dd>
        </div>
        <div className="rounded-lg border border-border p-3" data-tile="overdue">
          <dt className="text-xs text-muted-foreground">{t("erp.queue.overdue")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{overdueCount}</dd>
        </div>
      </dl>

      {/* A plain GET form. The filters round-trip through the URL and are read
          by the SAME `orderFilters` the API uses, so the screen and the endpoint
          cannot interpret `?status=` differently — and it works before
          hydration, which the rest of this screen cannot claim. */}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3" data-testid="erp-queue-filters">
        <div>
          <label htmlFor="status" className="ui-label block">
            {t("erp.orders.status")}
          </label>
          <select
            id="status" name="status" defaultValue={params.get("status") ?? ""}
            className="ui-control tap mt-1"
          >
            <option value="">{t("erp.queue.allActive")}</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(resolveStatus("confirmation", value).labelKey)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search" className="ui-label block">
            {t("common.search")}
          </label>
          <input
            id="search" name="search" defaultValue={params.get("search") ?? ""}
            className="ui-control tap mt-1"
          />
        </div>
        <button
          type="submit"
          className="ui-btn ui-btn-default tap"
        >
          {t("erp.write.apply")}
        </button>
      </form>

      {/* What the carriers threw back at us. A task is raised when a shipment
          reaches a state needing a person — customer out, bad address, a
          reschedule — and it is closed by the agent who rings them. */}
      {followup.length > 0 && (
        <section className="mt-6 rounded-lg border border-border p-4" data-testid="erp-queue-followup">
          <h2 className="text-sm font-medium">{t("erp.nav.followUp")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("erp.queue.followUpHint")}</p>
          <ul className="mt-3 space-y-2">
            {followup.map((task) => (
              <li
                key={String(task.id)}
                data-followup-id={String(task.id)}
                className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm first:border-0 first:pt-0"
              >
                <a
                  href={`/console/erp/orders/${task.orderId}`}
                  className="font-mono text-xs underline underline-offset-2"
                  dir="ltr"
                >
                  {task.reference}
                </a>
                <span>{task.client || "—"}</span>
                <span className="text-muted-foreground">{task.type ?? ""}</span>
                {task.dueAt && (
                  <span className="text-xs text-muted-foreground">
                    {formatDate(task.dueAt, locale)}
                  </span>
                )}
                <span className="ms-auto">
                  <FollowupResolve
                    taskId={String(task.id)}
                    errors={errors}
                    label={t("erp.queue.followUpResolve")}
                    saving={t("common.saving")}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cards.length === 0 ? (
        <p
          data-testid="erp-queue"
          data-empty="true"
          className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        >
          {t("erp.queue.clear")}
        </p>
      ) : (
        <ul className="mt-6 space-y-4" data-testid="erp-queue">
          {cards.map((card) => (
            <QueueCard
              // Keyed on what the server holds, so a logged call remounts the
              // card on the stored answer rather than on what was tapped.
              key={`${card.id}/${card.status}/${card.callCount}/${card.callingSince ?? ""}`}
              order={card}
              results={results}
              noteTypes={noteTypes}
              errors={errors}
              s={strings}
              detailHref={`/console/erp/orders/${card.id}`}
            />
          ))}
        </ul>
      )}
    </ConsoleShell>
  );
}
