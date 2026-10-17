import { z } from "zod";
import { apiOk, apiError } from "@/lib/api/route";
import { landingWriteRoute } from "@/lib/api/landing-write";
import { axesWithOwnPrice } from "@/lib/landing/variant-price";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Item = z.object({
  name: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(120),
  extraPrice: z.coerce.number().default(0),
  /* VP.1 — the option's own unit price. Empty (null, absent or "") means the
   * product price; it is never coerced, because `Number("")` is 0 and a blank
   * box would have become a free variant. */
  price: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().min(0).nullable(),
  ),
});
const Body = z.object({ items: z.array(Item).max(200) });

export const PUT = landingWriteRoute<Params>("website-builder:pages:write", async ({ db, req, params, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const page = await (db as any).landingPage.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  // The same option twice would render a duplicate choice the customer cannot
  // tell apart, and an order snapshot could not say which was picked.
  const seen = new Set<string>();
  for (const v of parsed.data.items) {
    const key = `${v.name.toLowerCase()}::${v.value.toLowerCase()}`;
    if (seen.has(key)) return apiError(422, "DUPLICATE_VARIANT", `"${v.name}: ${v.value}" is listed twice.`);
    seen.add(key);
  }

  /* VP.1 — own prices on ONE axis. "Size: M = 2800" with "Colour: Gold =
   * 3100" has no honest unit price, so the second priced axis is refused here
   * rather than resolved by a rule the merchant never sees. */
  if (axesWithOwnPrice(parsed.data.items).length > 1) {
    return apiError(422, "VARIANT_PRICE_AXIS", "Variant prices can be set on one option group only.");
  }

  const rows = parsed.data.items.map((v, i) => ({
    ...v,
    // An option that sets its own price carries no add-on: the price IS the
    // figure, and keeping both would count the same row twice.
    extraPrice: v.price !== null ? 0 : v.extraPrice,
    landingPageId: params.id,
    tenantId: session.auth!.tenantId,
    displayOrder: i,
  }));

  // Sequential, NOT $transaction: withTenant already opened one, and the
  // client it hands back has no $transaction because Prisma does not nest
  // them. These statements are therefore already atomic — a failure here rolls
  // the whole request back.
  await (db as any).landingVariant.deleteMany({ where: { landingPageId: params.id } });
  if (rows.length) await (db as any).landingVariant.createMany({ data: rows });

  return apiOk({ id: params.id, count: rows.length });
});
