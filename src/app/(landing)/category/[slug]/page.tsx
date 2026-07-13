import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Package } from "lucide-react";

import { db } from "@/lib/db";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
import { arabicProductCount } from "@/lib/landing/arabic";
import { Logo } from "@/components/shared/logo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cat = await db.category.findUnique({
    where: { slug },
    select: { name: true, description: true },
  });
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
          sortOption === "price-asc"
            ? { price: "asc" }
            : sortOption === "price-desc"
              ? { price: "desc" }
              : { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          price: true,
          oldPrice: true,
          currency: true,
          createdAt: true,
          media: { take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
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
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground" dir="rtl">
            العودة للرئيسية
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {/* Category header */}
          <div className="mb-6 text-center" dir="rtl">
            <h1 className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight">
              <span>{category.icon || "📦"}</span>
              {category.name}
            </h1>
            {category.description && (
              <p className="mt-2 text-muted-foreground">{category.description}</p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {arabicProductCount(products.length)}
            </p>
          </div>

          {/* Sorting */}
          {products.length > 0 && (
            <div className="mb-6 flex items-center justify-center gap-2" dir="rtl">
              <span className="text-sm text-muted-foreground">ترتيب حسب:</span>
              <div className="flex items-center gap-1">
                {sortOptions.map((opt) => (
                  <Link
                    key={opt.value}
                    href={`/category/${slug}?sort=${opt.value}`}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      sortOption === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "border hover:bg-accent"
                    }`}
                  >
                    {opt.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Product grid */}
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <span className="grid size-16 place-items-center rounded-2xl border bg-muted/40 text-muted-foreground">
                <Package className="size-7" strokeWidth={1.5} />
              </span>
              <p className="text-sm text-muted-foreground" dir="rtl">
                لا توجد منتجات في هذه الفئة بعد.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => {
                const price = product.price.toNumber();
                const oldPrice = product.oldPrice?.toNumber() ?? null;
                const off = discountPercentage(price, oldPrice);
                const heroImage = product.media[0]?.url ?? null;

                return (
                  <Link
                    key={product.id}
                    href={`/l/${product.slug}`}
                    className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md"
                  >
                    <div className="relative aspect-square bg-muted">
                      {heroImage ? (
                        <Image
                          src={heroImage}
                          alt={product.title}
                          fill
                          sizes="(max-width: 768px) 50vw, 25vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-muted-foreground/40">
                          <Package className="size-8" strokeWidth={1.5} />
                        </div>
                      )}
                      {off && (
                        <span
                          className="absolute right-2 top-2 rounded-lg px-2 py-0.5 text-xs font-bold text-white"
                          style={{ backgroundColor: "var(--gold)" }}
                        >
                          −{off}%
                        </span>
                      )}
                    </div>
                    <div className="p-3" dir="rtl">
                      <p className="mb-0.5 truncate text-xs text-muted-foreground">
                        {category.name}
                      </p>
                      <h3 className="truncate text-sm font-medium">{product.title}</h3>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-base font-bold text-primary">
                          {formatPrice(price, product.currency)}
                        </span>
                        {oldPrice && (
                          <span className="text-xs text-muted-foreground line-through">
                            {formatPrice(oldPrice, product.currency)}
                          </span>
                        )}
                      </div>
                      <span className="mt-2 block rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-semibold text-primary-foreground">
                        عرض المنتج
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-8 sm:px-6">
          <Logo />
        </div>
      </footer>
    </div>
  );
}
