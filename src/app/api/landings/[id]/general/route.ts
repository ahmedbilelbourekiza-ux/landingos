import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

const generalSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(120),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  description: z.string().max(300).optional().nullable(),
  ctaButtonText: z.string().optional().nullable(),
  announcement: z.string().optional().nullable(),
  categoryId: z.string().nullable().optional(),
});

// PATCH /api/landings/[id]/general — update title, slug, description, CTA, announcement
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = generalSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    // Slug uniqueness check — excludes the current landing
    const slugConflict = await db.landingPage.findFirst({
      where: { slug: parsed.data.slug, NOT: { id } },
      select: { id: true },
    });
    if (slugConflict) return fail("SLUG_TAKEN", "This slug is already taken", 409);

    await db.landingPage.update({
      where: { id },
      data: {
        title: parsed.data.title,
        slug: parsed.data.slug,
        description: parsed.data.description || null,
        ctaButtonText: parsed.data.ctaButtonText || null,
        announcement: parsed.data.announcement || null,
        categoryId: parsed.data.categoryId || null,
      },
    });

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/general] PATCH error:", error);
    return serverError("Failed to update general fields");
  }
}
