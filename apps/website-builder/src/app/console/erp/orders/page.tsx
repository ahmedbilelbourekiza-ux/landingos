import Link from "next/link";

import { withTenant } from "@landingos/db";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable, StatusPill } from "@/components/console/data-table";
import { scopedWhere } from "@/lib/erp/scope";
import { orderFilters, orderSort, ORDER_LIST_SELECT } from "@/lib/erp/orders";

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

  const orders = await withTenant(session.auth!.tenantId, (db) =>
    db.fulfillmentOrder.findMany({
      where: scopedWhere(session, orderFilters(params)),
      orderBy: orderSort(params.get("sort"), params.get("dir")),
      take: PAGE_SIZE,
      select: ORDER_LIST_SELECT,
    }),
  );

  const currency = session.tenant!.currency;

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.orders.title")}</h1>

      <DataTable
        testId="erp-orders-table"
        empty={t("erp.orders.noneYet")}
        rows={orders}
        rowKey={(o) => o.id}
        rowAttrs={(o) => ({ "data-order-id": o.id })}
        columns={[
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
    </ConsoleShell>
  );
}
