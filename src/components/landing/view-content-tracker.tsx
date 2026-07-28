"use client";

import * as React from "react";

import { trackViewContent } from "./meta-pixel-loader";

// Fires a single Meta Pixel ViewContent event for a product page.
//
// Deliberately rendered only from the real public product route
// (/l/[slug]), NOT from LandingTemplate itself — the admin preview screen
// reuses that same template, and previewing your own page should not look
// like customer product views in Meta's reporting.
//
// If no browser pixel is configured, trackViewContent() is a harmless no-op.
export function ViewContentTracker({
  productId,
  productName,
  price,
  currency,
}: {
  productId: string;
  productName: string;
  price: number;
  currency: string;
}) {
  React.useEffect(() => {
    trackViewContent({
      content_ids: [productId],
      content_name: productName,
      value: price,
      currency,
    });
  }, [productId, productName, price, currency]);

  return null;
}
