import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";

// GET /api/public/homepage — returns all storefront data in 3 efficient
// Prisma queries (no N+1):
// 1. Categories with published products
// 2. 8 newest published products
// 3. Top 8 best-selling products (by order count) + discounted products
export async function GET() {
  try {
    const [categories, newestProducts, allPublished] = await Promise.all([
      db.category.findMany({
        where: { isVisible: true },
        orderBy: { sortOrder: "asc" },
        include: {
          landingPages: {
            where: { published: true, status: "PUBLISHED" },
            orderBy: { createdAt: "desc" },
            select: {
              id: true, title: true, slug: true, price: true, oldPrice: true,
              currency: true,
              media: { where: { placement: "GALLERY" }, take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
            },
          },
        },
      }),
      db.landingPage.findMany({
        where: { published: true, status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true, title: true, slug: true, price: true, oldPrice: true,
          currency: true, createdAt: true,
          media: { where: { placement: "GALLERY" }, take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
          category: { select: { name: true } },
        },
      }),
      db.landingPage.findMany({
        where: { published: true, status: "PUBLISHED" },
        select: {
          id: true, title: true, slug: true, price: true, oldPrice: true,
          currency: true, createdAt: true,
          media: { where: { placement: "GALLERY" }, take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
          category: { select: { name: true } },
          _count: { select: { orders: true } },
        },
      }),
    ]);

    const mapProduct = (p: typeof allPublished[number]) => ({
      id: p.id, title: p.title, slug: p.slug,
      price: p.price.toNumber(),
      oldPrice: p.oldPrice?.toNumber() ?? null,
      currency: p.currency,
      heroImage: p.media[0]?.url ?? null,
      categoryName: p.category?.name ?? null,
      orderCount: "_count" in p ? p._count.orders : 0,
      createdAt: p.createdAt.toISOString(),
    });

    const allCategories = categories.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, icon: c.icon,
      coverImage: c.coverImage, productCount: c.landingPages.length,
    }));

    const categoriesWithProducts = categories
      .filter((c) => c.landingPages.length > 0)
      .map((c) => ({
        id: c.id, name: c.name, slug: c.slug, description: c.description, icon: c.icon,
        products: c.landingPages.map((p) => ({
          id: p.id, title: p.title, slug: p.slug,
          price: p.price.toNumber(),
          oldPrice: p.oldPrice?.toNumber() ?? null,
          currency: p.currency,
          heroImage: p.media[0]?.url ?? null,
        })),
      }));

    const newest = newestProducts.map(mapProduct);

    // Featured offers: products with oldPrice > price
    const featuredOffers = allPublished
      .filter((p) => {
        const price = p.price.toNumber();
        const old = p.oldPrice?.toNumber();
        return old !== null && old !== undefined && old > price;
      })
      .slice(0, 8)
      .map(mapProduct);

    // Best sellers: sort by order count desc, take top 8, only those with orders
    const bestSellers = [...allPublished]
      .sort((a, b) => b._count.orders - a._count.orders)
      .filter((p) => p._count.orders > 0)
      .slice(0, 8)
      .map(mapProduct);

    // Stats
    const totalProducts = allPublished.length;
    const totalCategories = categories.filter((c) => c.landingPages.length > 0).length;

    return ok({
      allCategories,
      categoriesWithProducts,
      newest,
      featuredOffers,
      bestSellers,
      stats: { totalCategories, totalProducts },
    });
  } catch (error) {
    console.error("[api/public/homepage] GET error:", error);
    return serverError("Failed to fetch homepage data");
  }
}
