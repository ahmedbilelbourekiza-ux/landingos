import Link from "next/link";

import { withTenant } from "@landingos/db";
import { toneVars } from "@landingos/ui";
import { can } from "@landingos/auth";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { FilterBar } from "@/components/console/filter-bar";
import { Pager } from "@/components/console/pager";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";
import {
  ProductCreatePanel,
  ProductEditPanel,
  ProductRowActions,
  type CatalogStrings,
  type EditableProduct,
} from "@/components/console/erp/catalog-write";
import { editFingerprint, type EditField } from "@/components/console/edit-field";
import {
  VariantEditorPanel,
  type EditableProductVariants,
} from "@/components/console/erp/variant-editor";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { ListFrame } from "@/components/console/ui/list-frame";
import {
  catalogStrings, filterStrings, pagerStrings, variantEditorStrings,
  densityStrings, emptyCopy,
} from "@/lib/console/erp-strings";
import { inventoryView } from "@/lib/erp/inventory";
import { duplicateProductNames } from "@/lib/erp/product-stats";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") params.set(k, v);
  }
  const archived = params.get("archived") === "true";
  const page = Math.max(1, Number(params.get("page")) || 1);

  // The same shape `GET /api/erp/products` builds, so the screen and the
  // endpoint cannot disagree about what a search matches.
  const search = params.get("search")?.trim();
  const where = {
    archived,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { sku: { contains: search, mode: "insensitive" as const } },
            { reference: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { products, total, ambiguous } = await withTenant(session.auth!.tenantId, async (db) => {
    const total = await db.catalogProduct.count({ where });
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    return {
    total,
    products: await db.catalogProduct.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, reference: true, name: true, sku: true, brand: true, description: true,
        price: true, costPrice: true, packagingCost: true,
        stock: true, threshold: true, variants: true, archived: true,
        // LP.18 — the three classification fields and the variant vocabulary.
        niche: true, category: true, supplier: true, optionDefs: true, image: true,
      },
    }),
    /* The audit's finding, from driving a real order through the running
       console: two catalogue rows answering to one normalised name means an
       order naming it can be attributed to neither — the counters stay still
       and `/sales-summary` would count its revenue twice, once per row. It is
       refused rather than guessed (D-LP.5.2's rule), and this is the reader
       that makes it fixable: the rows are marked where somebody can rename
       one. */
    ambiguous: await duplicateProductNames(db),
    };
  });

  const currency = session.tenant!.currency;

  // Phase 6.3c. `erp:products:write` is what both the create route and the
  // archive route check, so it is what decides whether either control exists.
  const mayWrite = can(session.auth!, "erp:products:write");
  /* LP.18. `PUT /products/[id]/variants` moves stock, so it is gated on
     `erp:inventory:write` — the permission `/inventory/adjust` checks — rather
     than on `erp:products:write`. Somebody who may only edit product TEXT must
     not be able to move a level by renaming a variant (D-06.2). */
  const mayMoveStock = can(session.auth!, "erp:inventory:write");
  const errors = actionErrors(t);
  const s: CatalogStrings = catalogStrings(t);

  /* The edit panel's vocabulary, built on the server from the same rows the
   * table renders. `PATCH /api/erp/products/[id]` accepts exactly these fields
   * plus `image`; the image needs an uploader rather than a text box, so it is
   * absent here deliberately rather than offered as a control that cannot work.
   * Money reaches the client as the Decimal's STRING form — going through a JS
   * number to build a form value would undo M-06 at the last step. */
  const editable: readonly EditableProduct[] = products.map((p) => {
    const fields: readonly EditField[] = [
      { name: "name", label: t("erp.products.title"), value: p.name ?? "", kind: "text" },
      { name: "sku", label: t("erp.products.sku"), value: p.sku ?? "", kind: "text" },
      { name: "brand", label: t("erp.orders.brand"), value: p.brand ?? "", kind: "text" },
      { name: "price", label: t("erp.products.price"), value: (p.price ?? 0).toString(), kind: "money" },
      { name: "costPrice", label: t("erp.products.cost"), value: (p.costPrice ?? 0).toString(), kind: "money" },
      { name: "packagingCost", label: t("erp.write.packaging"), value: (p.packagingCost ?? 0).toString(), kind: "money" },
      { name: "threshold", label: t("erp.inventory.threshold"), value: String(p.threshold ?? 0), kind: "number" },
      { name: "description", label: t("erp.write.description"), value: p.description ?? "", kind: "textarea" },
      /* LP.18 / R12 — the three classification fields the ERP had. `niche` is
         the load-bearing one: the legacy's client filter and one analytics
         breakdown both group by it, so until this column existed neither was
         computable. */
      { name: "niche", label: t("erp.products.niche"), value: p.niche ?? "", kind: "text" },
      { name: "category", label: t("erp.products.category"), value: p.category ?? "", kind: "text" },
      { name: "supplier", label: t("erp.products.supplier"), value: p.supplier ?? "", kind: "text" },
      /* The product-level image. Absent before this slice because "it needs its
         own surface" — it does not: it is a URL like any other text field, and
         the R2 move (M-14) changes what goes IN it, not whether it can be
         typed. What still has no control is uploading a file. */
      { name: "image", label: t("erp.write.image"), value: p.image ?? "", kind: "text" },
    ];
    return {
      id: p.id,
      label: p.name || p.reference || p.id,
      fields,
      fingerprint: editFingerprint(fields),
    };
  });

  /* LP.18 — the variant matrix, per product, from what the server holds.
     `inventoryView` is the same shape `GET /products/[id]/variants` answers
     with, so the panel and the route cannot disagree about a level. */
  const variantEditable: readonly EditableProductVariants[] = products.map((p) => {
    const view = inventoryView(p);
    const defs = (Array.isArray(p.optionDefs) ? p.optionDefs : []) as {
      name?: string; values?: string[];
    }[];
    return {
      id: p.id,
      label: p.name || p.reference || p.id,
      variants: view.variants.map((v) => ({
        name: v.name,
        sku: v.sku ?? "",
        stock: v.stock,
        threshold: v.threshold,
        options: (v.options ?? {}) as Record<string, string>,
      })),
      optionDefs: defs.map((d) => ({
        name: String(d.name ?? ""),
        values: Array.isArray(d.values) ? d.values.map(String) : [],
      })),
      // Every level and every name, so a save remounts the panel on what was
      // stored rather than on what was typed (D-06.3).
      fingerprint: JSON.stringify(view.variants),
    };
  });

  return (
    <ConsoleShell session={session} productId="erp">
      <PageBody>
      <PageHeader
        title={t("erp.products.title")}
        meta={
          archived && (
            <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {t("erp.products.archived")}
            </span>
          )
        }
      />

      {/* The write surfaces, grouped above the reading surface rather than
          strung between the title and the table one at a time. */}
      {(mayWrite || mayMoveStock) && (
        <div className="space-y-3">
          {/* Not on the archived view: creating a product from a list of things
              nobody sells any more would put the new row somewhere invisible. */}
          {mayWrite && !archived && <ProductCreatePanel errors={errors} s={s} />}

          {/* Offered on BOTH views. Archiving means "stop selling it", not
              "freeze it": a wrong cost basis is usually discovered from a report
              about a product nobody sells any more, and the route accepts the
              edit either way — so withholding the control here would hide a
              write the API allows (D-06.2). */}
          {mayWrite && <ProductEditPanel products={editable} errors={errors} s={s} />}

          {/* LP.18 — the variant matrix. Gated on the permission the ROUTE
              checks, which is not the one above it. */}
          {mayMoveStock && (
            <VariantEditorPanel
              products={variantEditable}
              errors={errors}
              s={variantEditorStrings(t)}
            />
          )}
        </div>
      )}

      <ListFrame
        density={densityStrings(t)}
        toolbar={
          <FilterBar
            basePath="/console/erp/products"
            params={params}
            fields={[{ name: "search", label: t("erp.filters.search"), kind: "text", wide: true }]}
            s={filterStrings(t)}
            testId="erp-products-filters"
          />
        }
        pager={
          <Pager
            basePath="/console/erp/products"
            params={params}
            info={{ page, pageSize: PAGE_SIZE, total }}
            s={pagerStrings(t)}
            testId="erp-products-pager"
          />
        }
      >
      <DataTable
        testId="erp-products-table"
        empty={t("erp.products.none")}
        emptyCopy={emptyCopy(t, Boolean(search), t("erp.products.none"))}
        caption={t("erp.products.title")}
        rows={products}
        rowKey={(p) => p.id}
        rowAttrs={(p) => ({ "data-product-id": p.id })}
        columns={[
          {
            id: "product",
            header: t("erp.products.title"),
            cell: (p) => (
              <>
                {/* The audit's finding: the product's lifetime counters, its
                    event timeline and the channels it is linked to were all
                    written and read by nothing. The row opens the record that
                    shows them. */}
                <Link
                  href={`/console/erp/products/${p.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {p.name || "—"}
                </Link>
                {ambiguous.has(p.id) && (
                  <span
                    data-badge="ambiguous-name"
                    title={t("erp.products.ambiguousHint")}
                    className="ms-2 rounded-full border px-1.5 py-0.5 text-[10px]"
                    style={toneVars("danger")}
                  >
                    {t("erp.products.ambiguous")}
                  </span>
                )}
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
          // Archive, never delete: a product is referenced by every order that
          // contained it and by its own ledger. The archived view offers the
          // other half rather than pretending the row is gone.
          ...(mayWrite
            ? [
                {
                  id: "actions",
                  header: "",
                  align: "end" as const,
                  cell: (p: (typeof products)[number]) => (
                    <ProductRowActions
                      productId={p.id}
                      archived={Boolean(p.archived)}
                      errors={errors}
                      s={s}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      </ListFrame>
      </PageBody>
    </ConsoleShell>
  );
}
