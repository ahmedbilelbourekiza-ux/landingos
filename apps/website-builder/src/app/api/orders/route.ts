import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { sendPurchaseEvent } from "@/lib/meta/capi";
import { triggerOrderWebhook } from "@/lib/webhooks/triggers";

const statusEnum = z.enum(["NEW", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"]);

// GET /api/orders — paginated list with search, filter, sort.
// Protected by middleware (requires auth). Joins LandingPage for product
// thumbnail + title.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20)));
    const search = searchParams.get("search")?.trim() ?? "";
    const rawStatus = searchParams.get("status") ?? "ALL";
    const status = rawStatus === "ALL" ? "ALL" : statusEnum.parse(rawStatus);
    const sort = searchParams.get("sort") ?? "newest";

    const where = {
      ...(status !== "ALL" && { status }),
      // `mode: "insensitive"` is required, not cosmetic: `contains` compiles
      // to SQL LIKE, which was case-insensitive under SQLite but is
      // case-sensitive on Postgres. Without it, searching "ahmed" would stop
      // matching a customer stored as "Ahmed" after the Postgres migration.
      ...(search && {
        OR: [
          { id: { contains: search, mode: "insensitive" as const } },
          { customerName: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const orderBy = { createdAt: sort === "oldest" ? "asc" as const : "desc" as const };

    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          landingPage: {
            select: {
              title: true,
              media: { where: { placement: "GALLERY" }, take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
            },
          },
        },
      }),
      db.order.count({ where }),
    ]);

    const data = orders.map((o) => ({
      id: o.id,
      orderNumber: o.id.slice(-8).toUpperCase(),
      customerName: o.customerName,
      phone: o.phone,
      wilaya: o.wilaya,
      quantity: o.quantity,
      totalPrice: o.totalPrice.toNumber(),
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      productTitle: o.landingPage?.title ?? "Unknown",
      productThumbnail: o.landingPage?.media[0]?.url ?? "",
    }));

    return ok({ orders: data, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("[api/orders] GET error:", error);
    return serverError("Failed to fetch orders");
  }
}

const variantItemSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const createOrderSchema = z.object({
  landingId: z.string(),
  customerName: z.string().min(2, "Name is required"),
  phone: z.string().min(6, "Valid phone number is required"),
  wilayaId: z.number().int(),
  baladiaId: z.number().int(),
  notes: z.string().optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  variants: z.array(variantItemSchema),
  // Defaults to HOME so a cached copy of the old storefront bundle, which
  // does not send this field, keeps submitting valid orders during a deploy.
  shippingMethod: z.enum(["HOME", "DESK"]).default("HOME"),
  // Meta ad-click identifiers, read from cookies by the purchase form.
  // Optional — absent for organic/non-Meta traffic.
  fbc: z.string().optional(),
  fbp: z.string().optional(),
  // Abandoned-checkout token, if this visitor was captured while typing.
  // Lets us mark that draft converted so the CRM stops chasing the lead.
  draftToken: z.string().optional(),
});

// POST /api/orders — create a real customer order with price + variant snapshots
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const { landingId, customerName, phone, wilayaId, baladiaId, notes, quantity, variants, shippingMethod, fbc, fbp, draftToken } = parsed.data;

    // 1. Validate landing exists and is published
    const landing = await db.landingPage.findUnique({
      where: { id: landingId },
      include: {
        variants: { orderBy: { displayOrder: "asc" } },
        // Needed to check the requested shipping method is actually offered.
        setting: true,
      },
    });
    if (!landing) return fail("NOT_FOUND", "Landing page not found", 404);
    if (!landing.published || landing.status !== "PUBLISHED") {
      return fail("NOT_PUBLISHED", "This landing page is not available", 403);
    }

    // 2. Validate wilaya
    const wilaya = await db.wilaya.findUnique({ where: { id: wilayaId } });
    if (!wilaya) return fail("INVALID_WILAYA", "Invalid wilaya", 422);

    // 3. Validate baladia belongs to wilaya
    const baladia = await db.baladia.findFirst({ where: { id: baladiaId, wilayaId } });
    if (!baladia) return fail("INVALID_BALADIA", "Invalid commune for the selected wilaya", 422);

    // 4. Validate variants
    const landingVariantGroups = new Map<string, Set<string>>();
    for (const v of landing.variants) {
      if (!landingVariantGroups.has(v.name)) landingVariantGroups.set(v.name, new Set());
      landingVariantGroups.get(v.name)!.add(v.value);
    }
    for (const submitted of variants) {
      const validValues = landingVariantGroups.get(submitted.name);
      if (!validValues || !validValues.has(submitted.value)) {
        return fail("INVALID_VARIANT", `Invalid variant: ${submitted.name} = ${submitted.value}`, 422);
      }
    }

    // 5. Validate the requested shipping method is offered by this product.
    // Re-checked server-side rather than trusted from the form: the client
    // sends whichever method it rendered, and a stale page or a crafted
    // request could otherwise book a desk order at a desk price on a product
    // that only does home delivery. Absent settings mean home-only, matching
    // the schema defaults for products predating this feature.
    const homeEnabled = landing.setting?.homeDeliveryEnabled ?? true;
    const deskEnabled = landing.setting?.stopDeskEnabled ?? false;
    if (shippingMethod === "HOME" && !homeEnabled) {
      return fail("SHIPPING_UNAVAILABLE", "Home delivery is not available for this product", 422);
    }
    if (shippingMethod === "DESK" && !deskEnabled) {
      return fail("SHIPPING_UNAVAILABLE", "Stop desk is not available for this product", 422);
    }

    // 6. Look up shipping price from global delivery settings
    const deliveryPrice = await db.globalDeliveryPrice.findUnique({
      where: { wilayaId },
    });
    if (!deliveryPrice) return fail("NO_SHIPPING", "Delivery is not available for the selected wilaya", 422);

    // deskPrice is nullable — a wilaya can have home delivery configured but
    // no desk price. Falling back to homePrice would silently overcharge for
    // the cheaper method, so an unpriced desk is refused instead.
    if (shippingMethod === "DESK" && deliveryPrice.deskPrice === null) {
      return fail(
        "NO_SHIPPING",
        "Stop desk delivery is not available for the selected wilaya",
        422,
      );
    }

    // 6. Compute snapshots
    const variantExtra = variants.reduce((sum, v) => {
      const match = landing.variants.find((lv) => lv.name === v.name && lv.value === v.value);
      return sum + (match?.extraPrice.toNumber() ?? 0);
    }, 0);
    const productPrice = landing.price.toNumber() + variantExtra;
    // Priced from the method the customer actually chose. The DESK branch is
    // only reachable after the null check above, so the non-null assertion
    // here is guarded rather than assumed.
    const shippingPrice =
      shippingMethod === "DESK"
        ? deliveryPrice.deskPrice!.toNumber()
        : deliveryPrice.homePrice.toNumber();
    const totalPrice = productPrice * quantity + shippingPrice;

    // 7. Create order + initial status history entry
    // Store Arabic names as snapshots — the order never changes even if
    // the wilaya/baladia names are edited later.
    const order = await db.order.create({
      data: {
        landingPageId: landingId,
        customerName,
        phone,
        wilaya: wilaya.nameAr ?? wilaya.name,
        baladia: baladia.nameAr ?? baladia.name,
        address: "",
        notes: notes || null,
        quantity,
        variants: JSON.stringify(variants),
        productPrice,
        shippingPrice,
        totalPrice,
        shippingMethod,
        status: "NEW",
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: "NEW",
          },
        },
      },
      select: { id: true },
    });

    // Fire-and-forget: never await this on the customer-facing path. A slow
    // or failing Meta call must never delay or break a real order. Errors
    // are caught and logged inside sendPurchaseEvent itself.
    sendPurchaseEvent({
      orderId: order.id,
      customerName,
      phone,
      totalPrice,
      currency: landing.currency,
      fbc: fbc ?? null,
      fbp: fbp ?? null,
      clientIp: getClientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    // If this visitor was captured as an abandoned lead while typing, close
    // that draft out now. Awaited (unlike the webhooks) so the order.created
    // payload below can include the draft id — otherwise the CRM would have
    // no way to link the lead it was already told about to this order.
    if (draftToken) {
      try {
        await db.draftOrder.updateMany({
          where: { token: draftToken, convertedOrderId: null },
          data: { convertedOrderId: order.id, convertedAt: new Date() },
        });
      } catch (error) {
        // A failure here must not fail the order — worst case the CRM keeps
        // the lead open and someone calls a customer who already bought.
        console.error("[api/orders] failed to mark draft converted:", error);
      }
    }

    // Outgoing CRM webhook — also fire-and-forget, for the same reason.
    triggerOrderWebhook("order.created", order.id);

    return ok({ orderId: order.id }, 201);
  } catch (error) {
    console.error("[api/orders] POST error:", error);
    return serverError("Failed to create order");
  }
}

// Prefer x-forwarded-for (set by Render/Railway/any reverse proxy in front
// of this app) since req.ip is not reliably populated behind a proxy. Takes
// the first address in the list — the original client, not the proxy hops.
function getClientIp(req: NextRequest): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return null;
}
