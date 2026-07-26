import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  coverImage: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isVisible: z.boolean().optional(),
});

// PATCH /api/categories/[id] — update a category
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const cat = await db.category.findUnique({ where: { id }, select: { id: true } });
    if (!cat) return fail("NOT_FOUND", "Category not found", 404);

    if (parsed.data.slug) {
      const existing = await db.category.findFirst({
        where: { slug: parsed.data.slug, NOT: { id } },
        select: { id: true },
      });
      if (existing) return fail("SLUG_TAKEN", "Slug already taken", 409);
    }

    await db.category.update({ where: { id }, data: parsed.data });
    return ok({ id });
  } catch (error) {
    console.error("[api/categories/[id]] PATCH error:", error);
    return serverError("Failed to update category");
  }
}

// DELETE /api/categories/[id] — delete a category (landings get categoryId = null)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const cat = await db.category.findUnique({ where: { id }, select: { id: true } });
    if (!cat) return fail("NOT_FOUND", "Category not found", 404);

    await db.category.delete({ where: { id } });
    return ok({ id });
  } catch (error) {
    console.error("[api/categories/[id]] DELETE error:", error);
    return serverError("Failed to delete category");
  }
}
