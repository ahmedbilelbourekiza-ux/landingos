import type { PreviewState } from "@/types/preview";
import type { LandingPageData } from "@/types/landing";
import { mockLandingPage } from "@/lib/landing/mock-data";

// Maps the edit workspace's PreviewState to the LandingPageData shape that
// the public LandingTemplate expects. Fields not yet editable (features,
// faqs, seo, setting flags) fall back to the Task 3 mock data — they'll be
// wired in as their sections are built.
//
// The buttonText comes from the Order Form section (which controls the
// purchase button), not the General section (which controls the mini
// preview's CTA button — a concept that doesn't exist in the real template).
export function previewToLandingPage(preview: PreviewState): LandingPageData {
  const { general, pricing, images, variants, reviews, orderForm } = preview;

  // Media: hero first (displayOrder 0), then gallery images.
  const media = [
    ...(images.heroUrl
      ? [
          {
            id: "hero",
            type: "IMAGE" as const,
            url: images.heroUrl,
            altText: "Product hero",
            displayOrder: 0,
          },
        ]
      : []),
    ...images.galleryUrls.map((url, i) => ({
      id: `gallery-${i}`,
      type: "IMAGE" as const,
      url,
      altText: `Gallery image ${i + 1}`,
      displayOrder: i + 1,
    })),
  ];

  // Variants: flatten groups to the flat shape the template expects.
  const flatVariants = variants.groups.flatMap((group, gi) =>
    group.options.map((opt, oi) => ({
      id: opt.id,
      name: group.name,
      value: opt.label,
      extraPrice: opt.extraPrice,
      displayOrder: gi * 100 + oi,
    })),
  );

  // Reviews: map to the template's review shape.
  const flatReviews = reviews.reviews.map((r, i) => ({
    id: r.id,
    customerName: r.customerName,
    customerAvatar: r.avatarUrl,
    rating: r.rating,
    reviewText: r.reviewText,
    displayOrder: i,
  }));

  return {
    ...mockLandingPage, // fallback for id, slug, seo, features, faqs, setting
    title: general.title || "Untitled",
    description: general.description,
    price: pricing.price,
    oldPrice: pricing.oldPrice,
    currency: pricing.currency,
    buttonText: orderForm.config.buttonText,
    published: true,
    status: "PUBLISHED",
    media,
    variants: flatVariants,
    reviews: flatReviews,
  };
}
