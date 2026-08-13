import Link from "next/link";

import { forTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { PageHeader, PageBody, EmptyState } from "@/components/console/ui/primitives";
import { DataTable, StatusPill } from "@/components/console/data-table";
import { PageRowActions } from "@/components/console/builder/page-row-actions";
import { PublishToErpPanel } from "@/components/console/builder/publish-to-erp";
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

export default async function BuilderPagesScreen({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { session, locale: raw, t } = await requireProduct("website-builder", "/console/builder/pages");
  const showArchived = (await searchParams).archived === "1";
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const mayEdit = can(session.auth!, "website-builder:pages:write");
  /* LB.21 — the control only exists for a tenant that HAS the Manager and may
     write its catalogue. A builder-only company has nothing to publish into,
     and offering the button would be a control that always refuses. */
  const hasErpProduct =
    session.products.some((p) => p.id === "erp") &&
    can(session.auth!, "erp:products:write");
  const errors = actionErrors(t);
  const tenantSlug = session.tenant!.slug;

  /* LB.33 — archived pages are OUT of the working list by default and reachable
     through `?archived=1`. This is a status filter, not a tenant filter: rule 2
     still holds, the binding decides whose rows these are. Counting both lists
     in the same pass means the "Archived (3)" door can state its own size, and
     a merchant with none never sees a door to an empty room. */
  const db = forTenant(session.auth!.tenantId);
  const [pages, archivedCount] = await Promise.all([
    db.landingPage.findMany({
      where: showArchived ? { status: "ARCHIVED" } : { status: { not: "ARCHIVED" } },
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
    }),
    db.landingPage.count({ where: { status: "ARCHIVED" } }),
  ]);

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

      {/* LB.21 — the bridge into the Manager, offered only to a tenant that
          HAS the Manager and may write its catalogue. The route checks both
          again; this decides whether the control exists at all (D-06.2). */}
      {mayEdit && hasErpProduct && (
        <PublishToErpPanel errors={errors} />
      )}

      {/* The archive door. Shown when there is something behind it, or when
          you are already through it and need the way back. */}
      {(archivedCount > 0 || showArchived) && (
        <p className="mt-4 text-sm">
          {showArchived ? (
            <Link href="/console/builder/pages" className="underline underline-offset-4">
              {t("builder.pages.backToActive")}
            </Link>
          ) : (
            <Link
              href="/console/builder/pages?archived=1"
              data-testid="archived-link"
              className="text-muted-foreground underline underline-offset-4"
            >
              {t("builder.pages.archivedCount", { count: archivedCount })}
            </Link>
          )}
        </p>
      )}

      {pages.length === 0 ? (
        <EmptyState
          testId="landings-table"
          // The archived view's emptiness means something different from a new
          // workspace's: offering "create your first page" to someone who came
          // looking for what they archived would answer a question they did
          // not ask.
          title={showArchived ? t("builder.pages.archivedEmpty") : t("builder.overview.firstPageTitle")}
          description={showArchived ? t("builder.pages.archivedHint") : t("builder.overview.firstPageHint")}
          action={
            mayEdit && !showArchived ? (
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
                      archived={p.status === "ARCHIVED"}
                      labels={{
                        edit: t("common.edit"),
                        duplicate: t("builder.pages.duplicate"),
                        view: t("builder.pages.view"),
                        archive: t("builder.pages.archive"),
                        restore: t("builder.pages.restore"),
                        archiveConfirm: t("builder.pages.archiveConfirm"),
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
