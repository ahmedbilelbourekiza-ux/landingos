import Link from "next/link";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable, StatusPill } from "@/components/console/data-table";
import { FilterBar } from "@/components/console/filter-bar";
import { Pager } from "@/components/console/pager";
import type { FilterField } from "@/components/console/filter-field";
import { OrderBulkBar, type BulkStrings } from "@/components/console/erp/order-bulk";
import { OrderCreatePanel } from "@/components/console/erp/order-create";
import { OrderExportPanel } from "@/components/console/erp/order-export";
import { OrderRowActions } from "@/components/console/erp/order-row-actions";
import {
  filterStrings, pagerStrings, orderCreateStrings, orderExportStrings, rowActionStrings,
} from "@/lib/console/erp-strings";
import { scopedWhere, seesWholeBook, mayTouchOrder } from "@/lib/erp/scope";
import {
  orderFilters, orderSort, orderFilterFields, orderRowFacts,
  ORDER_LIST_SELECT, ORDER_STATUSES,
} from "@/lib/erp/orders";
import { readSettings } from "@/lib/erp/settings";
import { exportWhere } from "@/lib/erp/export";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The order book.
 *
 * The screen an agent lives in. Three things it does NOT do, each because the
 * ERP's version did and it cost something:
 *
 *   - It does not download every order and filter in the browser. That was
 *     PERF-02: 291 ms on 5,000 rows, re-run on every event and again every 30
 *     seconds. The filter, the scope and the page are all in the query.
 *   - It does not attach call history per row. Joining it is what made the old
 *     list quadratic; the count is what the list renders.
 *   - It does not trust a query parameter to widen the scope. `scopedWhere`
 *     ANDs the caller's scope with their filters rather than spreading them,
 *     so `?agentUserId=` cannot reach a colleague's queue.
 *
 * The filters are read from the URL through the SAME `orderFilters` the API
 * uses, so the screen and the endpoint cannot interpret `?status=` differently.
 * LP.3 made them REACHABLE: nine filters existed here and none had a control,
 * so the answer to "pending orders in Alger from yesterday" was to hand-write a
 * URL. The bar is built from `orderFilterFields`, which lives in the same module
 * as `orderFilters` — one vocabulary, so a filter added to the API gets a
 * control instead of going stale.
 * ========================================================================== */

const PAGE_SIZE = 50;

