import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

// GET /api/settings/delivery-prices — all 58 wilayas with their global prices.
// Wilayas without a price entry return null for homePrice/deskPrice.
export async function GET() {
  try {
    const wilayas = await db.wilaya.findMany({
      include: {
        deliveryPrices: true,
      },
      orderBy: { code: "asc" },
    });

    const data = wilayas.map((w) => {
      const dp = w.deliveryPrices[0];
      return {
        id: w.id,
        code: w.code,
        name: w.name,
        nameAr: w.nameAr,
        homePrice: dp ? dp.homePrice.toNumber() : null,
        deskPrice: dp?.deskPrice ? dp.deskPrice.toNumber() : null,
      };
    });

    return ok(data);
  } catch (error) {
    console.error("[api/settings/delivery-prices] GET error:", error);
    return serverError("Failed to fetch delivery prices");
  }
}

const priceItemSchema = z.object({
  wilayaId: z.number().int(),
  homePrice: z.coerce.number().min(0),
  deskPrice: z.coerce.number().min(0).optional().nullable(),
});

const bulkSchema = z.object({
  prices: z.array(priceItemSchema),
});

// PUT /api/settings/delivery-prices — bulk upsert all prices in one request.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    // Upsert each price entry — create if doesn't exist, update if it does.
    await db.$transaction(
      parsed.data.prices.map((p) =>
        db.globalDeliveryPrice.upsert({
          where: { wilayaId: p.wilayaId },
          create: {
            wilayaId: p.wilayaId,
            homePrice: p.homePrice,
            deskPrice: p.deskPrice ?? null,
          },
          update: {
            homePrice: p.homePrice,
            deskPrice: p.deskPrice ?? null,
          },
        }),
      ),
    );

    return ok({ count: parsed.data.prices.length });
  } catch (error) {
    console.error("[api/settings/delivery-prices] PUT error:", error);
    return serverError("Failed to update delivery prices");
  }
}
