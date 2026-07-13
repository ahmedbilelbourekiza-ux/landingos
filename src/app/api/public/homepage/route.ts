import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";

// GET /api/public/homepage — returns:
// 1. All visible categories (for the grid, even if empty)
// 2. Categories with published products (for the grouped sections)
// 3. 8 newest published products across all categories
// All in two Prisma queries — no N+1.
export async function GET() {
  try {
    const [categories, newestProducts] = await Promise.all([
      db.category.findMany({
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
      }),
      db.landingPage.findMany({
        where: { published: true, status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          slug: true,
          price: true,
          oldPrice: true,
          currency: true,
          media: { take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
          category: { select: { name: true } },
        },
      }),
    ]);

    // All visible categories for the grid (with product count)
    const allCategories = categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon: c.icon,
      coverImage: c.coverImage,
      productCount: c.landingPages.length,
    }));

    // Only categories with products for the grouped sections
    const categoriesWithProducts = categories
      .filter((c) => c.landingPages.length > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        icon: c.icon,
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

    const newest = newestProducts.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      price: p.price.toNumber(),
      oldPrice: p.oldPrice?.toNumber() ?? null,
      currency: p.currency,
      heroImage: p.media[0]?.url ?? null,
      categoryName: p.category?.name ?? null,
    }));

    return ok({ allCategories, categoriesWithProducts, newest });
  } catch (error) {
    console.error("[api/public/homepage] GET error:", error);
    return serverError("Failed to fetch homepage data");
  }
}
