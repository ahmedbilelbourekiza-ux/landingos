import type { PreviewState } from "@/types/preview";
import type { LandingPageData } from "@/types/landing";

// Maps the edit workspace's PreviewState to the LandingPageData shape that
// the public LandingTemplate expects. Used by the Preview Drawer only — the
// public route /l/[slug] renders from Prisma via toLandingPageData().
// Fields not yet editable (features, faqs, seo, setting) use empty defaults
// rather than mock data — no mock fallback anywhere.
export function previewToLandingPage(preview: PreviewState): LandingPageData {
  const { general, pricing, images, variants, reviews, orderForm } = preview;

  const media = [
    ...(images.heroUrl
      ? [{ id: "hero", type: "IMAGE" as const, url: images.heroUrl, altText: "Product hero", displayOrder: 0 }]
      : []),
    ...images.galleryUrls.map((url, i) => ({
      id: `gallery-${i}`, type: "IMAGE" as const, url, altText: `Gallery image ${i + 1}`, displayOrder: i + 1,
    })),
  ];

  const flatVariants = variants.groups.flatMap((group, gi) =>
    group.options.map((opt, oi) => ({
      id: opt.id, name: group.name, value: opt.label, extraPrice: opt.extraPrice, displayOrder: gi * 100 + oi,
    })),
  );

  const flatReviews = reviews.reviews.map((r, i) => ({
    id: r.id, customerName: r.customerName, customerAvatar: r.avatarUrl,
    rating: r.rating, reviewText: r.reviewText, displayOrder: i,
  }));

  return {
    id: "preview",
    title: general.title || "Untitled",
    slug: "preview",
    status: "PUBLISHED",
    description: general.description,
    price: pricing.price,
    oldPrice: pricing.oldPrice,
    currency: pricing.currency,
    buttonText: orderForm.config.buttonText,
    seoTitle: null,
    seoDescription: null,
    facebookPixel: null,
    webhookUrl: null,
    published: true,
    media,
    // Preview state stores these as plain URLs; the public shape wants full
    // media records, so synthesise ids and ordering from the list position.
    descriptionImages: preview.descriptionImages.urls.map((url, i) => ({
      id: `preview-desc-${i}`,
      type: "IMAGE" as const,
      url,
      altText: null,
      displayOrder: i,
    })),
    variants: flatVariants,
    features: [],
    reviews: flatReviews,
    faqs: [],
    setting: {
      countdownEnabled: false,
      stickyBuyButton: true,
      floatingWhatsapp: false,
      showReviews: false,
      showFAQ: false,
      showFeatures: true,
      homeDeliveryEnabled: preview.shipping.homeDeliveryEnabled,
      stopDeskEnabled: preview.shipping.stopDeskEnabled,
    },
    orderForm: orderForm.config,
  };
}
