import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

const variantSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  value: z.string(),
  extraPrice: z.coerce.number().min(0),
  displayOrder: z.number(),
});

const replaceSchema = z.object({
  variants: z.array(variantSchema),
});

// PUT /api/landings/[id]/variants — replace all variants (delete + create)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = replaceSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    await db.$transaction([
      db.landingVariant.deleteMany({ where: { landingPageId: id } }),
      ...parsed.data.variants.map((v) =>
        db.landingVariant.create({
          data: {
            landingPageId: id,
            name: v.name,
            value: v.value,
            extraPrice: v.extraPrice,
            displayOrder: v.displayOrder,
          },
        }),
      ),
    ]);

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/variants] PUT error:", error);
    return serverError("Failed to update variants");
  }
}
