import "server-only";

import type { TenantDb } from "@landingos/db";

import { normalizeProductName, externalLinkKey } from "./product-match";
import { stockLevel, type StockSeverity } from "./stock-level";

/* =============================================================================
 * The catalogue row an ORDER is about — PM.2 and PM.5.
 *
 * WHAT IT RESTORES. The legacy CRM shows a product photograph on every order:
 * `variantImageFor(order)` finds the catalogue row by name, takes the SELECTED
 * VARIANT'S photograph, and falls back to the product's own when the variant
 * has none. The platform ported the columns and none of the readers, so an
 * order detail was — and every order row still is — a line of text where the
 * legacy showed the thing being sold.
 *
 * WHAT IT ADDS, and it is the half that changes an outcome rather than a look:
 * the same lookup already knows the STOCK LEVEL of the exact variant somebody
 * is about to confirm. An agent on the phone saying yes to a size that ran out
 * this morning is a delivery the warehouse cannot make, a courier dispatched
 * for nothing and a customer called back to be told no — and until now the
 * screen where that decision is taken said nothing about it.
 *
 * -----------------------------------------------------------------------------
 * THE RESOLUTION ORDER IS `resolveProduct`'S, DELIBERATELY
 *
 * The link first (`externalProductId` + platform + channel), exclusively, then
 * the normalised name. Not because this screen needs the precision, but because
 * a SECOND opinion about "which product is this order" is how a photograph
 * ends up disagreeing with the revenue counters on the same row — and AUDIT.3
 * is the record of what a wrong answer here costs.
 *
 * A DUPLICATE NAME RESOLVES TO NOTHING, for the same reason. Two catalogue rows
 * answering to one normalised name means an order naming it belongs to neither;
 * `resolveProduct` refuses rather than taking the first, and showing the first
 * one's photograph here would be a guess the rest of the system declined to
 * make.
 * ========================================================================== */

export interface OrderProduct {
  readonly productId: string;
  readonly name: string;
  /** The variant's photograph, falling back to the product's own. */
  readonly image: string | null;
  /** The level of the SELECTED variant, or the product's roll-up. */
  readonly stock: number;
  readonly threshold: number;
  readonly severity: StockSeverity;
  /** True where the order names a variant that the catalogue does not have. */
  readonly unknownVariant: boolean;
}

interface OrderLike {
  readonly product: string | null;
  readonly productVariant: string | null;
  readonly externalProductId?: string | null;
  readonly platform?: string | null;
  readonly salesChannelId?: string | null;
}

interface VariantRow {
  name?: string;
  stock?: number | null;
  threshold?: number | null;
  image?: string | null;
}

type CatalogRow = {
  id: string;
  name: string | null;
  image: string | null;
  stock: number | null;
  threshold: number | null;
  variants: unknown;
};

type LinkRow = {
  productId: string;
  platform: string | null;
  salesChannelId: string | null;
  externalProductId: string | null;
};

function build(order: OrderLike, products: readonly CatalogRow[], links: readonly LinkRow[]) {
  const wanted = normalizeProductName(order.product);
  if (!wanted && !order.externalProductId) return null;

  let match: CatalogRow | undefined;

  if (order.externalProductId) {
    const key = externalLinkKey(order.platform, order.salesChannelId, order.externalProductId);
    const linked = links.find(
      (l) => externalLinkKey(l.platform, l.salesChannelId, l.externalProductId) === key,
    );
    // A LINK THAT RESOLVES DECIDES — including deciding "this one and not the
    // name match". AUDIT.7's rule, and the branch it found had never run.
    if (linked) match = products.find((p) => p.id === linked.productId);
  }

  if (!match && wanted) {
    const byName = products.filter((p) => normalizeProductName(p.name) === wanted);
    // Two rows answering to one name attributes to NEITHER (AUDIT.3). The
    // products screen marks both so somebody can rename one.
    if (byName.length === 1) match = byName[0];
  }

  if (!match) return null;

  const variants = (Array.isArray(match.variants) ? match.variants : []) as VariantRow[];
  const wantedVariant = (order.productVariant ?? "").trim();
  const variant = wantedVariant
    ? variants.find((v) => (v.name ?? "").trim() === wantedVariant)
    : undefined;

  const threshold = Number(variant?.threshold ?? match.threshold ?? 0);
  const stock = variant
    ? Number(variant.stock ?? 0)
    : variants.length
      ? variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
      : Number(match.stock ?? 0);

  return {
    productId: match.id,
    name: match.name ?? "",
    image: (variant?.image || match.image || null) as string | null,
    stock,
    threshold,
    severity: stockLevel(stock, threshold),
    // Said rather than hidden: an order naming "XL" when the catalogue has no
    // XL is a channel-mapping problem, and the level shown beside it is the
    // product's roll-up rather than that variant's — so the screen has to say
    // which number it is showing.
    unknownVariant: Boolean(wantedVariant) && !variant,
  } satisfies OrderProduct;
}

/**
 * Every order on a page, resolved in TWO reads — not two per row.
 *
 * PERF-02's rule applied to a new reader. The catalogue is tens to hundreds of
 * rows for a call centre and the match is on a NORMALISED form Postgres has no
 * index for, so it cannot be a join and it must not be a query per row: fifty
 * orders would be a hundred round trips on the screen an agent lives in, which
 * is precisely the cost `ORDER_LIST_SELECT` refuses to pay for call history.
 *
 * Archived products are included. An order placed last month for something no
 * longer sold still has a photograph and a name.
 */
export async function resolveOrderProducts<T extends OrderLike & { id: string }>(
  db: TenantDb,
  orders: readonly T[],
): Promise<Map<string, OrderProduct>> {
  if (!orders.length) return new Map();

  const [products, links] = await Promise.all([
    db.catalogProduct.findMany({
      select: {
        id: true, name: true, image: true, stock: true, threshold: true, variants: true,
      },
    }),
    orders.some((o) => o.externalProductId)
      ? db.catalogProductLink.findMany({
          select: {
            productId: true, platform: true, salesChannelId: true, externalProductId: true,
          },
        })
      : Promise.resolve([] as LinkRow[]),
  ]);

  const out = new Map<string, OrderProduct>();
  for (const order of orders) {
    const resolved = build(order, products, links);
    if (resolved) out.set(order.id, resolved);
  }
  return out;
}

/**
 * Resolve one order to its catalogue row.
 *
 * `null` when nothing matches, when two rows match one name, or when the order
 * names no product at all — each of which is a real state, and none of which
 * may be papered over with a guess.
 */
export async function resolveOrderProduct(
  db: TenantDb,
  order: OrderLike,
): Promise<OrderProduct | null> {
  const resolved = await resolveOrderProducts(db, [{ ...order, id: "one" }]);
  return resolved.get("one") ?? null;
}
