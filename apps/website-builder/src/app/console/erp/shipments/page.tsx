import Link from "next/link";

import { withTenant } from "@landingos/db";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { Pager } from "@/components/console/pager";
import { pagerStrings, densityStrings } from "@/lib/console/erp-strings";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable, StatusPill } from "@/components/console/data-table";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { ListFrame } from "@/components/console/ui/list-frame";

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
const PAGE_SIZE = 50;

export default async function ErpShipmentsScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/shipments");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") params.set(k, v);
  }
  const page = Math.max(1, Number(params.get("page")) || 1);

  const { shipments, total } = await withTenant(session.auth!.tenantId, async (db) => {
    const total = await db.shipment.count();
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    return {
    total,
    shipments: await db.shipment.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, orderId: true, trackingNumber: true, crmStatus: true, updatedAt: true,
        carrier: { select: { name: true } },
      },
    }),
    };
  });

  return (
    <ConsoleShell session={session} productId="erp">
      <PageBody>
      <PageHeader title={t("erp.shipments.title")} />

      <ListFrame
        density={densityStrings(t)}
        pager={
          <Pager
            basePath="/console/erp/shipments"
            params={params}
            info={{ page, pageSize: PAGE_SIZE, total }}
            s={pagerStrings(t)}
            testId="erp-shipments-pager"
          />
        }
      >
      <DataTable
        testId="erp-shipments-table"
        empty={t("erp.shipments.none")}
        caption={t("erp.shipments.title")}
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
      </ListFrame>
      </PageBody>
    </ConsoleShell>
  );
}
