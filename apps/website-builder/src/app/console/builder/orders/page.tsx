import Link from "next/link";

import { forTenant } from "@landingos/db";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable, StatusPill } from "@/components/console/data-table";

export const dynamic = "force-dynamic";

export default async function BuilderOrdersScreen() {
  const { session, locale: raw, t } = await requireProduct("website-builder", "/console/builder/orders");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const orders = await forTenant(session.auth!.tenantId).salesOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      customerName: true,
      phone: true,
      wilaya: true,
      baladia: true,
      quantity: true,
      totalPrice: true,
      status: true,
      createdAt: true,
      landingPage: { select: { title: true } },
    },
  });

  return (
    <ConsoleShell session={session} productId="website-builder">
      <PageBody>
      <PageHeader title={t("builder.nav.orders")} />
      <DataTable
        testId="orders-table"
        empty={t("common.empty")}
        rows={orders}
        rowKey={(o) => o.id}
        rowAttrs={(o) => ({ "data-order-id": o.id })}
        columns={[
          /* Each header names what the CELL holds. The first build reused
             whatever nav key was lying around, which headed the quantity
             column "Create" and the total column "Orders" — nonsense in every
             locale, and the kind of thing that makes a product read as
             unfinished. */
          {
            id: "customer",
            header: t("builder.orders.colCustomer"),
            cell: (o) => (
              <>
                {/* The row's door. The detail screen has existed since the
                    port and the list never linked to it — it was reachable
                    only from a notification or by typing the URL. */}
                <Link
                  href={`/console/builder/orders/${o.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {o.customerName}
                </Link>
                {/* A phone number is always read left-to-right, even on an
                    RTL page, or the digits appear reordered. */}
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {o.phone}
                </span>
              </>
            ),
          },
          {
            id: "destination",
            header: t("builder.orders.colDestination"),
            cell: (o) => (
              <span className="text-muted-foreground">
                {o.wilaya} · {o.baladia}
              </span>
            ),
          },
          {
            id: "product",
            header: t("builder.orders.colPage"),
            cell: (o) => (
              <span className="text-muted-foreground">{o.landingPage?.title ?? "—"}</span>
            ),
          },
          {
            id: "qty",
            header: t("builder.orders.colQty"),
            numeric: true,
            cell: (o) => o.quantity,
          },
          {
            id: "total",
            header: t("builder.orders.colTotal"),
            align: "end",
            numeric: true,
            // Formatted from the Decimal's string form so it never passes
            // through a JS float (M-06).
            cell: (o) => formatMoney(String(o.totalPrice), locale),
          },
          {
            id: "status",
            header: t("common.status"),
            cell: (o) => {
              const s = resolveStatus("salesOrder", o.status);
              return (
                <>
                  <StatusPill status={o.status} label={t(s.labelKey)} vars={toneVars(s.tone)} />
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {formatDate(o.createdAt, locale)}
                  </span>
                </>
              );
            },
          },
        ]}
      />
      </PageBody>
    </ConsoleShell>
  );
}
