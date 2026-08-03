import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { QueueCard, type QueueStrings, type QueueOrder } from "@/components/console/erp/queue-card";
import { scopedWhere, seesWholeBook } from "@/lib/erp/scope";
import {
  ACTIVE_STATUSES, CALL_RESULTS, NOTE_TYPES, ORDER_LIST_SELECT, orderFilters,
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

  const { orders, settings, counts } = await withTenant(session.auth.tenantId, async (db) => {
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
