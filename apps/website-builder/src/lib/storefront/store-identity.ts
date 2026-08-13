import { siteConfig } from "@/config/site";

/* =============================================================================
 * Whose name a storefront wears.
 *
 * A customer-facing page must never show the PLATFORM's identity. There were
 * two ways it could, and both are closed here rather than at the call sites,
 * because a fallback repeated in five components is five chances to forget one.
 *
 * 1. NO StoreSettings ROW. `storeName` is not merely blank then — the whole
 *    row is absent, so the template had nothing to render and fell back to the
 *    platform wordmark. Measured 13 Aug 2026: BOTH production tenants have a
 *    null settings row, so this was one publish away from a real customer.
 *
 * 2. A ROW THAT NEVER GOT A NAME. `StoreSettings.storeName` is NOT NULL with
 *    `@default("LandingOS")`, so an untouched row holds the platform's own
 *    name as a literal value. `storeName ?? tenant.name` cannot help: the
 *    column is never null, so the `??` never fires and the default wins.
 *
 * The tenant's own name is the honest fallback for both — it is what the
 * merchant signed up as, and it is already unique and non-empty.
 * ========================================================================== */

/** The `StoreSettings.storeName` column default — a placeholder, not a name. */
const PLACEHOLDER_STORE_NAME = siteConfig.name;

export function resolveStoreName(
  storeName: string | null | undefined,
  tenantName: string,
): string {
  const trimmed = storeName?.trim();
  if (!trimmed) return tenantName;
  // Case-insensitive: the point is that nobody DELIBERATELY names their shop
  // after the platform, so a match means the default was never replaced.
  if (trimmed.toLowerCase() === PLACEHOLDER_STORE_NAME.toLowerCase()) return tenantName;
  return trimmed;
}
