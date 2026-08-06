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
import { filterStrings, pagerStrings, orderCreateStrings } from "@/lib/console/erp-strings";
import { scopedWhere, seesWholeBook } from "@/lib/erp/scope";
import {
  orderFilters, orderSort, orderFilterFields,
  ORDER_LIST_SELECT, ORDER_STATUSES,
} from "@/lib/erp/orders";

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

  const { orders, total, members, carriers } = await withTenant(session.auth!.tenantId, async (db) => {
    const total = await db.fulfillmentOrder.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, pages);
    return {
    total,
    orders: await db.fulfillmentOrder.findMany({
      where,
      orderBy: orderSort(params.get("sort"), params.get("dir")),
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: ORDER_LIST_SELECT,
    }),
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
    outcome: t("erp.write.outcome"),
    of: t("erp.write.of"),
  };

  const table = (
    <DataTable
        testId="erp-orders-table"
        empty={t("erp.orders.noneYet")}
        rows={orders}
        rowKey={(o) => o.id}
        rowAttrs={(o) => ({ "data-order-id": o.id })}
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
            cell: (o) => (
              <Link
                href={`/console/erp/orders/${o.id}`}
                className="font-mono text-xs underline-offset-2 hover:underline"
                dir="ltr"
              >
                {/* The number a customer reads back over the phone (D-05.3).
                    Falls back to nothing rather than showing a cuid, which
                    would be worse than an empty cell. */}
                {o.reference ?? "—"}
              </Link>
            ),
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
            cell: (o) => <span className="text-muted-foreground">{o.product || "—"}</span>,
          },
          {
            id: "total",
            header: t("erp.orders.total"),
            numeric: true,
            align: "end",
            cell: (o) => formatMoney(o.price?.toString() ?? "0", locale, currency),
          },
          {
            id: "status",
            header: t("erp.orders.status"),
            cell: (o) => {
              // The tone comes from @landingos/ui, so a pending order here
              // looks like the equivalent state anywhere else on the platform.
              const tone = resolveStatus("confirmation", o.status ?? "");
              return (
                <StatusPill
                  status={o.status ?? "unknown"}
                  label={t(tone.labelKey)}
                  vars={toneVars(tone.tone)}
                />
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
          {
            id: "placed",
            header: t("erp.orders.placed"),
            cell: (o) => (
              <span className="text-muted-foreground">{formatDate(o.createdAt, locale)}</span>
            ),
          },
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
    members: managesBook
      ? members.map((m) => ({ value: m.userId, label: m.user.name || m.user.email }))
      : undefined,
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
          members={
            managesBook
              ? members.map((m) => ({ value: m.userId, label: m.user.name || m.user.email }))
              : undefined
          }
          carriers={carriers.map((c) => ({ value: c.code ?? "", label: c.name ?? c.code ?? "" }))}
        />
      )}

      <FilterBar
        basePath="/console/erp/orders"
        params={params}
        fields={fields}
        s={filterStrings(t)}
        testId="erp-orders-filters"
      />

      {mayWrite ? (
        <OrderBulkBar
          errors={actionErrors(t)}
          s={bulkStrings}
          statuses={statusChoices}
          members={members.map((m) => ({
            value: m.userId,
            label: m.user.name || m.user.email,
          }))}
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
