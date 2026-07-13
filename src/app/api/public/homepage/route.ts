import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";

// GET /api/public/homepage — returns visible categories with their published
// products, plus all published products without a category. Used by the
// public homepage to render product sections grouped by category.
export async function GET() {
  try {
    // Fetch visible categories ordered by sortOrder
    const categories = await db.category.findMany({
      where: { isVisible: true },
      orderBy: { sortOrder: "asc" },
      include: {
        landingPages: {
          where: { published: true, status: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            oldPrice: true,
            currency: true,
            media: { take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
          },
        },
      },
    });

    const data = categories
      .filter((c) => c.landingPages.length > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        icon: c.icon,
        coverImage: c.coverImage,
        products: c.landingPages.map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          price: p.price.toNumber(),
          oldPrice: p.oldPrice?.toNumber() ?? null,
          currency: p.currency,
          heroImage: p.media[0]?.url ?? null,
        })),
      }));

    return ok(data);
  } catch (error) {
    console.error("[api/public/homepage] GET error:", error);
    return serverError("Failed to fetch homepage data");
  }
}
