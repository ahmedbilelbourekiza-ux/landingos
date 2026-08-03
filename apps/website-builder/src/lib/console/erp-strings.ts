import type { CatalogStrings } from "@/components/console/erp/catalog-write";

/* =============================================================================
 * The catalogue and stockroom labels, resolved once.
 *
 * Two screens need the same bundle — products, and inventory — and building it
 * twice is how one of them ends up a key behind the other. No directive: the
 * server calls it, the client only receives the result.
 * ========================================================================== */

export function catalogStrings(t: (key: string) => string): CatalogStrings {
  return {
    saving: t("common.saving"),
    save: t("common.cancel"),
    newProduct: t("erp.write.newProduct"),
    name: t("erp.products.title"),
    sku: t("erp.products.sku"),
    brand: t("erp.orders.brand"),
    price: t("erp.products.price"),
    cost: t("erp.products.cost"),
    packaging: t("erp.write.packaging"),
    threshold: t("erp.inventory.threshold"),
    stock: t("erp.products.stock"),
    create: t("erp.write.create"),
    archive: t("erp.write.archive"),
    restore: t("erp.write.restore"),
    adjustPanel: t("erp.write.adjustPanel"),
    adjustHint: t("erp.write.adjustHint"),
    product: t("erp.write.product"),
    variant: t("erp.inventory.variant"),
    allVariants: t("erp.write.allVariants"),
    // The movement ledger already labels these columns; one word, one key.
    change: t("erp.inventory.change"),
    reason: t("erp.inventory.reason"),
    adjust: t("erp.write.adjust"),
    lotPanel: t("erp.write.lotPanel"),
    lotHint: t("erp.write.lotHint"),
    mode: t("erp.write.mode"),
    purchase: t("erp.write.purchase"),
    restock: t("erp.write.restock"),
    quantity: t("erp.orders.quantity"),
    unitCost: t("erp.write.unitCost"),
    addLot: t("erp.write.addLot"),
  };
}
