import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { catalogStrings } from "@/lib/console/erp-strings";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import {
  StockAdjustPanel,
  StockLotPanel,
  type StockProduct,
} from "@/components/console/erp/catalog-write";
import { inventoryView } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Inventory — what is running out, and what has moved.
 *
 * LOW STOCK IS PER VARIANT. A shoe with 200 units is not fine if 199 of them
 * are size 45, and a product-level check reports healthy stock right up until
 * the size everyone buys is gone. Archived products are excluded: a product
 * nobody sells cannot be understocked, and including them fills the list with
 * noise until the real warnings stop being read.
 *
 * The movement ledger is APPEND-ONLY, and the screen offers no way to edit a
 * row because no such route exists. Every entry carries where stock was and
 * where it went, so the history can be reconstructed and none of it argued
 * with — which is only true while nothing can rewrite it.
 * ========================================================================== */

export default async function ErpInventoryScreen() {
  const { session, locale: raw, t } = await requireProduct("erp", "/console/erp/inventory");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const { low, movements, stockProducts } = await withTenant(session.auth!.tenantId, async (db) => {
    const products = await db.catalogProduct.findMany({
      where: { archived: false },
      select: { id: true, reference: true, name: true, sku: true, stock: true, threshold: true, variants: true },
    });

    const low: Array<{
      key: string; name: string; variantName: string | null;
      sku: string | null; stock: number; threshold: number;
    }> = [];

    for (const product of products) {
      const view = inventoryView(product);
      if (view.variants.length) {
        for (const variant of view.variants) {
          if (variant.threshold > 0 && variant.stock <= variant.threshold) {
            low.push({
              key: `${product.id}:${variant.name}`,
              name: product.name ?? "",
              variantName: variant.name,
              sku: variant.sku ?? product.sku,
              stock: variant.stock,
              threshold: variant.threshold,
            });
          }
        }
      } else if (view.threshold > 0 && view.stock <= view.threshold) {
        low.push({
          key: product.id,
          name: product.name ?? "",
          variantName: null,
          sku: product.sku,
          stock: view.stock,
          threshold: view.threshold,
        });
      }
    }
    low.sort((a, b) => a.stock - b.stock);

    const movements = await db.inventoryMovement.findMany({
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true, variantName: true, delta: true, prevQty: true, newQty: true,
        reason: true, ts: true, product: { select: { name: true } },
      },
    });

    // What the write panels can act on. Read from the SAME `products` the low
    // stock scan already loaded — a second query would be a second answer to
    // "which products exist", and the archived ones are excluded from both for
    // the same reason: stock nobody sells cannot be corrected into usefulness.
    const stockProducts: StockProduct[] = products
      .map((p) => ({
        id: p.id,
        name: p.name ?? p.sku ?? p.reference ?? p.id,
        variants: inventoryView(p).variants.map((v) => v.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { low, movements, stockProducts };
  });

  // Phase 6.3c. `erp:inventory:write` is what both stockroom routes check.
  const mayWrite = can(session.auth!, "erp:inventory:write") && stockProducts.length > 0;
  const errors = actionErrors(t);
  const s = catalogStrings(t);

  return (
    <ConsoleShell session={session} productId="erp">
      <PageHeader title={t("erp.inventory.title")} />

      {mayWrite && (
        <>
          <StockAdjustPanel errors={errors} s={s} products={stockProducts} />
          <StockLotPanel errors={errors} s={s} products={stockProducts} />
        </>
      )}

      <h2 className="mt-6 text-sm font-semibold tracking-tight">{t("erp.inventory.lowStock")}</h2>
      <DataTable
        testId="erp-low-stock-table"
        empty={t("erp.inventory.healthy")}
        rows={low}
        rowKey={(r) => r.key}
        columns={[
          {
            id: "product",
            header: t("erp.products.title"),
            cell: (r) => (
              <>
                <span className="font-medium">{r.name || "—"}</span>
                {r.variantName && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t("erp.inventory.variant")}: {r.variantName}
                  </span>
                )}
              </>
            ),
          },
          {
            id: "sku",
            header: t("erp.products.sku"),
            cell: (r) => (
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {r.sku || "—"}
              </span>
            ),
          },
          {
            id: "stock",
            header: t("erp.products.stock"),
            numeric: true,
            align: "end",
            cell: (r) => <span className="font-medium">{r.stock}</span>,
          },
          {
            id: "threshold",
            header: t("erp.inventory.threshold"),
            numeric: true,
            align: "end",
            cell: (r) => <span className="text-muted-foreground">{r.threshold}</span>,
          },
        ]}
      />

      <h2 className="mt-8 text-sm font-semibold tracking-tight">{t("erp.inventory.movements")}</h2>
      <DataTable
        testId="erp-movements-table"
        empty={t("common.empty")}
        rows={movements}
        rowKey={(m) => String(m.id)}
        columns={[
          {
            id: "when",
            header: t("erp.orders.placed"),
            cell: (m) => (
              <span className="text-muted-foreground">{formatDate(m.ts, locale)}</span>
            ),
          },
          {
            id: "product",
            header: t("erp.products.title"),
            cell: (m) => (
              <>
                <span>{m.product?.name || "—"}</span>
                {m.variantName && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {m.variantName}
                  </span>
                )}
              </>
            ),
          },
          {
            id: "delta",
            header: t("erp.inventory.change"),
            numeric: true,
            align: "end",
            cell: (m) => (
              // Signed, and left-to-right: a minus sign that renders on the
              // wrong side of the digits reads as a plus.
              <span dir="ltr" className={(m.delta ?? 0) < 0 ? "text-muted-foreground" : ""}>
                {(m.delta ?? 0) > 0 ? `+${m.delta}` : m.delta}
              </span>
            ),
          },
          {
            id: "after",
            header: t("erp.inventory.after"),
            numeric: true,
            align: "end",
            cell: (m) => m.newQty ?? "—",
          },
          {
            id: "reason",
            header: t("erp.inventory.reason"),
            cell: (m) => <span className="text-muted-foreground">{m.reason || "—"}</span>,
          },
        ]}
      />
    </ConsoleShell>
  );
}
