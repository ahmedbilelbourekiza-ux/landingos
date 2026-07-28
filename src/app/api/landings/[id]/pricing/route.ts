import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { triggerProductWebhook } from "@/lib/webhooks/triggers";

const pricingSchema = z
  .object({
    price: z.coerce.number().positive("Price must be greater than 0"),
    oldPrice: z.coerce.number().positive().optional().nullable(),
    currency: z.enum(["DZD", "EUR", "USD"]),
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

// PATCH /api/landings/[id]/pricing — update price, oldPrice, currency
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

    await db.landingPage.update({
      where: { id },
      data: {
        price: parsed.data.price,
        oldPrice: parsed.data.oldPrice ?? null,
        currency: parsed.data.currency,
      },
    });

    // Price changes are the main thing the CRM cares about here.
    triggerProductWebhook("product.updated", id);

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/pricing] PATCH error:", error);
    return serverError("Failed to update pricing");
  }
}