export default async function ErpOrdersScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/orders");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") params.set(k, v);
  }

  const managesBook = seesWholeBook(session);

  // Clamped to the real last page. Following a stale bookmark to page 40 of a
  // list that now has three must not show an empty table — an empty table reads
  // as "no matches", which is a lie about the data.
  const page = Math.max(1, Number(params.get("page")) || 1);
  const where = scopedWhere(session, orderFilters(params));

  const { orders, total, members, carriers, confirmedCount, alertMinutes, flagged, notes } =
    await withTenant(session.auth!.tenantId, async (db) => {
    const total = await db.fulfillmentOrder.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, pages);

    const orders = await db.fulfillmentOrder.findMany({
      where,
      orderBy: orderSort(params.get("sort"), params.get("dir")),
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: ORDER_LIST_SELECT,
    });

    /* LP.8 / N21 — THE TWO FACTS THAT LIVE ON `OrderCall`, FETCHED FOR THE PAGE
     * AND NOT PER ROW.
     *
     * `ORDER_LIST_SELECT` deliberately carries no call history: attaching it
     * per row is what made the ERP's list quadratic (3,006 ms on 5,000 orders,
     * audit PERF-02). That decision stands. These are TWO bounded queries over
     * the fifty ids already on this page — not a join, not per row, and not
     * affected by how many orders the tenant has.
     *
     * `distinct` on the flag query means one row per order however many
     * suspicious calls it carries; the note query takes the newest note per
     * order the same way the queue screen already does. */
    const ids = orders.map((o) => o.id);
    const [flaggedRows, noteRows] = ids.length
      ? await Promise.all([
          db.orderCall.findMany({
            where: { orderId: { in: ids }, suspicious: true },
            distinct: ["orderId"],
            select: { orderId: true },
          }),
          db.orderCall.findMany({
            where: { orderId: { in: ids }, note: { not: null } },
            distinct: ["orderId"],
            orderBy: [{ orderId: "asc" }, { time: "desc" }],
            select: { orderId: true, note: true },
          }),
        ])
      : [[], []];

    return {
    total,
    orders,
    alertMinutes: Number((await readSettings(db)).alertMinutes) || 60,
    flagged: new Set(flaggedRows.map((r) => r.orderId)),
    notes: new Map(noteRows.map((r) => [r.orderId, r.note as string])),
    // Same rule as the order detail: only for a caller who already sees the
    // whole book, because assigning in bulk is refused for anybody else.
    members: managesBook
      ? await db.membership.findMany({
          orderBy: { createdAt: "asc" },
          select: { userId: true, user: { select: { name: true, email: true } } },
        })
      : [],
    // The tenant's own carriers, so the new-order panel offers codes that
    // resolve. `createShipment` looks the code up and silently falls back to
    // the default when it matches nothing, which is how a typed code books the
    // wrong carrier and says so nowhere.
    carriers: await db.carrier.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { code: true, name: true },
    }),
    // What a CARRIER export would actually contain, which is not `total`: the
    // three carrier formats force `status: confirmed` (D-LP.6.3), so showing
    // the filtered total beside them would promise rows the file will not have.
    // Counted through `exportWhere`, so this number and the file cannot
    // disagree about what the link does.
    confirmedCount: await db.fulfillmentOrder.count({
      where: exportWhere(session, params, "zr"),
    }),
    };
  });

  const currency = session.tenant!.currency;

  // Phase 6.3b. `erp:orders:write` is what `POST /orders/bulk` checks, so it is
  // what decides whether the bar exists at all — a MEMBER reads the book by
  // role glob and cannot change a row in it.
  const mayWrite = can(session.auth!, "erp:orders:write");

  const statusChoices = ORDER_STATUSES.map((value) => ({
    value,
    label: t(resolveStatus("confirmation", value).labelKey),
  }));

  const bulkStrings: BulkStrings = {
    saving: t("common.saving"),
    selected: t("erp.write.selected"),
    changeStatus: t("erp.write.changeStatus"),
    apply: t("erp.write.apply"),
    assignTo: t("erp.write.assignTo"),
    assign: t("erp.write.assign"),
    deleteSelected: t("erp.write.deleteSelected"),
    exportSelected: t("erp.write.exportSelected"),
    outcome: t("erp.write.outcome"),
    of: t("erp.write.of"),
  };

  const rowStrings = rowActionStrings(t);
  const memberOptions = members.map((m) => ({
    value: m.userId,
    label: m.user.name || m.user.email,
  }));
  const carrierOptions = carriers.map((c) => ({
    value: c.code ?? "",
    label: c.name ?? c.code ?? "",
  }));

  /** A small badge. Every row fact renders through one, so they cannot drift
   *  apart visually, and each carries a `data-badge` a test can name. */
  const badge = (kind: string, label: string, tone?: "danger" | "warning" | "info") => (
    <span
      key={kind}
      data-badge={kind}
      className="me-1 inline-block rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
      style={tone ? toneVars(tone) : undefined}
    >
      {label}
    </span>
  );

  const money = (v: { toString(): string } | null | undefined) =>
    formatMoney((v ?? 0).toString(), locale, currency);

  const table = (
    <DataTable
        testId="erp-orders-table"
        empty={t("erp.orders.noneYet")}
        rows={orders}
        rowKey={(o) => o.id}
        // `data-flash-id` is what `row-flash.ts` looks for (N22). It carries the
        // same value as `data-order-id` deliberately: the flash primitive is
        // generic across entities, and giving it its own attribute means the
        // clients list and the shipments list can use it without teaching it
        // what an order is.
        rowAttrs={(o) => ({ "data-order-id": o.id, "data-flash-id": o.id })}
        columns={[
          // The selection lives in the DOM as a plain checkbox, which is what
          // HTML already has for choosing several rows. It keeps this table a
          // SERVER component — the filter, the scope and the page all stay in
          // the query (PERF-02) — and there is no second copy of what is ticked
          // to drift from what is on screen.
          ...(mayWrite
            ? [
                {
                  id: "select",
                  header: "",
                  cell: (o: (typeof orders)[number]) => (
                    <input
                      type="checkbox"
                      name="orderId"
                      value={o.id}
                      aria-label={o.reference ?? o.id}
                      className="h-4 w-4 rounded border-input"
                    />
                  ),
                },
              ]
            : []),
          {
            id: "reference",
            header: t("erp.orders.reference"),
            /* LP.8 / N10, N21 — THE ROW SAYS WHAT KIND OF ORDER THIS IS.
             *
             * The measured density gap was 8 facts against 14, and this column
             * carries four of the six that were missing: the type (a draft and
             * an abandoned cart are not orders somebody agreed to), the fake
             * flag, the overdue tag and the note. Each is a decision an
             * operator makes from the LIST — the point of the legacy row is
             * that you do not open an order to find out whether to call it. */
            cell: (o) => {
              const facts = orderRowFacts(o, alertMinutes);
              const note = notes.get(o.id);
              return (
                <div className="min-w-[9rem]">
                  <Link
                    href={`/console/erp/orders/${o.id}`}
                    className="font-mono text-xs underline-offset-2 hover:underline"
                    dir="ltr"
                  >
                    {/* The number a customer reads back over the phone
                        (D-05.3). Falls back to nothing rather than showing a
                        cuid, which would be worse than an empty cell. */}
                    {o.reference ?? "—"}
                  </Link>
                  <div className="mt-1">
                    {badge(
                      facts.draft ? "draft" : facts.abandoned ? "abandoned" : "normal",
                      facts.draft
                        ? t("erp.row.typeDraft")
                        : facts.abandoned
                          ? t("erp.row.typeAbandoned")
                          : t("erp.row.typeNormal"),
                      facts.draft || facts.abandoned ? "warning" : undefined,
                    )}
                    {facts.fake && badge("fake", t("erp.filters.fake"), "danger")}
                    {facts.overdue && badge("overdue", t("erp.row.overdue"), "danger")}
                    {flagged.has(o.id) && badge("suspicious", t("erp.row.suspicious"), "danger")}
                    {/* The note itself is the tooltip, exactly as the legacy
                        row does it — the badge says one exists, hovering says
                        what it is, and neither costs a click. */}
                    {note && (
                      <span
                        data-badge="note"
                        title={note}
                        className="me-1 inline-block rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
                      >
                        {t("erp.row.noted")}
                      </span>
                    )}
                  </div>
                  {(o.salesChannelName || o.platform || o.brand) && (
                    <div
                      data-testid="row-channel"
                      className="mt-1 truncate text-[11px] text-muted-foreground"
                    >
                      {[o.salesChannelName, o.brand, o.platform].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {/* Date AND time. "Today" is not a useful answer in a call
                      centre where the question is whether an order came in
                      before or after the last round of calls. */}
                  <div className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
                    {formatDate(o.createdAt, locale)}
                    {" · "}
                    {o.createdAt.toISOString().slice(11, 16)}
                  </div>
                </div>
              );
            },
          },
          {
            id: "customer",
            header: t("erp.orders.customer"),
            cell: (o) => (
              <>
                <span className="font-medium">{o.client || "—"}</span>
                {/* A phone number is always left-to-right, even on an RTL page,
                    or the digits appear reordered. */}
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {o.phone}
                </span>
              </>
            ),
          },
          {
            id: "destination",
            header: t("erp.orders.destination"),
            cell: (o) => (
              <span className="text-muted-foreground">
                {[o.wilaya, o.commune].filter(Boolean).join(" · ") || "—"}
              </span>
            ),
          },
          {
            id: "product",
            header: t("erp.orders.product"),
            cell: (o) => (
              <div className="min-w-[7rem]">
                <span>{o.product || "—"}</span>
                {o.productVariant && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {o.productVariant}
                  </span>
                )}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t("erp.orders.quantity")}: {o.quantity ?? 1}
                </span>
              </div>
            ),
          },
          {
            id: "total",
            header: t("erp.orders.total"),
            numeric: true,
            align: "end",
            /* THE BREAKDOWN, NOT ONLY THE TOTAL. A customer disputing 4,900 is
             * disputing one of three numbers, and the legacy row shows all
             * three. Rendered only where they exist: an order typed in over the
             * phone carries a flat price (N15), and printing "delivery: 0" for
             * it would state a fact nobody recorded. */
            cell: (o) => (
              <div className="min-w-[7rem]">
                <div className="font-medium">{money(o.price)}</div>
                {(o.unitPrice != null || o.shippingCost != null || o.discount != null) && (
                  <dl
                    data-testid="row-breakdown"
                    className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground"
                  >
                    {o.unitPrice != null && (
                      <div className="flex justify-between gap-2">
                        <dt>{t("erp.row.unitPrice")}</dt>
                        <dd>{money(o.subtotal ?? o.unitPrice)}</dd>
                      </div>
                    )}
                    {o.shippingCost != null && (
                      <div className="flex justify-between gap-2">
                        <dt>{t("erp.row.shipping")}</dt>
                        <dd>{money(o.shippingCost)}</dd>
                      </div>
                    )}
                    {o.discount != null && (
                      <div className="flex justify-between gap-2">
                        <dt>{t("erp.row.discount")}</dt>
                        <dd>−{money(o.discount)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            ),
          },
          {
            id: "status",
            header: t("erp.orders.status"),
            cell: (o) => {
              // The tone comes from @landingos/ui, so a pending order here
              // looks like the equivalent state anywhere else on the platform.
              const tone = resolveStatus("confirmation", o.status ?? "");
              return (
                <div className="min-w-[8rem]">
                  <StatusPill
                    status={o.status ?? "unknown"}
                    label={t(tone.labelKey)}
                    vars={toneVars(tone.tone)}
                  />
                  {o.deliveryStatus && (
                    <span
                      data-testid="row-delivery-status"
                      className="mt-1 block text-[11px] text-muted-foreground"
                    >
                      {o.deliveryStatus}
                    </span>
                  )}
                  {o.trackingNumber && (
                    <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground" dir="ltr">
                      {o.trackingNumber}
                    </span>
                  )}
                  {o.callReminderStatus === "overdue" && (
                    <span className="mt-1 block">
                      {badge("followup-overdue", t("erp.followUp.escalation"), "danger")}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            id: "calls",
            header: t("erp.orders.calls"),
            numeric: true,
            align: "end",
            cell: (o) => o._count.calls,
          },
          /* LP.8 / N9 — THE INLINE CONTROLS.
           *
           * Offered only where `erp:orders:write` holds AND `mayTouchOrder`
           * does for this row (D-06.2) — the same two checks `PATCH
           * /orders/[id]` makes, in the same order. `mayTouchOrder` is
           * effectively true for every row an agent can see (`orderScope` and
           * it admit the same set) and is asked anyway: the two functions are
           * separate rules and a screen that assumes they agree is a screen
           * that breaks silently the day one of them changes. */
          ...(mayWrite
            ? [
                {
                  id: "actions",
                  header: t("erp.row.quickActions"),
                  cell: (o: (typeof orders)[number]) => (
                    <OrderRowActions
                      orderId={o.id}
                      errors={actionErrors(t)}
                      s={rowStrings}
                      status={o.status ?? "pending"}
                      statuses={statusChoices}
                      agentUserId={o.agentUserId ?? ""}
                      members={managesBook ? memberOptions : undefined}
                      carrierCode={o.carrierCode ?? ""}
                      carriers={managesBook ? carrierOptions : undefined}
                      express={Boolean(o.expressDelivery)}
                      mayWrite={mayTouchOrder(session, o)}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
  );

  /* Built from the same module the route validates against. `agentUserId` is
     offered only to somebody who already sees the whole book — `scopedWhere`
     ANDs the scope in regardless, so the control would be a filter that cannot
     change anything for an agent, which teaches the wrong model of what they
     can see. */
  const fields: readonly FilterField[] = orderFilterFields({
    t,
    statuses: statusChoices,
    members: managesBook ? memberOptions : undefined,
  });

  const pager = (
    <Pager
      basePath="/console/erp/orders"
      params={params}
      info={{ page, pageSize: PAGE_SIZE, total }}
      s={pagerStrings(t)}
      testId="erp-orders-pager"
    />
  );

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.orders.title")}</h1>

      {/* `erp:orders:write` is what POST /api/erp/orders checks, so it is what
          decides whether the panel exists (D-06.2). An agent may take an order
          too — the route accepts one from them; only naming the assignee is a
          manager's call, which is why `members` is conditional and the panel is
          not. */}
      {mayWrite && (
        <OrderCreatePanel
          errors={actionErrors(t)}
          s={orderCreateStrings(t)}
          statuses={statusChoices}
          members={managesBook ? memberOptions : undefined}
          carriers={carrierOptions}
        />
      )}

      <FilterBar
        basePath="/console/erp/orders"
        params={params}
        fields={fields}
        s={filterStrings(t)}
        testId="erp-orders-filters"
      />

      {/* Below the bar and above the table, because the file it produces IS the
          filtered list — the legacy's separate Export screen could only ever
          export "all confirmed" and never what an operator had narrowed to. */}
      <OrderExportPanel
        params={params}
        s={orderExportStrings(t)}
        confirmedCount={confirmedCount}
        filteredTotal={total}
        maySeeAgentReport={can(session.auth!, "erp:agents:manage")}
      />

      {mayWrite ? (
        <OrderBulkBar
          errors={actionErrors(t)}
          s={bulkStrings}
          statuses={statusChoices}
          members={memberOptions}
          managesBook={managesBook}
        >
          {table}
        </OrderBulkBar>
      ) : (
        table
      )}

      {pager}
    </ConsoleShell>
  );
}
