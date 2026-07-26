import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

const reviewSchema = z.object({
  id: z.string().optional(),
  customerName: z.string(),
  customerAvatar: z.string().optional().nullable(),
  rating: z.number().min(1).max(5),
  reviewText: z.string(),
  displayOrder: z.number(),
});

const replaceSchema = z.object({
  reviews: z.array(reviewSchema),
});

// PUT /api/landings/[id]/reviews — replace all reviews (delete + create)
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
      db.landingReview.deleteMany({ where: { landingPageId: id } }),
      ...parsed.data.reviews.map((r) =>
        db.landingReview.create({
          data: {
            landingPageId: id,
            customerName: r.customerName,
            customerAvatar: r.customerAvatar ?? null,
            rating: r.rating,
            reviewText: r.reviewText,
            displayOrder: r.displayOrder,
          },
        }),
      ),
    ]);

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/reviews] PUT error:", error);
    return serverError("Failed to update reviews");
  }
}
