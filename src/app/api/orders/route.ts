import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

// GET /api/orders — paginated list with search, filter, sort.
// Query params: page (default 1), limit (default 20), search, status, sort
// (newest | oldest). Joins LandingPage for product thumbnail + title.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20)));
    const search = searchParams.get("search")?.trim() ?? "";
    const status = searchParams.get("status") ?? "ALL";
    const sort = searchParams.get("sort") ?? "newest";

    const where = {
      ...(status !== "ALL" && { status: status as never }),
      ...(search && {
        OR: [
          { id: { contains: search } },
          { customerName: { contains: search } },
          { phone: { contains: search } },
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
              media: { take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
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
  address: z.string().min(5, "Address is required"),
  notes: z.string().optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  variants: z.array(variantItemSchema),
});

// POST /api/orders — create a real customer order with price + variant snapshots
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const { landingId, customerName, phone, wilayaId, baladiaId, address, notes, quantity, variants } = parsed.data;

    // 1. Validate landing exists and is published
    const landing = await db.landingPage.findUnique({
      where: { id: landingId },
      include: { variants: { orderBy: { displayOrder: "asc" } } },
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

    // 5. Look up shipping price
    const deliveryPrice = await db.landingDeliveryPrice.findUnique({
      where: { landingPageId_wilayaId: { landingPageId: landingId, wilayaId } },
    });
    if (!deliveryPrice) return fail("NO_SHIPPING", "Delivery is not available for the selected wilaya", 422);

    // 6. Compute snapshots
    const variantExtra = variants.reduce((sum, v) => {
      const match = landing.variants.find((lv) => lv.name === v.name && lv.value === v.value);
      return sum + (match?.extraPrice.toNumber() ?? 0);
    }, 0);
    const productPrice = landing.price.toNumber() + variantExtra;
    const shippingPrice = deliveryPrice.homePrice.toNumber();
    const totalPrice = productPrice * quantity + shippingPrice;

    // 7. Create order + initial status history entry
    const order = await db.order.create({
      data: {
        landingPageId: landingId,
        customerName,
        phone,
        wilaya: wilaya.name,
        baladia: baladia.name,
        address,
        notes: notes || null,
        quantity,
        variants: JSON.stringify(variants),
        productPrice,
        shippingPrice,
        totalPrice,
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

    return ok({ orderId: order.id }, 201);
  } catch (error) {
    console.error("[api/orders] POST error:", error);
    return serverError("Failed to create order");
  }
}
