"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Search, Package, X, ShoppingBag, TrendingUp, Tag, Check } from "lucide-react";

import { formatPrice, discountPercentage } from "@/lib/landing/format";
import { arabicProductCount } from "@/lib/landing/arabic";
import { Logo } from "@/components/shared/logo";

export interface ProductCardData {
  id: string;
  title: string;
  slug: string;
  price: number;
  oldPrice: number | null;
  currency: string;
  heroImage: string | null;
  categoryName?: string | null;
  orderCount?: number;
  createdAt?: string;
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
  featuredOffers: ProductCardData[];
  bestSellers: ProductCardData[];
  stats: { totalCategories: number; totalProducts: number };
}

export default function HomePage() {
  const [data, setData] = React.useState<HomepageData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/public/homepage")
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data); })
      .finally(() => setLoading(false));
  }, []);

  const allProducts = React.useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const products: ProductCardData[] = [];
    for (const p of data.newest) { if (!seen.has(p.id)) { seen.add(p.id); products.push({ ...p, categoryName: p.categoryName ?? null }); } }
    for (const cat of data.categoriesWithProducts) {
      for (const p of (cat.products ?? [])) { if (!seen.has(p.id)) { seen.add(p.id); products.push({ ...p, categoryName: cat.name }); } }
    }
    return products;
  }, [data]);

  const searchResults = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return allProducts.filter((p) => p.title.toLowerCase().includes(q) || (p.categoryName ?? "").toLowerCase().includes(q));
  }, [search, allProducts]);

  const handleShare = (slug: string) => {
    const url = `${window.location.origin}/l/${slug}`;
    navigator.clipboard?.writeText(url);
    setToast("تم نسخ الرابط");
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن منتج..." dir="rtl"
              className="h-9 w-full rounded-lg border border-input bg-muted/40 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="مسح">
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
            <Package className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">لا توجد منتجات متاحة حالياً.</p>
          </div>
        ) : searchResults ? (
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            <h1 className="mb-6 text-xl font-bold" dir="rtl">
              {searchResults.length > 0 ? `نتائج البحث (${searchResults.length})` : "لا توجد نتائج"}
            </h1>
            {searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <Search className="size-7 text-muted-foreground" />
                <p className="text-sm text-muted-foreground" dir="rtl">لم نجد أي منتج يطابق بحثك. جرب كلمة أخرى.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {searchResults.map((p) => <ProductCard key={p.id} product={p} onShare={handleShare} />)}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Hero */}
            <section className="relative overflow-hidden border-b bg-muted/20">
              <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-20">
                <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                  className="text-3xl font-bold tracking-tight sm:text-5xl" dir="rtl">
                  اكتشف أفضل المنتجات المختارة بعناية
                </motion.h1>
                <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}
                  className="mt-3 text-base text-muted-foreground sm:text-lg" dir="rtl">
                  الدفع عند الاستلام · توصيل سريع · جودة مضمونة
                </motion.p>
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}
                  className="mt-6">
                  <button
                    onClick={() => document.getElementById("categories")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-bold text-primary-foreground shadow-lg transition-all hover:shadow-xl"
                  >
                    <ShoppingBag className="ml-2 size-4" />
                    ابدأ التسوق
                  </button>
                </motion.div>
              </div>
            </section>

            <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
              {/* Stats */}
              <div className="mb-8 flex items-center justify-center gap-8" dir="rtl">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{data.stats.totalCategories}</p>
                  <p className="text-sm text-muted-foreground">فئة</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{data.stats.totalProducts}</p>
                  <p className="text-sm text-muted-foreground">منتج</p>
                </div>
              </div>

              {/* Featured Offers */}
              {data.featuredOffers.length > 0 && (
                <section className="mb-10">
                  <h2 className="mb-4 flex items-center gap-2 text-xl font-bold" dir="rtl">
                    <Tag className="size-5 text-primary" />
                    العروض المميزة
                  </h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.featuredOffers.map((p) => <ProductCard key={p.id} product={p} onShare={handleShare} />)}
                  </div>
                </section>
              )}

              {/* Best Sellers */}
              {data.bestSellers.length > 0 && (
                <section className="mb-10">
                  <h2 className="mb-4 flex items-center gap-2 text-xl font-bold" dir="rtl">
                    <TrendingUp className="size-5 text-primary" />
                    الأكثر طلباً
                  </h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.bestSellers.map((p) => <ProductCard key={p.id} product={p} onShare={handleShare} />)}
                  </div>
                </section>
              )}

              {/* Categories Grid */}
              {data.allCategories.length > 0 && (
                <section id="categories" className="mb-10 scroll-mt-20">
                  <h2 className="mb-4 text-xl font-bold" dir="rtl">الفئات</h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.allCategories.map((cat) => (
                      <Link key={cat.id} href={`/category/${cat.slug}`}
                        className="group relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md">
                        <div className="relative aspect-[4/3] bg-muted">
                          {cat.coverImage ? (
                            <Image src={cat.coverImage} alt={cat.name} fill sizes="(max-width: 768px) 50vw, 25vw"
                              className="object-cover transition-transform duration-300 group-hover:scale-105" />
                          ) : (
                            <div className="grid h-full place-items-center text-4xl">{cat.icon || "📦"}</div>
                          )}
                        </div>
                        <div className="p-3" dir="rtl">
                          <h3 className="truncate text-sm font-semibold">{cat.name}</h3>
                          <p className="text-xs text-muted-foreground">{arabicProductCount(cat.productCount)}</p>
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
                    {data.newest.map((p) => <ProductCard key={p.id} product={p} onShare={handleShare} />)}
                  </div>
                </section>
              )}

              {/* Products by Category */}
              {data.categoriesWithProducts.map((cat) => (
                <motion.section key={cat.id}
                  initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.35, ease: "easeOut" }}
                  className="mb-10">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-xl font-bold">
                      <span>{cat.icon || "📦"}</span>{cat.name}
                    </h2>
                    <Link href={`/category/${cat.slug}`} className="text-sm text-muted-foreground hover:text-foreground" dir="rtl">عرض الكل</Link>
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {(cat.products ?? []).map((p) => <ProductCard key={p.id} product={{ ...p, categoryName: cat.name }} onShare={handleShare} />)}
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg" dir="rtl">
          <span className="flex items-center gap-2">
            <Check className="size-4" />
            {toast}
          </span>
        </div>
      )}
    </div>
  );
}

