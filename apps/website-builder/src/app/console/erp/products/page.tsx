import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";
import { inventoryView } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The catalogue.
 *
 * `?archived=true` is a separate view, not a filter that widens the default
 * one. Archiving is how this product removes something without destroying the
 * history that references it, so the active list must never include archived
 * rows by accident — and the archived list must be reached deliberately.
 *
 * The cost basis is shown next to the price because the two together are the
 * margin, and a catalogue that shows only the price invites a manager to guess
 * it. Both are Decimal strings, formatted; neither goes through a JS number.
 * ========================================================================== */

export default async function ErpProductsScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/products");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const archived = (await searchParams).archived === "true";

  const products = await withTenant(session.auth!.tenantId, (db) =>
    db.catalogProduct.findMany({
      where: { archived },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true, reference: true, name: true, sku: true,
        price: true, costPrice: true, packagingCost: true,
        stock: true, threshold: true, variants: true, archived: true,
      },
    }),
  );

  const currency = session.tenant!.currency;

  return (
    <ConsoleShell session={session} productId="erp">
      <h1 className="text-xl font-semibold">
        {t("erp.products.title")}
        {archived && (
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            {t("erp.products.archived")}
          </span>
        )}
      </h1>

      <DataTable
        testId="erp-products-table"
        empty={t("erp.products.none")}
        rows={products}
        rowKey={(p) => p.id}
        rowAttrs={(p) => ({ "data-product-id": p.id })}
        columns={[
          {
            id: "product",
            header: t("erp.products.title"),
            cell: (p) => (
              <>
                <span className="font-medium">{p.name || "—"}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground" dir="ltr">
                  {p.reference ?? ""}
                </span>
              </>
            ),
          },
          {
            id: "sku",
            header: t("erp.products.sku"),
            cell: (p) => (
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {p.sku || "—"}
              </span>
            ),
          },
          {
            id: "price",
            header: t("erp.products.price"),
            numeric: true,
            align: "end",
            cell: (p) => formatMoney(p.price?.toString() ?? "0", locale, currency),
          },
          {
            id: "cost",
            header: t("erp.products.cost"),
            numeric: true,
            align: "end",
            cell: (p) => (
              <span className="text-muted-foreground">
                {formatMoney(
                  (p.costPrice ?? 0).toString(),
                  locale,
                  currency,
                )}
              </span>
            ),
          },
          {
            id: "stock",
            header: t("erp.products.stock"),
            numeric: true,
            align: "end",
            cell: (p) => {
              const view = inventoryView(p);
              // Low stock is judged per variant elsewhere; this column is the
              // rolled-up figure the grid has always shown, flagged when the
              // total is at or under the threshold.
              const low = view.threshold > 0 && view.stock <= view.threshold;
              return (
                <span data-low={low ? "true" : "false"} className={low ? "font-medium" : ""}>
                  {view.stock}
                </span>
              );
            },
          },
          {
            id: "variants",
            header: t("erp.products.variants"),
            numeric: true,
            align: "end",
            cell: (p) => inventoryView(p).variants.length,
          },
        ]}
      />
    </ConsoleShell>
  );
}
