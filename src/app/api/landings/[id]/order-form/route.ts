import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/api-response";

// The order form config is stored as JSON string on LandingSetting.
// The shape matches OrderFormConfig minus buttonText (which lives on
// LandingPage.buttonText).
const fieldSchema = z.object({
  visible: z.boolean(),
  required: z.boolean(),
  label: z.string(),
  placeholder: z.string(),
});

const fieldKeySchema = z.enum([
  "customerName",
  "phone",
  "wilaya",
  "baladia",
  "address",
  "notes",
  "quantity",
]);

const orderFormSchema = z.object({
  customerName: fieldSchema,
  phone: fieldSchema,
  wilaya: fieldSchema,
  baladia: fieldSchema,
  address: fieldSchema,
  notes: fieldSchema,
  quantity: fieldSchema,
  // Render order, top to bottom. Optional so a client that has not been
  // updated can still save a config; readers repair a missing or partial
  // order via normalizeOrder(). Not validated for completeness here for the
  // same reason — the reader is the single place that guarantees the
  // invariant, rather than duplicating it on the write path.
  order: z.array(fieldKeySchema).optional(),
  buttonText: z.string(),
});

// PATCH /api/landings/[id]/order-form — update order form config + button text
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = orderFormSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid order form config", 422);
    }

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    const { buttonText, ...fields } = parsed.data;

    await db.$transaction([
      db.landingPage.update({
        where: { id },
        data: { buttonText },
      }),
      db.landingSetting.upsert({
        where: { landingPageId: id },
        create: { landingPageId: id, orderFormConfig: JSON.stringify(fields) },
        update: { orderFormConfig: JSON.stringify(fields) },
      }),
    ]);

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/order-form] PATCH error:", error);
    return serverError("Failed to update order form");
  }
}
