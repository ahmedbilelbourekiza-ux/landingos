"use client";

import { ProductGallery } from "./product-gallery";
import { ProductInfo } from "./product-info";
import type { LandingPageData } from "@/types/landing";
import type { LandingOrderStore } from "@/lib/landing/store";

// The product hero: two-column on desktop (sticky gallery left, scrolling
// product info right), stacked on mobile. This is the conversion surface —
// everything above the fold drives toward the purchase form.
export function ProductSection({
  page,
  store,
}: {
  page: LandingPageData;
  store: LandingOrderStore;
}) {
  return (
    <section
      id="product"
      className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12"
    >
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ProductGallery media={page.media} />
        </div>
        <ProductInfo page={page} store={store} />
      </div>
    </section>
  );
}
