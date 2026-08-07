import Link from "next/link";

import { withTenant } from "@landingos/db";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { FilterBar } from "@/components/console/filter-bar";
import { Pager } from "@/components/console/pager";
import {
  filterStrings, pagerStrings, clientExportStrings, importStrings,
  densityStrings, emptyCopy,
} from "@/lib/console/erp-strings";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { ListFrame } from "@/components/console/ui/list-frame";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";
import { ClientExportPanel } from "@/components/console/erp/client-export";
import { CsvImportPanel } from "@/components/console/erp/csv-import";
import {
  CLIENT_SELECT, clientFilters, clientHistoryPhones, clientFilterFields, withDerived,
} from "@/lib/erp/clients";
import { seesWholeBook } from "@/lib/erp/scope";
import { can } from "@landingos/auth";
import { actionErrors } from "@/lib/console/action-errors";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The customer registry.
 *
 * The most sensitive screen in the product: every customer's name, phone
 * number, address and lifetime spend, in one scrollable list. D-05.1 made
 * `erp:clients:read` a permission no role grants implicitly, and this page
 * checks it explicitly rather than relying on the nav to have hidden the link —
 * a nav item is a hint, not a boundary, and the URL is typeable.
 *
 * The counters are LIFETIME EVENT counts and the column headings say so:
 * "delivered" is how many of this customer's orders have ever been delivered,
 * not how many currently are. Rendering them as live figures would invite
 * somebody to "fix" the arithmetic that produces them.
 * ========================================================================== */

const PAGE_SIZE = 50;

