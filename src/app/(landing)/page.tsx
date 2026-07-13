"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowLeft, Package } from "lucide-react";

import { formatPrice, discountPercentage } from "@/lib/landing/format";
import { Logo } from "@/components/shared/logo";

interface ProductCard {
  id: string;
  title: string;
  slug: string;
  price: number;
  oldPrice: number | null;
  currency: string;
  heroImage: string | null;
}

interface CategorySection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  coverImage: string | null;
  products: ProductCard[];
}

export default function HomePage() {
  const [categories, setCategories] = React.useState<CategorySection[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/public/homepage")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCategories(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <span className="grid size-16 place-items-center rounded-2xl border bg-muted/40 text-muted-foreground">
              <Package className="size-7" strokeWidth={1.5} />
            </span>
            <h1 className="text-xl font-semibold">No products available yet.</h1>
            <p className="text-sm text-muted-foreground">Check back soon!</p>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            {/* Hero */}
            <div className="mb-8 text-center sm:mb-12">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                متجرنا
              </h1>
              <p className="mt-2 text-muted-foreground" dir="rtl">
                تصفح أحدث المنتجات بأسعار خاصة
              </p>
            </div>

            {/* Categories Grid */}
            <div className="mb-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {categories.map((cat) => (
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
                  <div className="p-3">
                    <h3 className="truncate text-sm font-semibold">{cat.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {cat.products.length} منتج
                    </p>
                  </div>
                </Link>
              ))}
            </div>

            {/* Products by Category */}
            {categories.map((cat) => (
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
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    dir="rtl"
                  >
                    عرض الكل
                    <ArrowLeft className="size-3.5" />
                  </Link>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {cat.products.map((product) => (
                    <ProductCardLink key={product.id} product={product} />
                  ))}
                </div>
              </motion.section>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-4 px-4 py-8 text-center sm:px-6">
          <Logo />
        </div>
      </footer>
    </div>
  );
}

function ProductCardLink({ product }: { product: ProductCard }) {
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
            className="object-cover transition-transform group-hover:scale-105"
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
