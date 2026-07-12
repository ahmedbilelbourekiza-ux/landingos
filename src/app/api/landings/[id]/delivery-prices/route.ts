import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

// GET /api/landings/[id]/delivery-prices — list delivery prices for a landing,
// joined with the wilaya data so the client can render the full table.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    const prices = await db.landingDeliveryPrice.findMany({
      where: { landingPageId: id },
      include: { wilaya: { select: { code: true, name: true, nameAr: true } } },
      orderBy: { wilaya: { code: "asc" } },
    });

    const data = prices.map((p) => ({
      id: p.id,
      wilayaId: p.wilayaId,
      wilayaCode: p.wilaya.code,
      wilayaName: p.wilaya.name,
      wilayaNameAr: p.wilaya.nameAr,
      homePrice: p.homePrice.toNumber(),
      deskPrice: p.deskPrice?.toNumber() ?? null,
    }));

    return ok(data);
  } catch (error) {
    console.error("[api/landings/[id]/delivery-prices] GET error:", error);
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

// PUT /api/landings/[id]/delivery-prices — bulk replace delivery prices.
// Deletes existing prices and creates new ones. Simpler than diffing.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    await db.$transaction([
      db.landingDeliveryPrice.deleteMany({ where: { landingPageId: id } }),
      ...parsed.data.prices.map((p) =>
        db.landingDeliveryPrice.create({
          data: {
            landingPageId: id,
            wilayaId: p.wilayaId,
            homePrice: p.homePrice,
            deskPrice: p.deskPrice ?? null,
          },
        }),
      ),
    ]);

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/delivery-prices] PUT error:", error);
    return serverError("Failed to update delivery prices");
  }
}
