import Link from "next/link";

import { withTenant } from "@landingos/db";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable, StatusPill } from "@/components/console/data-table";

export const dynamic = "force-dynamic";

/**
 * Parcels in flight.
 *
 * The tracking number is the identifier that matters here — it is what a
 * customer quotes and what the carrier's own systems know — so it leads, in a
 * monospace, left-to-right cell. The CRM status is shown through the shared
 * tone tokens; the carrier's original wording lives on the order's timeline,
 * where there is room for it.
 */
export default async function ErpShipmentsScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/shipments");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const shipments = await withTenant(session.auth!.tenantId, (db) =>
    db.shipment.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true, orderId: true, trackingNumber: true, crmStatus: true, updatedAt: true,
        carrier: { select: { name: true } },
      },
    }),
  );

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">{t("erp.shipments.title")}</h1>

      <DataTable
        testId="erp-shipments-table"
        empty={t("erp.shipments.none")}
        rows={shipments}
        rowKey={(s) => s.id}
        rowAttrs={(s) => ({ "data-shipment-id": s.id })}
        columns={[
          {
            id: "tracking",
            header: t("erp.order.tracking"),
            cell: (s) => (
              <Link
                href={`/console/erp/orders/${s.orderId}`}
                className="font-mono text-xs underline-offset-2 hover:underline"
                dir="ltr"
              >
                {s.trackingNumber ?? "—"}
              </Link>
            ),
          },
          {
            id: "carrier",
            header: t("erp.order.carrier"),
            cell: (s) => <span className="text-muted-foreground">{s.carrier?.name ?? "—"}</span>,
          },
          {
            id: "status",
            header: t("erp.orders.delivery"),
            cell: (s) => {
              const tone = resolveStatus("delivery", s.crmStatus ?? "");
              return (
                <StatusPill
                  status={s.crmStatus ?? "unknown"}
                  label={t(tone.labelKey)}
                  vars={toneVars(tone.tone)}
                />
              );
            },
          },
          {
            id: "updated",
            header: t("erp.shipments.updated"),
            cell: (s) => (
              <span className="text-muted-foreground">{formatDate(s.updatedAt, locale)}</span>
            ),
          },
        ]}
      />
    </ConsoleShell>
  );
}
