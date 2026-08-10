"use client";

import * as React from "react";

import { AnnouncementBar } from "./sections/announcement-bar";
import { SiteNav } from "./sections/site-nav";
import { ProductSection } from "./sections/product-section";
import { DescriptionImages } from "./sections/description-images";
import { ReviewsSection } from "./sections/reviews-section";
import { FAQSection } from "./sections/faq-section";
import { SiteFooter } from "./sections/site-footer";
import { StickyBuyButton } from "./sections/sticky-buy-button";
import { ThemeProvider } from "./theme-provider";
import type { LandingPageData } from "@/types/landing";
import type { LandingThemeData } from "@/types/theme";
import { DEFAULT_THEME } from "@/types/theme";
import { createLandingOrderStore, type LandingOrderStore } from "@/lib/landing/store";

// The default landing-page template. Accepts a page + optional theme.
// Wraps everything in ThemeProvider which injects CSS variables. All child
// components consume theme tokens via var(--theme-primary) etc.
export function LandingTemplate({
  page,
  theme = DEFAULT_THEME,
}: {
  page: LandingPageData;
  theme?: LandingThemeData;
}) {
  const [store] = React.useState<LandingOrderStore>(() =>
    createLandingOrderStore(page),
  );
  const setting = page.setting;

  return (
    <ThemeProvider theme={theme}>
      <AnnouncementBar />
      <SiteNav />
      <main className="flex-1">
        <ProductSection page={page} store={store} />
        <DescriptionImages images={page.descriptionImages} />
        {/* LB.12 — these two sections existed since the port and were mounted
            by NOTHING: a merchant's saved reviews travelled to the browser in
            the data payload and rendered nowhere. Both render null on empty
            data; `show*` (default true when no setting row exists) is the
            merchant's off switch. */}
        {(setting?.showReviews ?? true) && <ReviewsSection reviews={page.reviews} />}
        {(setting?.showFAQ ?? true) && <FAQSection faqs={page.faqs} />}
      </main>
      <SiteFooter />
      {setting?.stickyBuyButton && (
        <StickyBuyButton
          store={store}
          buttonText={page.buttonText}
          currency={page.currency}
        />
      )}
    </ThemeProvider>
  );
}
