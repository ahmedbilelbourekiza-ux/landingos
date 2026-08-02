import { tenantRoute, apiOk } from "@/lib/api/route";
import { inventoryView } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

/**
 * What is about to run out.
 *
 * Evaluated per VARIANT, not per product, because that is where the problem
 * actually is: a shoe with 200 units in stock is not fine if 199 of them are
 * size 45. A product-level check reports healthy stock right up until the size
 * everyone buys is gone.
 *
 * Archived products are excluded — a product nobody is selling cannot be
 * understocked, and including them fills the alert list with noise until the
 * real warnings stop being read.
 */
export const GET = tenantRoute("erp:products:read", async ({ db }) => {
  const products = await db.catalogProduct.findMany({
    where: { archived: false },
    select: { id: true, reference: true, name: true, sku: true, stock: true, threshold: true, variants: true },
  });

  const items: Array<Record<string, unknown>> = [];
  for (const product of products) {
    const view = inventoryView(product);
    if (view.variants.length) {
      for (const variant of view.variants) {
        if (variant.threshold > 0 && variant.stock <= variant.threshold) {
          items.push({
            productId: product.id, reference: product.reference, name: product.name,
            variantName: variant.name, sku: variant.sku ?? product.sku,
            stock: variant.stock, threshold: variant.threshold,
          });
        }
      }
    } else if (view.threshold > 0 && view.stock <= view.threshold) {
      items.push({
        productId: product.id, reference: product.reference, name: product.name,
        variantName: null, sku: product.sku, stock: view.stock, threshold: view.threshold,
      });
    }
  }

  items.sort((a, b) => Number(a.stock) - Number(b.stock));
  return apiOk({ items, total: items.length });
});
