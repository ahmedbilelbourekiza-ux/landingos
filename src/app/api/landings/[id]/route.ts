import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

// GET /api/landings/[id] — single landing with all relations
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const page = await db.landingPage.findUnique({
      where: { id },
      include: {
        media: { orderBy: { displayOrder: "asc" } },
        variants: { orderBy: { displayOrder: "asc" } },
        reviews: { orderBy: { displayOrder: "asc" } },
        setting: true,
      },
    });

    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    return ok(page);
  } catch (error) {
    console.error("[api/landings/[id]] GET error:", error);
    return serverError("Failed to fetch landing page");
  }
}

const updateSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().max(300).optional().nullable(),
  ctaButtonText: z.string().optional().nullable(),
  announcement: z.string().optional().nullable(),
  price: z.coerce.number().positive().optional(),
  oldPrice: z.coerce.number().positive().optional().nullable(),
  currency: z.enum(["DZD", "EUR", "USD"]).optional(),
  shipping: z.coerce.number().min(0).optional(),
  freeShipping: z.boolean().optional(),
});

// PATCH /api/landings/[id] — update general + pricing fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    // Check slug uniqueness if slug is being updated
    if (parsed.data.slug) {
      const existing = await db.landingPage.findFirst({
        where: { slug: parsed.data.slug, NOT: { id } },
        select: { id: true },
      });
      if (existing) return fail("SLUG_TAKEN", "This slug is already taken", 409);
    }

    // Split into page fields vs setting fields
    const { shipping, freeShipping, ...pageFields } = parsed.data;

    await db.$transaction([
      db.landingPage.update({
        where: { id },
        data: {
          ...pageFields,
          oldPrice: pageFields.oldPrice === null ? null : pageFields.oldPrice,
          description: pageFields.description === null ? null : pageFields.description,
        },
      }),
      (shipping !== undefined || freeShipping !== undefined) &&
        db.landingSetting.upsert({
          where: { landingPageId: id },
          create: { landingPageId: id, shipping: shipping ?? 0, freeShipping: freeShipping ?? false },
          update: { ...(shipping !== undefined && { shipping }), ...(freeShipping !== undefined && { freeShipping }) },
        }),
    ].filter(Boolean));

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]] PATCH error:", error);
    return serverError("Failed to update landing page");
  }
}

// DELETE /api/landings/[id] — delete landing (cascade deletes children)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    await db.landingPage.delete({ where: { id } });
    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]] DELETE error:", error);
    return serverError("Failed to delete landing page");
  }
}
