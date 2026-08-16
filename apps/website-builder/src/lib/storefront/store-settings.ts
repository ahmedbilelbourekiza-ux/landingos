import "server-only";

import { cache } from "react";

import { withTenant } from "@landingos/db";

/* =============================================================================
 * ONE StoreSettings read per storefront request (LB.51).
 *
 * Measured before this existed (statement census against the running build):
 * one product-page render issued THREE separate StoreSettings SELECTs in three
 * separate transactions — the layout's generateMetadata opened its own for
 * favicon/name/description, and the page's load() ran twice (metadata + render),
 * each selecting the socials set. Three transactions for one row that cannot
 * change between them, on the platform's most latency-sensitive route.
 *
 * `cache()` scopes the dedup to the REQUEST, exactly like
 * `resolveStorefrontTenant` — this is per-request dedup, not cross-request
 * caching, so LB.14a's rule (a shared cache may reuse a response only when a
 * stale copy cannot cost money or expose an order) is not in play: the next
 * request still reads the row fresh.
 *
 * The select is the UNION of what the layout and the pages need. Callers take
 * the fields they want and ignore the rest — one shape, because the day two
 * call sites grow their own selects the dedup silently stops deduping.
 * ========================================================================== */

export interface StorefrontStoreSettings {
  readonly storeName: string | null;
  readonly storeDescription: string | null;
  readonly logo: string | null;
  readonly favicon: string | null;
  readonly facebook: string | null;
  readonly instagram: string | null;
  readonly tiktok: string | null;
  readonly whatsapp: string | null;
  readonly telegram: string | null;
}

export const storefrontStoreSettings = cache(
  async (tenantId: string): Promise<StorefrontStoreSettings | null> =>
    withTenant(tenantId, (db) =>
      (db as any).storeSettings.findUnique({
        where: { tenantId },
        select: {
          storeName: true,
          storeDescription: true,
          logo: true,
          favicon: true,
          facebook: true,
          instagram: true,
          tiktok: true,
          whatsapp: true,
          telegram: true,
        },
      }),
    ) as Promise<StorefrontStoreSettings | null>,
);
