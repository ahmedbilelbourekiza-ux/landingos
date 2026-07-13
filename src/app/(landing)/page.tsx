"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Search, Package, X } from "lucide-react";

import { formatPrice, discountPercentage } from "@/lib/landing/format";
import { arabicProductCount } from "@/lib/landing/arabic";
import { Logo } from "@/components/shared/logo";

interface ProductCardData {
  id: string;
  title: string;
  slug: string;
  price: number;
  oldPrice: number | null;
  currency: string;
  heroImage: string | null;
  categoryName?: string | null;
}

interface CategoryData {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  coverImage: string | null;
  productCount: number;
  description?: string | null;
  products?: ProductCardData[];
}

interface HomepageData {
  allCategories: CategoryData[];
  categoriesWithProducts: CategoryData[];
  newest: ProductCardData[];
}

export default function HomePage() {
  const [data, setData] = React.useState<HomepageData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    fetch("/api/public/homepage")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  // Build a flat product list for search
  const allProducts = React.useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const products: (ProductCardData & { categoryName: string | null })[] = [];
    for (const p of data.newest) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        products.push({ ...p, categoryName: p.categoryName ?? null });
      }
    }
    for (const cat of data.categoriesWithProducts) {
      for (const p of (cat.products ?? [])) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          products.push({ ...p, categoryName: cat.name });
        }
      }
    }
    return products;
  }, [data]);

  // Search results
  const searchResults = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return allProducts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.categoryName ?? "").toLowerCase().includes(q),
    );
  }, [search, allProducts]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن منتج..."
              className="h-9 w-full rounded-lg border border-input bg-muted/40 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              dir="rtl"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="مسح البحث"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <span className="grid size-16 place-items-center rounded-2xl border bg-muted/40 text-muted-foreground">
              <Package className="size-7" strokeWidth={1.5} />
            </span>
            <p className="text-sm text-muted-foreground">لا توجد منتجات متاحة حالياً.</p>
          </div>
        ) : searchResults ? (
          /* Search results */
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            <h1 className="mb-6 text-xl font-bold" dir="rtl">
              {searchResults.length > 0
                ? `نتائج البحث (${searchResults.length})`
                : "لا توجد نتائج"}
            </h1>
            {searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <span className="grid size-16 place-items-center rounded-2xl border bg-muted/40 text-muted-foreground">
                  <Search className="size-7" strokeWidth={1.5} />
                </span>
                <p className="text-sm text-muted-foreground" dir="rtl">
                  لم نجد أي منتج يطابق بحثك. جرب كلمة أخرى.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {searchResults.map((p) => (
                  <ProductCard key={p.id} product={p} categoryName={p.categoryName ?? null} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Hero */}
            <section className="border-b bg-muted/20">
              <div className="mx-auto max-w-6xl px-4 py-12 text-center sm:px-6 sm:py-16">
                <motion.h1
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="text-3xl font-bold tracking-tight sm:text-5xl"
                >
                  متجرنا
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  className="mt-3 text-base text-muted-foreground sm:text-lg"
                  dir="rtl"
                >
                  تصفح أحدث المنتجات بأسعار خاصة · الدفع عند الاستلام · توصيل سريع
                </motion.p>
              </div>
            </section>

            <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
              {/* Categories Grid */}
              {data.allCategories.length > 0 && (
                <section className="mb-10">
                  <h2 className="mb-4 text-xl font-bold" dir="rtl">الفئات</h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.allCategories.map((cat) => (
                      <Link
                        key={cat.id}
                        href={`/category/${cat.slug}`}
                        className="group relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md"
                      >
                        <div className="relative aspect-[4/3] bg-muted">
                          {cat.coverImage ? (
                            <Image
                              src={cat.coverImage}
                              alt={cat.name}
                              fill
                              sizes="(max-width: 768px) 50vw, 25vw"
                              className="object-cover transition-transform group-hover:scale-105"
                            />
                          ) : (
                            <div className="grid h-full place-items-center text-4xl">
                              {cat.icon || "📦"}
                            </div>
                          )}
                        </div>
                        <div className="p-3" dir="rtl">
                          <h3 className="truncate text-sm font-semibold">{cat.name}</h3>
                          <p className="text-xs text-muted-foreground">
                            {arabicProductCount(cat.productCount)}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Newest Products */}
              {data.newest.length > 0 && (
                <section className="mb-10">
                  <h2 className="mb-4 text-xl font-bold" dir="rtl">أحدث المنتجات</h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.newest.map((p) => (
                      <ProductCard key={p.id} product={p} categoryName={p.categoryName ?? null} />
                    ))}
                  </div>
                </section>
              )}

              {/* Products by Category */}
              {data.categoriesWithProducts.map((cat) => (
                <motion.section
                  key={cat.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="mb-10"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-xl font-bold">
                      <span>{cat.icon || "📦"}</span>
                      {cat.name}
                    </h2>
                    <Link
                      href={`/category/${cat.slug}`}
                      className="text-sm text-muted-foreground hover:text-foreground"
                      dir="rtl"
                    >
                      عرض الكل
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {(cat.products ?? []).map((p) => (
                      <ProductCard key={p.id} product={p} categoryName={cat.name} />
                    ))}
                  </div>
                </motion.section>
              ))}
            </div>
          </>
        )}
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

function ProductCard({
  product,
  categoryName,
}: {
  product: ProductCardData;
  categoryName: string | null;
}) {
  const off = discountPercentage(product.price, product.oldPrice);
  return (
    <Link
      href={`/l/${product.slug}`}
      className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md"
    >
      <div className="relative aspect-square bg-muted">
        {product.heroImage ? (
          <Image
            src={product.heroImage}
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
        {categoryName && (
          <p className="mb-0.5 truncate text-xs text-muted-foreground">{categoryName}</p>
        )}
        <h3 className="truncate text-sm font-medium">{product.title}</h3>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-base font-bold text-primary">
            {formatPrice(product.price, product.currency)}
          </span>
          {product.oldPrice && (
            <span className="text-xs text-muted-foreground line-through">
              {formatPrice(product.oldPrice, product.currency)}
            </span>
          )}
        </div>
        <span className="mt-2 block rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-semibold text-primary-foreground">
          عرض المنتج
        </span>
      </div>
    </Link>
  );
}
