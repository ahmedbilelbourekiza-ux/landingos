import "server-only";

import type { TenantDb } from "@landingos/db";
import { can, type AuthContext } from "@landingos/auth";

import { LANDING_PLATFORM } from "./from-landing";
import { levelsFromMatrix, type VariantStockContext } from "../landing/variant-stock";

/**
 * VS.1 — what the variant editor may say about this page's stock.
 *
 * Read inside the editor's own transaction, and ONE statement: the link and
 * the product it points at come back together, the same arithmetic
 * `variantLevelsFor` was decided on. A person without the Manager costs no
 * query at all — `can()` already folds the subscription in.
 */
export async function variantStockContext(
  db: TenantDb,
  auth: AuthContext,
  landingPageId: string,
): Promise<VariantStockContext> {
  if (!can(auth, "erp:products:read")) return { mode: "none" };

  const link = (await db.catalogProductLink.findFirst({
    where: { platform: LANDING_PLATFORM, externalProductId: landingPageId },
    select: { product: { select: { id: true, variants: true } } },
  })) as { product: { id: string; variants: unknown } | null } | null;

  const canSend = can(auth, "erp:products:write");
  if (!link?.product) return { mode: "unlinked", canSend };

  return {
    mode: "linked",
    productId: link.product.id,
    canWrite: can(auth, "erp:inventory:write"),
    canSend,
    levels: levelsFromMatrix(link.product.variants),
  };
}
