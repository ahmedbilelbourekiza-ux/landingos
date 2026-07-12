"use client";

import * as React from "react";

import { AnnouncementBar } from "./sections/announcement-bar";
import { SiteNav } from "./sections/site-nav";
import { ProductSection } from "./sections/product-section";
import { SiteFooter } from "./sections/site-footer";
import { StickyBuyButton } from "./sections/sticky-buy-button";
import type { LandingPageData } from "@/types/landing";
import { createLandingOrderStore, type LandingOrderStore } from "@/lib/landing/store";

// The default landing-page template. Given a LandingPageData object, it wires
// up a per-page order store and renders the product section + footer. Reviews
// and FAQ are removed for the MVP — the landing page is intentionally short.
// The Reviews editor in the dashboard stays intact; it just doesn't render
// on the public page yet.
//
// The store is created once per mount via useState's lazy initializer; the
// page prop is treated as immutable for the lifetime of the route.
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
