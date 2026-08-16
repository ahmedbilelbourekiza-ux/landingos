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
import { FloatingWhatsapp } from "./sections/floating-whatsapp";
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
  store = null,
}: {
  page: LandingPageData;
  theme?: LandingThemeData;
  /** The tenant's public identity (B4) — nav brand, footer, socials and the
   *  floating WhatsApp number all come from here, supplied by the storefront
   *  page's query. The template reads no settings itself. Null (the editor
   *  preview, a tenant with no settings row) falls back to the platform
   *  mark and renders no store-dependent chrome. */
  store?: import("@/types/landing").StorefrontStoreData | null;
}) {
  // `orderStore` — the client-side order state, renamed from `store` when the
  // tenant-identity prop of that name arrived (B4). Two stores, two words.
  const [orderStore] = React.useState<LandingOrderStore>(() =>
    createLandingOrderStore(page),
  );
  const setting = page.setting;

  return (
    <ThemeProvider theme={theme}>
      {/* LB.49 — NO animation library in the storefront, and that is a
          measured decision. framer-motion was tried in both LazyMotion forms
          on the way out: async features left `m` components inert (reviews
          at opacity 0, FAQ exits wedged, the sticky bar absent), and every
          failure mode held CONTENT hostage. The sections' animations are CSS
          on keyed/conditional mounts now — their end state is always
          visible, and ~40KB gz of runtime left the customer's phone. */}
      <AnnouncementBar />
      <SiteNav store={store} />
      <main className="flex-1">
        <ProductSection page={page} store={orderStore} />
        <DescriptionImages images={page.descriptionImages} />
        {/* LB.12 — these two sections existed since the port and were mounted
            by NOTHING: a merchant's saved reviews travelled to the browser in
            the data payload and rendered nowhere. Both render null on empty
            data; `show*` (default true when no setting row exists) is the
            merchant's off switch. */}
        {(setting?.showReviews ?? true) && <ReviewsSection reviews={page.reviews} />}
        {(setting?.showFAQ ?? true) && <FAQSection faqs={page.faqs} />}
      </main>
      <SiteFooter store={store} />
      {setting?.stickyBuyButton && (
        <StickyBuyButton
          store={orderStore}
          buttonText={page.buttonText}
          currency={page.currency}
        />
      )}
      {setting?.floatingWhatsapp && store?.whatsapp && (
        <FloatingWhatsapp number={store.whatsapp} />
      )}
    </ThemeProvider>
  );
}
