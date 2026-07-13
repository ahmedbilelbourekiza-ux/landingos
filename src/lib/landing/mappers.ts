import type { LandingPage, LandingMedia, LandingVariant, LandingReview, LandingSetting } from "@prisma/client";
import type { PreviewState } from "@/types/preview";
import type { LandingListItem } from "@/lib/landing/mock-landings";
import type { VariantGroup } from "@/lib/landing/mock-landings";
import type { LandingPageData } from "@/types/landing";
import type { OrderFormConfig } from "@/lib/landing/mock-order-form";
import { defaultOrderFormConfig } from "@/lib/landing/mock-order-form";
import type { LandingTheme } from "@prisma/client";
import type { LandingThemeData } from "@/types/theme";
import { DEFAULT_THEME } from "@/types/theme";

type LandingWithRelations = LandingPage & {
  media: LandingMedia[];
  variants: LandingVariant[];
  reviews: LandingReview[];
  setting: LandingSetting | null;
  theme: LandingTheme | null;
};

// Convert a Prisma LandingTheme to the client LandingThemeData shape.
export function toThemeData(theme: LandingTheme | null): LandingThemeData {
  if (!theme) return DEFAULT_THEME;
  const isLuxury = theme.id === "theme-luxury-crimson";
  const isTech = theme.id === "theme-modern-tech";
  return {
    id: theme.id,
    name: theme.name,
    primary: theme.primary,
    primaryForeground: theme.primaryForeground,
    accent: theme.accent,
    background: theme.background,
    card: theme.card,
    text: theme.text,
    muted: theme.muted,
    border: theme.border,
    cardRadius: isLuxury ? "1rem" : isTech ? "0.5rem" : "0.875rem",
    buttonRadius: isLuxury ? "0.75rem" : isTech ? "0.375rem" : "0.625rem",
    inputRadius: isLuxury ? "0.5rem" : isTech ? "0.25rem" : "0.5rem",
    cardShadow: isLuxury
      ? "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)"
      : isTech
        ? "0 1px 2px rgba(0,0,0,0.08)"
        : "0 2px 8px rgba(0,0,0,0.06)",
    badgeRadius: isLuxury ? "0.5rem" : isTech ? "0.25rem" : "0.375rem",
  };
}

// Convert a Prisma landing page (with relations) to a LandingListItem for
// the CMS table view.
export function toListItem(page: LandingPage & { media: { url: string }[] }): LandingListItem {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    price: page.price.toNumber(),
    currency: page.currency,
    status: page.status,
    thumbnailUrl: page.media[0]?.url ?? "",
    updatedAt: page.updatedAt.toISOString(),
  };
}

// Group flat variants by name, preserving order. Same logic as the mock
// groupVariants function but operating on Prisma rows.
function groupVariants(variants: LandingVariant[]): VariantGroup[] {
  const groups: VariantGroup[] = [];
  for (const v of variants) {
    let group = groups.find((g) => g.name === v.name);
    if (!group) {
      group = { name: v.name, options: [] };
      groups.push(group);
    }
    group.options.push({
      id: v.id,
      value: v.value,
      extraPrice: v.extraPrice.toNumber(),
    });
  }
  return groups;
}

// Parse the order form config JSON from LandingSetting, merging with
// defaults so missing fields don't crash the UI.
function parseOrderFormConfig(
  setting: LandingSetting | null,
  buttonText: string,
): OrderFormConfig {
  if (!setting?.orderFormConfig) {
    return { ...defaultOrderFormConfig, buttonText };
  }
  try {
    const stored = JSON.parse(setting.orderFormConfig) as Partial<OrderFormConfig>;
    // Force address to not visible — the field is no longer collected.
    const merged = { ...defaultOrderFormConfig, ...stored, buttonText };
    merged.address.visible = false;
    merged.address.required = false;
    return merged;
  } catch {
    return { ...defaultOrderFormConfig, buttonText };
  }
}

// Convert a Prisma landing page (with all relations) to the PreviewState
// shape that EditWorkspace uses as initial state.
export function toPreviewState(page: LandingWithRelations): PreviewState {
  const hero = page.media[0];
  const gallery = page.media.slice(1);

  return {
    general: {
      title: page.title,
      description: page.description ?? "",
      buttonText: page.ctaButtonText ?? page.buttonText,
      announcement: page.announcement ?? "",
      categoryId: page.categoryId,
      themeId: page.themeId,
    },
    pricing: {
      price: page.price.toNumber(),
      oldPrice: page.oldPrice?.toNumber() ?? null,
      currency: page.currency,
    },
    images: {
      heroUrl: hero?.url ?? null,
      galleryUrls: gallery.map((m) => m.url),
    },
    variants: {
      groups: groupVariants(page.variants),
    },
    reviews: {
      reviews: page.reviews.map((r, i) => ({
        id: r.id,
        customerName: r.customerName,
        rating: r.rating,
        reviewText: r.reviewText,
        avatarUrl: r.customerAvatar,
      })),
    },
    orderForm: {
      config: parseOrderFormConfig(page.setting, page.buttonText),
    },
  };
}

// Convert a Prisma landing page to the LandingPageData shape for the public
// LandingTemplate.
export function toLandingPageData(page: LandingWithRelations): LandingPageData {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    status: page.status,
    description: page.description,
    price: page.price.toNumber(),
    oldPrice: page.oldPrice?.toNumber() ?? null,
    currency: page.currency,
    buttonText: page.buttonText,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    facebookPixel: page.facebookPixel,
    webhookUrl: page.webhookUrl,
    published: page.published,
    media: page.media.map((m) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      altText: m.altText,
      displayOrder: m.displayOrder,
    })),
    variants: page.variants.map((v) => ({
      id: v.id,
      name: v.name,
      value: v.value,
      extraPrice: v.extraPrice.toNumber(),
      displayOrder: v.displayOrder,
    })),
    features: [],
    reviews: page.reviews.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerAvatar: r.customerAvatar,
      rating: r.rating,
      reviewText: r.reviewText,
      displayOrder: r.displayOrder,
    })),
    faqs: [],
    setting: page.setting
      ? {
          countdownEnabled: page.setting.countdownEnabled,
          stickyBuyButton: page.setting.stickyBuyButton,
          floatingWhatsapp: page.setting.floatingWhatsapp,
          showReviews: page.setting.showReviews,
          showFAQ: page.setting.showFAQ,
          showFeatures: page.setting.showFeatures,
        }
      : null,
  };
}