export default async function ErpClientsScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/clients");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // The same answer the API gives, from the same function. A screen that
  // rendered because the nav happened to show it would be a second, weaker
  // copy of the rule.
  if (!seesWholeBook(session)) notFound();

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") params.set(k, v);
  }
  const page = Math.max(1, Number(params.get("page")) || 1);
  const { clients, total, wilayas, channels, niches } = await withTenant(
    session.auth!.tenantId,
    async (db) => {
      // The order-history filters first: `product` and `salesChannelName` are
      // properties of a customer's ORDERS and `Client` has no relation to reach
      // them through. Same functions the API uses, so the screen, the API and
      // the export cannot disagree about what a filter meant (D-LP.6.2).
      const phones = await clientHistoryPhones(db, params);
      const where = {
        ...clientFilters(params),
        ...(phones === null ? {} : { phone: { in: phones } }),
      };
      const total = await db.client.count({ where });
      const safePage = Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
      return {
        total,
        clients: await db.client.findMany({
          where,
          orderBy: [{ lastOrderAt: "desc" }, { id: "desc" }],
          skip: (safePage - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: CLIENT_SELECT,
        }),
        // Real values, never a hardcoded list: a dropdown offering all 58
        // provinces when a company ships to six is a worse filter than one
        // offering the six. The legacy derived both the same way.
        wilayas: await db.client.groupBy({
          by: ["wilaya"],
          orderBy: { wilaya: "asc" },
          _count: { _all: true },
        }),
        channels: await db.fulfillmentOrder.groupBy({
          by: ["salesChannelName"],
          orderBy: { salesChannelName: "asc" },
          _count: { _all: true },
        }),
        // LP.18. The niches this catalogue actually uses — never a hardcoded
        // list, for the reason the wilayas are derived the same way.
        niches: await db.catalogProduct.groupBy({
          by: ["niche"],
          orderBy: { niche: "asc" },
          _count: { _all: true },
        }),
      };
    },
  );

  const currency = session.tenant!.currency;

  return (
    <ConsoleShell session={session} productId="erp">
      <PageBody>
      <PageHeader title={t("erp.clients.title")} />

      <ListFrame
        density={densityStrings(t)}
        toolbar={<>
      {/* LP.10 widened this from one control to eight, built from
          `clientFilterFields` — which lives beside `clientFilters` for the
          reason `orderFilterFields` lives beside `orderFilters` (D-LP.3). A bar
          with its own list of fields is a second vocabulary that goes stale the
          moment a filter is added to the API, and it shows up not as an error
          but as a capability nobody can find. */}
      <FilterBar
        basePath="/console/erp/clients"
        params={params}
        fields={clientFilterFields({
          t,
          wilayas: wilayas
            .map((w) => String(w.wilaya ?? ""))
            .filter(Boolean)
            .map((value) => ({ value, label: value })),
          channels: channels
            .map((c) => String(c.salesChannelName ?? ""))
            .filter(Boolean)
            .map((value) => ({ value, label: value })),
          niches: niches
            .map((n) => String(n.niche ?? ""))
            .filter(Boolean)
            .map((value) => ({ value, label: value })),
        })}
        s={filterStrings(t)}
        testId="erp-clients-filters"
      />

        </>}
        pager={
          <Pager
            basePath="/console/erp/clients"
            params={params}
            info={{ page, pageSize: PAGE_SIZE, total }}
            s={pagerStrings(t)}
            testId="erp-clients-pager"
          />
        }
      >
      {/* The file IS the list, carrying the same query string (D-LP.6.2), which
          is why it lives here rather than on a screen of its own. */}
      <ClientExportPanel params={params} s={clientExportStrings(t)} total={total} />

      {/* LP.19 — the other half of the round trip. Gated on
          `erp:clients:write`, which is what the route checks (D-06.2): loading
          a spreadsheet into the registry is at least as consequential as
          correcting one record. */}
      {can(session.auth!, "erp:clients:write") && (
        <CsvImportPanel
          endpoint="/api/erp/clients/import"
          errors={actionErrors(t)}
          s={importStrings(t, "clients")}
          testId="erp-client-import"
        />
      )}

      <DataTable
        testId="erp-clients-table"
        empty={t("erp.clients.none")}
        emptyCopy={emptyCopy(t, [...params.keys()].some((k) => k !== "page"), t("erp.clients.none"))}
        caption={t("erp.clients.title")}
        rows={clients.map(withDerived)}
        rowKey={(c) => c.id}
        rowAttrs={(c) => ({ "data-client-id": c.id, "data-flash-id": c.id })}
        columns={[
          {
            id: "customer",
            header: t("erp.clients.title"),
            cell: (c) => (
              <>
                {/* LP.10 — the row opens the record. Before this slice the
                    registry could be READ and nothing else: "what has this
                    person bought, and did it arrive" meant searching the order
                    list by phone number and reading the rows. */}
                <Link
                  href={`/console/erp/clients/${c.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {c.name || c.phoneDisplay || c.phone}
                </Link>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {c.phoneDisplay || c.phone}
                </span>
              </>
            ),
          },
          {
            id: "where",
            header: t("erp.orders.destination"),
            cell: (c) => (
              <span className="text-muted-foreground">
                {[c.wilaya, c.commune].filter(Boolean).join(" · ") || "—"}
              </span>
            ),
          },
          {
            id: "orders",
            header: t("erp.clients.orders"),
            numeric: true,
            align: "end",
            cell: (c) => c.totalOrders,
          },
          {
            id: "delivered",
            header: t("erp.clients.delivered"),
            numeric: true,
            align: "end",
            cell: (c) => c.deliveredOrders,
          },
          {
            id: "spent",
            header: t("erp.clients.spent"),
            numeric: true,
            align: "end",
            cell: (c) => formatMoney(c.totalSpent.toString(), locale, currency),
          },
          {
            id: "average",
            header: t("erp.clients.average"),
            numeric: true,
            align: "end",
            // Derived on read, never stored — a third number that can disagree
            // with the two it comes from. The divisor is DELIVERED orders:
            // "what do they spend when they actually take the parcel".
            cell: (c) => formatMoney(c.avgOrderValue.toString(), locale, currency),
          },
          {
            id: "last",
            header: t("erp.clients.lastOrder"),
            cell: (c) => (
              <span className="text-muted-foreground">
                {c.lastOrderAt ? formatDate(c.lastOrderAt, locale) : "—"}
              </span>
            ),
          },
          {
            id: "imported",
            header: t("erp.clients.imported"),
            cell: (c) =>
              c.importedSource ? (
                // Kept visibly separate from the counters this system observed.
                // An import must never be mistaken for history we watched happen.
                <span
                  data-testid="client-imported"
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {c.importedSource}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        ]}
      />
      </ListFrame>
      </PageBody>
    </ConsoleShell>
  );
}
