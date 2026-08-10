import Link from "next/link";
import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { PageBody } from "@/components/console/ui/primitives";
import { DataTable, StatusPill } from "@/components/console/data-table";
import { ClientEditPanel } from "@/components/console/erp/client-write";
import { clientEditStrings } from "@/lib/console/erp-strings";
import { CLIENT_SELECT, withDerived, clientOrderHistory } from "@/lib/erp/clients";
import { seesWholeBook } from "@/lib/erp/scope";

export const dynamic = "force-dynamic";

/* =============================================================================
 * One customer — LP.10, restoring R5.
 *
 * The registry has been readable as a LIST since Phase 5 and openable as a
 * RECORD never. Every repeat-purchase call starts with "what has this person
 * bought, and did it arrive?", and the only way to answer it was to search the
 * order list by phone number and read the rows.
 *
 * THREE THINGS ARE SEPARATED ON PURPOSE, and separating them is most of the
 * screen's value:
 *
 *   1. THE COUNTERS ARE LIFETIME EVENT COUNTS. "Delivered" is how many of this
 *      customer's orders have EVER been delivered, not how many currently are,
 *      and confirming then cancelling increments both. They are shown as a row
 *      of totals rather than as editable fields, because they are the sum of
 *      things that happened and there is no such thing as correcting one.
 *   2. THE IMPORTED FIGURES ARE THEIR OWN BLOCK. A number carried in from a
 *      spreadsheet is a record of what the spreadsheet said. Mixing it into the
 *      observed counters would make the registry's central claim — that every
 *      counter is the sum of real events — quietly false.
 *   3. THE FOUR CORRECTABLE FIELDS ARE A FORM. Name, wilaya, commune, address:
 *      the ones with no reliable automatic source.
 *
 * `erp:clients:read` is SENSITIVE (D-05.1) and this page checks it explicitly
 * rather than relying on the nav to have hidden the link — a nav item is a hint,
 * the URL is typeable.
 * ========================================================================== */

