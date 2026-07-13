import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

// GET /api/categories — list all categories with product count
export async function GET() {
  try {
    const categories = await db.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        _count: {
          select: { landingPages: { where: { published: true, status: "PUBLISHED" } } },
        },
      },
    });

    const data = categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      icon: c.icon,
      coverImage: c.coverImage,
      sortOrder: c.sortOrder,
      isVisible: c.isVisible,
      productCount: c._count.landingPages,
    }));

    return ok(data);
  } catch (error) {
    console.error("[api/categories] GET error:", error);
    return serverError("Failed to fetch categories");
  }
}

const createSchema = z.object({
  name: z.string().min(2, "Name is required"),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  description: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  coverImage: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
  isVisible: z.boolean().default(true),
});

// POST /api/categories — create a new category
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const existing = await db.category.findUnique({
      where: { slug: parsed.data.slug },
      select: { id: true },
    });
    if (existing) return fail("SLUG_TAKEN", "Slug already taken", 409);

    const category = await db.category.create({
      data: parsed.data,
      select: { id: true },
    });

    return ok({ id: category.id }, 201);
  } catch (error) {
    console.error("[api/categories] POST error:", error);
    return serverError("Failed to create category");
  }
}
