import Link from "next/link";

import { forTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { PageHeader, PageBody, EmptyState } from "@/components/console/ui/primitives";
import { DataTable, StatusPill } from "@/components/console/data-table";
import { PageRowActions } from "@/components/console/builder/page-row-actions";
import { actionErrors } from "@/lib/console/action-errors";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Landing pages — the builder's core screen.
 *
 * A SERVER component reading through the tenant-bound client, not a client
 * component fetching /api. The legacy version fetched its own API over the
 * network from the browser; here the page and the query run in one request, so
 * there is a single round trip and no loading state to design. The API route
 * still exists for anything that genuinely needs it.
 *
 * Note what is absent: no `where: { tenantId }`. The binding is applied by
 * forTenant and enforced by row-level security, and a second filter here would
 * be a weaker copy of a rule that already holds.
 * ========================================================================== */

export default async function BuilderPagesScreen() {
  const { session, locale: raw, t } = await requireProduct("website-builder", "/console/builder/pages");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const mayEdit = can(session.auth!, "website-builder:pages:write");
  const errors = actionErrors(t);
  const tenantSlug = session.tenant!.slug;

  const pages = await forTenant(session.auth!.tenantId).landingPage.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      published: true,
      price: true,
      currency: true,
      updatedAt: true,
      category: { select: { name: true } },
      _count: { select: { salesOrders: true } },
    },
  });

  return (
    <>
      <PageBody>
      <PageHeader
        title={t("builder.nav.pages")}
        actions={
          mayEdit ? (
            <Link
              href="/console/builder/pages/new"
              className="ui-btn ui-btn-primary tap"
            >
              {t("common.create")}
            </Link>
          ) : undefined
        }
      />

      {pages.length === 0 ? (
        <EmptyState
          testId="landings-table"
          title={t("builder.overview.firstPageTitle")}
          description={t("builder.overview.firstPageHint")}
          action={
            mayEdit ? (
              <Link href="/console/builder/pages/new" className="ui-btn ui-btn-primary tap">
                {t("builder.overview.createPage")}
              </Link>
            ) : undefined
          }
        />
      ) : (
      <DataTable
        testId="landings-table"
        empty={t("common.empty")}
        rows={pages}
        rowKey={(p) => p.id}
        rowAttrs={(p) => ({ "data-page-id": p.id })}
        columns={[
          {
            id: "title",
            // The column says what the CELL holds. It used to reuse the nav
            // item's key, so the title column of the pages screen was headed
            // "Landing pages" — a label for the screen, not the column.
            header: t("builder.pages.colPage"),
            cell: (p) => (
              <>
                <span className="font-medium">{p.title}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  /{p.slug}
                </span>
              </>
            ),
          },
          {
            id: "category",
            header: t("builder.pages.colCategory"),
            cell: (p) => <span className="text-muted-foreground">{p.category?.name ?? "—"}</span>,
          },
          {
            id: "orders",
            header: t("builder.nav.orders"),
            numeric: true,
            cell: (p) => p._count.salesOrders,
          },
          {
            id: "price",
            // Was `builder.nav.deliveryPrices` — this is the PRODUCT's price,
            // and calling it "Delivery prices" told merchants the wrong fact.
            header: t("builder.pages.colPrice"),
            align: "end",
            numeric: true,
            // Formatted from the Decimal's string form so it never passes
            // through a JS float (M-06).
            cell: (p) => formatMoney(String(p.price), locale, p.currency),
          },
          {
            id: "status",
            header: t("common.status"),
            cell: (p) => {
              const s = resolveStatus("landingPage", p.status);
              return (
                <>
                  <StatusPill status={p.status} label={t(s.labelKey)} vars={toneVars(s.tone)} />
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {formatDate(p.updatedAt, locale)}
                  </span>
                </>
              );
            },
          },
          // The row's doors, where the API would accept the caller (D-06.2):
          // before LB.6 this list had NO way into the editor at all.
          ...(mayEdit
            ? [
                {
                  id: "actions",
                  header: "",
                  cell: (p: (typeof pages)[number]) => (
                    <PageRowActions
                      id={p.id}
                      publicPath={`/${tenantSlug}/${p.slug}`}
                      published={p.published}
                      labels={{
                        edit: t("common.edit"),
                        duplicate: t("builder.pages.duplicate"),
                        view: t("builder.pages.view"),
                      }}
                      errors={errors}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      )}
      </PageBody>
    </>
  );
}