export default async function ErpClientDetailScreen({
  params: routeParams,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await routeParams;
  const { session, locale: raw, t } = await requireProduct("erp", `/console/erp/clients/${id}`);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // The same answer the API gives, from the same function.
  if (!seesWholeBook(session)) notFound();

  const data = await withTenant(session.auth!.tenantId, async (db) => {
    const client = await db.client.findUnique({ where: { id }, select: CLIENT_SELECT });
    if (!client) return null;
    return { client, history: await clientOrderHistory(db, client.phone) };
  });

  // 404 rather than 403 for another tenant's customer — confirming a row exists
  // elsewhere is itself information. RLS produces the same answer without this
  // page filtering anything.
  if (!data) notFound();

  const client = withDerived(data.client);
  const currency = session.tenant!.currency;

  /* D-06.2. `erp:clients:write` is what `PATCH /api/erp/clients/[id]` checks, so
     it is what decides whether the form exists. It is SENSITIVE, like the read:
     correcting an address changes where a courier drives, and a role that could
     write the registry without reading it would be an incoherent grant. */
  const mayWrite = can(session.auth!, "erp:clients:write");

  const tile = (id: string, label: string, value: string) => (
    <div key={id} data-tile={id} className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );

  return (
    <>
      <PageBody>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold" data-flash-id={client.id}>
          {client.name || client.phoneDisplay || client.phone}
        </h1>
        <a
          // The same tap-to-dial control the queue screen uses: this screen
          // exists to be read immediately before somebody rings the number.
          href={`tel:${client.phoneDisplay || client.phone}`}
          data-testid="client-dial"
          dir="ltr"
          className="ui-btn ui-btn-default tap font-mono"
        >
          {client.phoneDisplay || client.phone}
        </a>
        <Link
          href="/console/erp/clients"
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          {t("erp.clients.title")}
        </Link>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {[client.wilaya, client.commune, client.address].filter(Boolean).join(" · ") || "—"}
      </p>

      {/* Lifetime EVENT counts, and the label says so. Rendering them as live
          figures invites somebody to "fix" the arithmetic that produces them. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="client-stats">
        {tile("orders", t("erp.clients.orders"), String(client.totalOrders))}
        {tile("confirmed", t("erp.overview.confirmed"), String(client.confirmedOrders))}
        {tile("cancelled", t("erp.clients.cancelled"), String(client.cancelledOrders))}
        {tile("delivered", t("erp.clients.delivered"), String(client.deliveredOrders))}
        {tile("spent", t("erp.clients.spent"), formatMoney(client.totalSpent.toString(), locale, currency))}
        {tile("average", t("erp.clients.average"), formatMoney(client.avgOrderValue.toString(), locale, currency))}
      </div>

      {/* Kept visibly separate from the counters this system observed. An
          import must never be mistaken for history we watched happen. */}
      {client.importedSource && (
        <section
          data-testid="client-imported-block"
          className="mt-6 rounded-lg border border-dashed border-border p-4"
        >
          <h2 className="text-sm font-semibold tracking-tight">{t("erp.clients.imported")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {client.importedSource}
            {client.importedAt ? ` · ${formatDate(client.importedAt, locale)}` : ""}
          </p>
          <p className="mt-2 text-sm">
            {t("erp.clients.orders")}: {client.importedTotalOrders} ·{" "}
            {t("erp.clients.delivered")}: {client.importedDeliveredOrders} ·{" "}
            {t("erp.clients.spent")}:{" "}
            {formatMoney(client.importedTotalSpent.toString(), locale, currency)}
          </p>
        </section>
      )}

      {mayWrite && (
        <ClientEditPanel
          clientId={client.id}
          errors={actionErrors(t)}
          s={clientEditStrings(t)}
          initial={{
            name: client.name ?? "",
            wilaya: client.wilaya ?? "",
            commune: client.commune ?? "",
            address: client.address ?? "",
          }}
        />
      )}

      <h2 className="mt-8 text-sm font-semibold tracking-tight">{t("erp.clients.history")}</h2>
      <DataTable
        testId="client-history"
        empty={t("erp.orders.noneYet")}
        rows={data.history}
        rowKey={(o) => o.id}
        rowAttrs={(o) => ({ "data-history-order": o.id })}
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
                {o.reference ?? "—"}
              </Link>
            ),
          },
          {
            id: "placed",
            header: t("erp.orders.placed"),
            cell: (o) => (
              <span className="text-muted-foreground">{formatDate(o.createdAt, locale)}</span>
            ),
          },
          {
            id: "channel",
            header: t("erp.row.channel"),
            cell: (o) => (
              <span className="text-muted-foreground">
                {[o.salesChannelName, o.brand, o.platform].filter(Boolean).join(" · ") || "—"}
              </span>
            ),
          },
          {
            id: "product",
            header: t("erp.orders.product"),
            cell: (o) => (
              <>
                <span>{o.product || "—"}</span>
                {o.productVariant && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {o.productVariant}
                  </span>
                )}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t("erp.orders.quantity")}: {o.quantity ?? 1}
                </span>
              </>
            ),
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
            id: "delivery",
            header: t("erp.orders.delivery"),
            /* The OUTCOME, which is the question this screen is opened to
               answer: a customer with four confirmed orders and four returns is
               not a customer to call again. The full parcel timeline is one
               click away on the order — the legacy attached it here and paid
               two extra queries PER ORDER for it. */
            cell: (o) => (
              <span className="text-muted-foreground">
                {o.deliveryOutcome || o.deliveryStatus || "—"}
                {o.trackingNumber && (
                  <span className="mt-0.5 block font-mono text-xs" dir="ltr">
                    {o.trackingNumber}
                  </span>
                )}
              </span>
            ),
          },
        ]}
      />
      </PageBody>
    </>
  );
}
