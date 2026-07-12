"use client";

import { ProductGallery } from "./product-gallery";
import { ProductInfo } from "./product-info";
import type { LandingPageData } from "@/types/landing";
import type { LandingOrderStore } from "@/lib/landing/store";

// The product hero: two-column on desktop (sticky gallery left, scrolling
// product info right), stacked on mobile. Improved spacing and shadow for
// a cleaner, more premium COD feel.
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
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10"
    >
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ProductGallery media={page.media} />
        </div>
        <ProductInfo page={page} store={store} />
      </div>
    </section>
  );
}
