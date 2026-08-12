import "server-only";

import type { Prisma } from "@landingos/db";

/* =============================================================================
 * What delivery costs, for one product, to one wilaya — LB.20.
 *
 * ONE function, called by the endpoint that QUOTES the price to the customer
 * (`/wilayas`, which fills the destination dropdown) and by the one that
 * CHARGES it (`/orders`). That is the whole point of the file: if the dropdown
 * quoted the company's rate while checkout applied the product's, a customer
 * would be billed something other than what they were shown. There is no
 * failure here that a test suite over one of the two routes would catch, and
 * the money is real — this is the same lesson LB.1 learned when the browser and
 * the API held two copies of a vocabulary.
 *
 * THE RULE, in one sentence: a per-product price overrides the company's, and
 * absence means the company's applies.
 *
 * Absence is the common case and has to stay cheap. A product that ships at the
 * standard rate everywhere has NO rows here, so the override query returns
 * nothing and the tenant map is used whole. A product with one exception has one
 * row. Nothing copies 58 wilayas per page — beyond the waste, a snapshot would
 * freeze the company's prices at the moment the page was made, and a later
 * change to the standard rate would silently miss every page that had one.
 * ========================================================================== */

export interface DeliveryPrice {
  readonly wilayaId: number;
  readonly homePrice: Prisma.Decimal;
  readonly deskPrice: Prisma.Decimal | null;
}

/**
 * Every wilaya this product can be delivered to, and what it costs.
 *
 * Keyed by wilaya id. A wilaya absent from the map is UNDELIVERABLE — not free.
 * That distinction is load-bearing: the pre-LB.20 checkout already refused an
 * unpriced wilaya rather than shipping at zero, and layering overrides must not
 * quietly turn a missing price into a present one.
 */
export async function deliveryPricesFor(
  db: {
    tenantDeliveryPrice: { findMany: (args?: unknown) => Promise<unknown[]> };
    landingDeliveryPrice: { findMany: (args?: unknown) => Promise<unknown[]> };
  },
  landingPageId: string | null,
): Promise<Map<number, DeliveryPrice>> {
  const tenantRows = (await db.tenantDeliveryPrice.findMany()) as DeliveryPrice[];

  const prices = new Map<number, DeliveryPrice>();
  for (const row of tenantRows) {
    prices.set(row.wilayaId, {
      wilayaId: row.wilayaId,
      homePrice: row.homePrice,
      deskPrice: row.deskPrice,
    });
  }

  if (!landingPageId) return prices;

  /* The overrides, layered on top. Bound by RLS to this tenant, and filtered
   * by page — so another tenant's override cannot be read even with a guessed
   * page id, and this product cannot pick up another product's price. */
  const overrides = (await db.landingDeliveryPrice.findMany({
    where: { landingPageId },
  })) as DeliveryPrice[];

  for (const row of overrides) {
    prices.set(row.wilayaId, {
      wilayaId: row.wilayaId,
      homePrice: row.homePrice,
      deskPrice: row.deskPrice,
    });
  }

  return prices;
}

/**
 * The amount charged for one method, from a resolved row.
 *
 * `deskPrice ?? homePrice` is the pre-existing rule, kept: a tenant who prices
 * home delivery and leaves the desk blank means "the same", not "free". It
 * lives here so the quote and the charge cannot apply it differently.
 */
export function priceForMethod(
  price: DeliveryPrice,
  method: "HOME" | "DESK",
): Prisma.Decimal {
  return method === "DESK" ? (price.deskPrice ?? price.homePrice) : price.homePrice;
}
