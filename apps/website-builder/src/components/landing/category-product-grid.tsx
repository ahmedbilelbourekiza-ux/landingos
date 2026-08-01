"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Package, Check } from "lucide-react";

import { formatPrice, discountPercentage } from "@/lib/landing/format";

export interface CategoryProduct {
  id: string;
  title: string;
  slug: string;
  price: number;
  oldPrice: number | null;
  currency: string;
  heroImage: string | null;
  categoryName: string;
  orderCount: number;
}

function getBadge(product: CategoryProduct): { label: string; color: string } | null {
  const off = discountPercentage(product.price, product.oldPrice);
  if (off) return { label: `خصم ${off}%`, color: "var(--gold)" };
  if (product.orderCount > 0) return { label: "الأكثر طلباً", color: "#991B1B" };
  return null;
}

export function CategoryProductGrid({ products }: { products: CategoryProduct[] }) {
  const [toast, setToast] = React.useState<string | null>(null);

  const handleShare = (slug: string) => {
    navigator.clipboard?.writeText(`${window.location.origin}/l/${slug}`);
    setToast("تم نسخ الرابط");
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => {
          const badge = getBadge(product);
          return (
            <div key={product.id} className="group relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md">
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
                  <p className="mb-0.5 truncate text-xs text-muted-foreground">{product.categoryName}</p>
                  <h3 className="truncate text-sm font-medium">{product.title}</h3>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-base font-bold text-primary">{formatPrice(product.price, product.currency)}</span>
                    {product.oldPrice && <span className="text-xs text-muted-foreground line-through">{formatPrice(product.oldPrice, product.currency)}</span>}
                  </div>
                  <span className="mt-2 block rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-semibold text-primary-foreground">عرض المنتج</span>
                </div>
              </Link>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleShare(product.slug); }}
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
        })}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg" dir="rtl">
          <span className="flex items-center gap-2"><Check className="size-4" />{toast}</span>
        </div>
      )}
    </>
  );
}
