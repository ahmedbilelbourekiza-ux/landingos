// Landing-page view models. These intentionally mirror the Task 2 Prisma
// models (LandingPage + children), with one pragmatic adaptation: money is
// `number` here because the UI renders and computes with numbers, while
// Prisma stores `Decimal`. The conversion happens at the future data-fetch
// boundary (Decimal → Number), so swapping mock data for a real row is a
// type-only change in the loader — no component rewrite.

export type LandingMediaType = "IMAGE" | "VIDEO";
export type LandingPageStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface LandingMediaData {
  id: string;
  type: LandingMediaType;
  url: string;
  altText: string | null;
  displayOrder: number;
}

export interface LandingVariantData {
  id: string;
  name: string;
  value: string;
  extraPrice: number;
  displayOrder: number;
}

export interface LandingFeatureData {
  id: string;
  icon: string;
  title: string;
  description: string | null;
  displayOrder: number;
}

export interface LandingReviewData {
  id: string;
  customerName: string;
  customerAvatar: string | null;
  rating: number;
  reviewText: string;
  displayOrder: number;
}

export interface LandingFAQData {
  id: string;
  question: string;
  answer: string;
  displayOrder: number;
}

export interface LandingSettingData {
  countdownEnabled: boolean;
  stickyBuyButton: boolean;
  floatingWhatsapp: boolean;
  showReviews: boolean;
  showFAQ: boolean;
  showFeatures: boolean;
}

export interface LandingPageData {
  id: string;
  title: string;
  slug: string;
  status: LandingPageStatus;
  description: string | null;
  price: number;
  oldPrice: number | null;
  currency: string;
  buttonText: string;
  seoTitle: string | null;
  seoDescription: string | null;
  facebookPixel: string | null;
  webhookUrl: string | null;
  published: boolean;
  media: LandingMediaData[];
  variants: LandingVariantData[];
  features: LandingFeatureData[];
  reviews: LandingReviewData[];
  faqs: LandingFAQData[];
  setting: LandingSettingData | null;
}

// Variants are stored flat (one row per option value) to match Prisma, but
// the UI renders one selector per option group (e.g. all "Size" values
// together). This grouped shape is derived at the view layer.
export interface VariantGroup {
  name: string;
  options: {
    id: string;
    value: string;
    extraPrice: number;
  }[];
}
