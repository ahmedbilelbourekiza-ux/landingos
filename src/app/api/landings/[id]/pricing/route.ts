import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

const pricingSchema = z
  .object({
    price: z.coerce.number().positive("Price must be greater than 0"),
    oldPrice: z.coerce.number().positive().optional().nullable(),
    currency: z.enum(["DZD", "EUR", "USD"]),
    shipping: z.coerce.number().min(0, "Shipping cannot be negative"),
    freeShipping: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.oldPrice !== undefined && data.oldPrice !== null && data.oldPrice <= data.price) {
      ctx.addIssue({
        path: ["oldPrice"],
        code: z.ZodIssueCode.custom,
        message: "Old price must be higher than the current price",
      });
    }
  });

// PATCH /api/landings/[id]/pricing — update price, oldPrice, currency, shipping, freeShipping
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = pricingSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    const { shipping, freeShipping, ...pageFields } = parsed.data;

    await db.$transaction([
      db.landingPage.update({
        where: { id },
        data: {
          price: pageFields.price,
          oldPrice: pageFields.oldPrice ?? null,
          currency: pageFields.currency,
        },
      }),
      db.landingSetting.upsert({
        where: { landingPageId: id },
        create: { landingPageId: id, shipping, freeShipping },
        update: { shipping, freeShipping },
      }),
    ]);

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/pricing] PATCH error:", error);
    return serverError("Failed to update pricing");
  }
}
