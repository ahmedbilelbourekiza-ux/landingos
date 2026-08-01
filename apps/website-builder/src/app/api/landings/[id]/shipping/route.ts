import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/api-response";

// Which shipping methods a product offers. Stored as two booleans on
// LandingSetting rather than a HOME/DESK/BOTH enum — see the schema comment.
const shippingSchema = z
  .object({
    homeDeliveryEnabled: z.boolean(),
    stopDeskEnabled: z.boolean(),
  })
  // A product with neither method enabled cannot be ordered at all: the
  // checkout would have no shipping price to quote and POST /api/orders would
  // reject every submission. Refusing the save surfaces that here, where the
  // admin can see it, instead of at checkout where only customers would.
  .refine((v) => v.homeDeliveryEnabled || v.stopDeskEnabled, {
    message: "At least one shipping method must be enabled",
  });

// PATCH /api/landings/[id]/shipping — update the offered shipping methods.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = shippingSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid shipping configuration",
        422,
      );
    }

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    const { homeDeliveryEnabled, stopDeskEnabled } = parsed.data;

    // Upsert because LandingSetting is optional on a landing page — a product
    // that has never had settings saved has no row yet.
    await db.landingSetting.upsert({
      where: { landingPageId: id },
      create: { landingPageId: id, homeDeliveryEnabled, stopDeskEnabled },
      update: { homeDeliveryEnabled, stopDeskEnabled },
    });

    return ok({ id, homeDeliveryEnabled, stopDeskEnabled });
  } catch (error) {
    console.error("[api/landings/[id]/shipping] PATCH error:", error);
    return serverError("Failed to update shipping methods");
  }
}
