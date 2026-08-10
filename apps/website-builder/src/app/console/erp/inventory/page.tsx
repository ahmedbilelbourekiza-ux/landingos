import Link from "next/link";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { toneVars } from "@landingos/ui";
import { formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { catalogStrings, stockLabels } from "@/lib/console/erp-strings";
import { PageHeader, PageBody, Section } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { ProductThumb } from "@/components/console/erp/product-thumb";
import { StockChip } from "@/components/console/erp/stock-chip";
import { stockLevel, STOCK_TONE, type StockSeverity } from "@/lib/erp/stock-level";
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
      select: {
        id: true, reference: true, name: true, sku: true, image: true,
        stock: true, threshold: true, variants: true,
      },
    });

    const low: Array<{
      key: string; productId: string; name: string; variantName: string | null;
      sku: string | null; image: string | null; stock: number; threshold: number;
      severity: StockSeverity;
    }> = [];

    for (const product of products) {
      const view = inventoryView(product);
      if (view.variants.length) {
        for (const variant of view.variants) {
          /* PM.5 — three states, not one. `stock <= threshold` is one bit for
             two situations a warehouse treats completely differently: a variant
             at 18 against a threshold of 24 is a restock to schedule, and a
             variant at 0 is an order the call centre is about to confirm and
             cannot ship. Both were the same row, so the second was invisible
             inside a list of the first — and a product with NO threshold set
             could be at zero and never appear here at all, which is the case
             this now catches. */
          const severity = stockLevel(variant.stock, variant.threshold);
          if (severity === "ok") continue;
          low.push({
            key: `${product.id}:${variant.name}`,
            productId: product.id,
            name: product.name ?? "",
            variantName: variant.name,
            sku: variant.sku ?? product.sku,
            image: variant.image || product.image || null,
            stock: variant.stock,
            threshold: variant.threshold,
            severity,
          });
        }
      } else {
        const severity = stockLevel(view.stock, view.threshold);
        if (severity !== "ok") {
          low.push({
            key: product.id,
            productId: product.id,
            name: product.name ?? "",
            variantName: null,
            sku: product.sku,
            image: product.image || null,
            stock: view.stock,
            threshold: view.threshold,
            severity,
          });
        }
      }
    }
    const rank: Record<StockSeverity, number> = { out: 0, critical: 1, low: 2, ok: 3 };
    low.sort((a, b) => rank[a.severity] - rank[b.severity] || a.stock - b.stock);

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

  /* The three counts, as chips on the section header. A list of forty rows
     answers "what is running low"; the chips answer "how bad is it" before
     anybody reads a row — and the two that matter are the two that are not
     "low". A count of zero is omitted rather than shown grey, for the reason
     the dashboard's alert band filters itself: a zero is furniture. */
  const severityLabels: Array<[StockSeverity, string]> = [
    ["out", t("erp.inventory.out")],
    ["critical", t("erp.inventory.critical")],
    ["low", t("erp.inventory.low")],
  ];
  const severityCounts = (
    <>
      {severityLabels.map(([severity, label]) => {
        const n = low.filter((r) => r.severity === severity).length;
        if (!n) return null;
        return (
          <span
            key={severity}
            data-severity-count={severity}
            style={toneVars(STOCK_TONE[severity])}
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
          >
            <span className="tabular-nums" dir="ltr">{n}</span>
            {label}
          </span>
        );
      })}
    </>
  );

  return (
    <>
      <PageBody>
      <PageHeader title={t("erp.inventory.title")} />

      {mayWrite && (
        <>
          <StockAdjustPanel errors={errors} s={s} products={stockProducts} />
          <StockLotPanel errors={errors} s={s} products={stockProducts} />
        </>
      )}

      <Section
        title={t("erp.inventory.lowStock")}
        description={t("erp.inventory.lowStockHint")}
        flush
        testId="erp-low-stock"
        actions={severityCounts}
      >
      <DataTable
        testId="erp-low-stock-table"
        empty={t("erp.inventory.healthy")}
        emptyCopy={{
          title: t("erp.inventory.healthy"),
          description: t("erp.overview.stockHealthyHint"),
        }}
        caption={t("erp.inventory.lowStock")}
        rows={low}
        rowKey={(r) => r.key}
        rowAttrs={(r) => ({ "data-stock-severity": r.severity })}
        columns={[
          {
            id: "product",
            header: t("erp.products.title"),
            cell: (r) => (
              <div className="flex items-start gap-2.5">
                <ProductThumb src={r.image} alt="" size="sm" />
                <div className="min-w-0">
                  <Link
                    href={`/console/erp/products/${r.productId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {r.name || "—"}
                  </Link>
                  {r.variantName && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t("erp.inventory.variant")}: {r.variantName}
                    </span>
                  )}
                </div>
              </div>
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
            align: "end",
            cell: (r) => (
              <StockChip stock={r.stock} threshold={r.threshold} labels={stockLabels(t)} />
            ),
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
      </Section>

      <Section title={t("erp.inventory.movements")} flush testId="erp-movements">
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
      </Section>
      </PageBody>
    </>
  );
}
