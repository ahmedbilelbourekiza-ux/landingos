import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Package, Check } from "lucide-react";

import { db } from "@/lib/db";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
import { arabicProductCount } from "@/lib/landing/arabic";
import { Logo } from "@/components/shared/logo";
import { CategoryProductGrid } from "@/components/landing/category-product-grid";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cat = await db.category.findUnique({ where: { slug }, select: { name: true, description: true } });
  if (!cat) return { title: "غير موجود" };
  return { title: cat.name, description: cat.description ?? "" };
}

type SortOption = "newest" | "price-asc" | "price-desc";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { slug } = await params;
  const { sort } = await searchParams;
  const sortOption = (sort as SortOption) || "newest";

  const category = await db.category.findUnique({
    where: { slug, isVisible: true },
    include: {
      landingPages: {
        where: { published: true, status: "PUBLISHED" },
        orderBy:
          sortOption === "price-asc" ? { price: "asc" }
          : sortOption === "price-desc" ? { price: "desc" }
          : { createdAt: "desc" },
        select: {
          id: true, title: true, slug: true, price: true, oldPrice: true,
          currency: true, createdAt: true,
          media: { take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
          _count: { select: { orders: true } },
        },
      },
    },
  });

  if (!category) notFound();

  const products = category.landingPages;
  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "newest", label: "الأحدث" },
    { value: "price-asc", label: "السعر من الأقل للأعلى" },
    { value: "price-desc", label: "السعر من الأعلى للأقل" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground" dir="rtl">العودة للرئيسية</Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Category header with cover image */}
        <div className="relative h-40 overflow-hidden bg-muted sm:h-56">
          {category.coverImage ? (
            <Image src={category.coverImage} alt={category.name} fill priority
              sizes="100vw" className="object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-6xl opacity-30">{category.icon || "📦"}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 text-center sm:p-6" dir="rtl">
            <h1 className="flex items-center justify-center gap-2 text-2xl font-bold text-white sm:text-3xl">
              <span>{category.icon || "📦"}</span>
              {category.name}
            </h1>
            {category.description && <p className="mt-1 text-sm text-white/80">{category.description}</p>}
            <p className="mt-1 text-xs text-white/60">{arabicProductCount(products.length)}</p>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {/* Sorting */}
          {products.length > 0 && (
            <div className="mb-6 flex items-center justify-center gap-2" dir="rtl">
              <span className="text-sm text-muted-foreground">ترتيب حسب:</span>
              <div className="flex items-center gap-1">
                {sortOptions.map((opt) => (
                  <Link key={opt.value} href={`/category/${slug}?sort=${opt.value}`}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      sortOption === opt.value ? "bg-primary text-primary-foreground" : "border hover:bg-accent"
                    }`}>
                    {opt.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Product grid */}
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <Package className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" dir="rtl">لا توجد منتجات في هذه الفئة بعد.</p>
            </div>
          ) : (
            <CategoryProductGrid
              products={products.map((p) => ({
                id: p.id, title: p.title, slug: p.slug,
                price: p.price.toNumber(), oldPrice: p.oldPrice?.toNumber() ?? null,
                currency: p.currency, heroImage: p.media[0]?.url ?? null,
                categoryName: category.name, orderCount: p._count.orders,
              }))}
            />
          )}
        </div>
      </main>

      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-8 sm:px-6"><Logo /></div>
      </footer>
    </div>
  );
}
