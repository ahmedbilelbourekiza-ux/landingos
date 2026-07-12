"use client";

import * as React from "react";

import { AnnouncementBar } from "./sections/announcement-bar";
import { SiteNav } from "./sections/site-nav";
import { ProductSection } from "./sections/product-section";
import { ReviewsSection } from "./sections/reviews-section";
import { FAQSection } from "./sections/faq-section";
import { SiteFooter } from "./sections/site-footer";
import { StickyBuyButton } from "./sections/sticky-buy-button";
import type { LandingPageData } from "@/types/landing";
import { createLandingOrderStore, type LandingOrderStore } from "@/lib/landing/store";

// The default landing-page template. Given a LandingPageData object, it wires
// up a per-page order store and renders every section, honoring the settings
// flags (showReviews, showFAQ, stickyBuyButton). This is the single render
// target for future landing pages: swap the mock data for a Prisma row and
// the same component tree renders the real page.
//
// The store is created once per mount via useState's lazy initializer; the
// page prop is treated as immutable for the lifetime of the route (each
// landing page lives at its own URL, so the data never hot-swaps).
export function LandingTemplate({ page }: { page: LandingPageData }) {
  const [store] = React.useState<LandingOrderStore>(() =>
    createLandingOrderStore(page),
  );
  const setting = page.setting;

  return (
    <div className="flex min-h-screen flex-col">
      <AnnouncementBar />
      <SiteNav />
      <main className="flex-1">
        <ProductSection page={page} store={store} />
        {setting?.showReviews && <ReviewsSection reviews={page.reviews} />}
        {setting?.showFAQ && <FAQSection faqs={page.faqs} />}
      </main>
      <SiteFooter />
      {setting?.stickyBuyButton && (
        <StickyBuyButton
          store={store}
          buttonText={page.buttonText}
          currency={page.currency}
        />
      )}
    </div>
  );
}
