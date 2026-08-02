import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { inventoryView } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Per-variant stock and thresholds.
 *
 * A variant with no threshold of its own inherits the product's, rather than
 * defaulting to zero: zero means "never warn me", which is the opposite of what
 * an unset threshold is asking for.
 */
export const GET = tenantRoute<Params>("erp:products:read", async ({ db, params }) => {
  const product = await db.catalogProduct.findUnique({
    where: { id: params.id },
    select: { id: true, stock: true, threshold: true, variants: true },
  });
  if (!product) return apiError(404, "NOT_FOUND", "No such product.");
  return apiOk({ productId: product.id, ...inventoryView(product) });
});
