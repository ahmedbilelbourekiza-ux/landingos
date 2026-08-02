import { forTenant } from "@landingos/db";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";

export const dynamic = "force-dynamic";

/**
 * Abandoned checkouts — visitors who started the order form and never
 * submitted, captured as they typed so a phone number survives them leaving.
 *
 * Drafts that later converted are excluded. Those were leads that took a while
 * rather than abandonment, and mixing them in makes the list unactionable.
 */
export default async function BuilderAbandonedScreen() {
  const { session, locale: raw, t } = await requireProduct(
    "website-builder",
    "/builder/abandoned",
  );
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const drafts = await forTenant(session.auth!.tenantId).draftOrder.findMany({
    where: { convertedOrderId: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      customerName: true,
      phone: true,
      wilaya: true,
      totalPrice: true,
      updatedAt: true,
      landingPage: { select: { title: true } },
    },
  });

  return (
    <ConsoleShell session={session} productId="website-builder">
      <h1 className="text-xl font-semibold">{t("builder.nav.abandoned")}</h1>
      <DataTable
        testId="abandoned-table"
        empty={t("common.empty")}
        rows={drafts}
        rowKey={(d) => d.id}
        rowAttrs={(d) => ({ "data-draft-id": d.id })}
        columns={[
          {
            id: "customer",
            header: t("erp.nav.clients"),
            cell: (d) => (
              <>
                <span className="font-medium">{d.customerName ?? "—"}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {d.phone ?? "—"}
                </span>
              </>
            ),
          },
          {
            id: "product",
            header: t("builder.nav.pages"),
            cell: (d) => (
              <span className="text-muted-foreground">{d.landingPage?.title ?? "—"}</span>
            ),
          },
          {
            id: "total",
            header: t("builder.nav.orders"),
            align: "end",
            numeric: true,
            cell: (d) =>
              d.totalPrice == null ? "—" : formatMoney(String(d.totalPrice), locale),
          },
          {
            id: "seen",
            header: "Status",
            cell: (d) => (
              <span className="text-xs text-muted-foreground">
                {formatDate(d.updatedAt, locale)}
              </span>
            ),
          },
        ]}
      />
    </ConsoleShell>
  );
}