function getBadge(product: ProductCardData): { label: string; color: string } | null {
  const off = discountPercentage(product.price, product.oldPrice);
  if (off) return { label: `خصم ${off}%`, color: "var(--gold)" };
  if ((product.orderCount ?? 0) > 0) return { label: "الأكثر طلباً", color: "var(--crimson, #991B1B)" };
  return null; // "جديد" badge is implied by being in the newest section
}

function ProductCard({ product, onShare }: { product: ProductCardData; onShare: (slug: string) => void }) {
  const off = discountPercentage(product.price, product.oldPrice);
  const badge = getBadge(product);

  return (
    <div className="group relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md">
      <Link href={`/l/${product.slug}`} className="block">
        <div className="relative aspect-square bg-muted">
          {product.heroImage ? (
            <Image src={product.heroImage} alt={product.title} fill sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground/40">
              <Package className="size-8" strokeWidth={1.5} />
            </div>
          )}
          {badge && (
            <span className="absolute right-2 top-2 rounded-lg px-2 py-0.5 text-xs font-bold text-white shadow-sm" style={{ backgroundColor: badge.color }}>
              {badge.label}
            </span>
          )}
        </div>
        <div className="p-3" dir="rtl">
          {product.categoryName && <p className="mb-0.5 truncate text-xs text-muted-foreground">{product.categoryName}</p>}
          <h3 className="truncate text-sm font-medium">{product.title}</h3>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-base font-bold text-primary">{formatPrice(product.price, product.currency)}</span>
            {product.oldPrice && <span className="text-xs text-muted-foreground line-through">{formatPrice(product.oldPrice, product.currency)}</span>}
          </div>
          <span className="mt-2 block rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-semibold text-primary-foreground">
            عرض المنتج
          </span>
        </div>
      </Link>
      {/* Share button */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShare(product.slug); }}
        className="absolute bottom-[4.5rem] left-2 grid size-8 place-items-center rounded-full bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-all hover:text-foreground group-hover:opacity-100"
        aria-label="مشاركة"
      >
        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </button>
    </div>
  );
}
