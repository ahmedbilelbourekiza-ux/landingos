// Landing-page view models. These intentionally mirror the Task 2 Prisma
// models (LandingPage + children), with one pragmatic adaptation: money is
// `number` here because the UI renders and computes with numbers, while
// Prisma stores `Decimal`. The conversion happens at the future data-fetch
// boundary (Decimal → Number), so swapping mock data for a real row is a
// type-only change in the loader — no component rewrite.

import type { OrderFormConfig } from "@/lib/landing/mock-order-form";

export type LandingMediaType = "IMAGE" | "VIDEO";
export type LandingPageStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
// Where an image renders: the top slider, or inline below the description.
export type LandingMediaPlacement = "GALLERY" | "DESCRIPTION";
// Home delivery to the customer's address, or pickup at the carrier's desk.
export type ShippingMethod = "HOME" | "DESK";

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
  // Shipping methods this product offers. The checkout only shows the enabled
  // ones; if just one is enabled there is nothing to choose and the selector
  // is skipped entirely.
  homeDeliveryEnabled: boolean;
  stopDeskEnabled: boolean;
}

/* The tenant's public identity — CAPABILITY_AUDIT B4. The storefront chrome
 * (nav, footer, floating WhatsApp, favicon) renders THIS, not the platform's
 * brand: a customer on a tenant's page is in that tenant's shop. Null fields
 * simply don't render; a null store falls back to the platform mark (a page
 * served before the tenant ever opened Settings → Store). */
export interface StorefrontStoreData {
  name: string | null;
  description: string | null;
  logo: string | null;
  facebook: string | null;
  instagram: string | null;
  tiktok: string | null;
  whatsapp: string | null;
  telegram: string | null;
  /** The tenant's own storefront root ("/acme") — the brand link's target. */
  homePath: string;
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
  // Slider images only. Description images are deliberately a separate field
  // rather than a filter applied by each consumer — `media` keeps meaning
  // exactly what it did, so nothing that reads it needed to change.
  media: LandingMediaData[];
  // Long-form images rendered below the description, in saved order.
  descriptionImages: LandingMediaData[];
  variants: LandingVariantData[];
  features: LandingFeatureData[];
  reviews: LandingReviewData[];
  faqs: LandingFAQData[];
  setting: LandingSettingData | null;
  // Field order, labels, and visibility for the checkout form. The storefront
  // previously hardcoded all of this; it now renders from here so the admin's
  // arrangement is what customers actually see.
  orderForm: OrderFormConfig;
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
