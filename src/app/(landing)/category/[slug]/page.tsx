import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Package } from "lucide-react";

import { db } from "@/lib/db";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
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
  if (!cat) return { title: "Not Found" };
  return { title: cat.name, description: cat.description ?? "" };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const category = await db.category.findUnique({
    where: { slug, isVisible: true },
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

  if (!category) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-background">
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
          <div className="mb-8 text-center" dir="rtl">
            <h1 className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight">
              <span>{category.icon || "📦"}</span>
              {category.name}
            </h1>
            {category.description && (
              <p className="mt-2 text-muted-foreground">{category.description}</p>
            )}
          </div>

          {/* Product grid */}
          {category.landingPages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <span className="grid size-16 place-items-center rounded-2xl border bg-muted/40 text-muted-foreground">
                <Package className="size-7" strokeWidth={1.5} />
              </span>
              <p className="text-sm text-muted-foreground">لا توجد منتجات في هذه الفئة بعد.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {category.landingPages.map((product) => {
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

      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-4 px-4 py-8 text-center sm:px-6">
          <Logo />
        </div>
      </footer>
    </div>
  );
}
