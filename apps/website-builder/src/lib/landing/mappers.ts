import type { LandingPage, LandingMedia, LandingVariant, LandingReview, LandingFeature, LandingFAQ, LandingSetting } from "@/generated/prisma";
import type { PreviewState } from "@/types/preview";
import type { LandingListItem } from "@/lib/landing/mock-landings";
import type { VariantGroup } from "@/lib/landing/mock-landings";
import { axesFromLandingVariants, offeredAxes } from "@/lib/erp/variant-axes";
import type { LandingPageData } from "@/types/landing";
import type { OrderFormConfig } from "@/lib/landing/mock-order-form";
import { defaultOrderFormConfig, normalizeOrder, ALL_FIELD_KEYS } from "@/lib/landing/mock-order-form";
import type { LandingTheme } from "@/generated/prisma";
import type { LandingThemeData } from "@/types/theme";
import { DEFAULT_THEME } from "@/types/theme";

type LandingWithRelations = LandingPage & {
  media: LandingMedia[];
  variants: LandingVariant[];
  reviews: LandingReview[];
  features: LandingFeature[];
  faqs: LandingFAQ[];
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
//
// The editor's vocabulary (VariantOption) calls the option text `label`; the
// DB column is `value`. The rename happens HERE and nowhere else — emitting
// `value` from this function is how every saved variant loaded into the
// editor with a blank label and rendered as "—" in the preview, while the
// save path was blocked by its own "every option needs a label" validation.
function groupVariants(variants: LandingVariant[]): VariantGroup[] {
  const groups: VariantGroup[] = [];
  for (const v of variants) {
    let group = groups.find((g) => g.name === v.name);
    if (!group) {
      // Anchored to the first row's id: stable across renders, unique per
      // group — `key={group.id}` in the preview was `undefined` for every
      // group before this.
      group = { id: `grp-${v.id}`, name: v.name, options: [] };
      groups.push(group);
    }
    group.options.push({
      id: v.id,
      label: v.value,
      extraPrice: v.extraPrice.toNumber(),
      price: v.price?.toNumber() ?? null,
    });
  }
  return groups;
}

// Parse the order form config JSON from LandingSetting, merging with
// defaults so missing fields don't crash the UI.
//
// The stored value is admin-authored JSON that may predate any given field,
// so every path here has to survive a partial or stale object — including
// invalid JSON, which is why the whole thing is wrapped rather than trusted.
export function parseOrderFormConfig(
  setting: LandingSetting | null,
  buttonText: string,
): OrderFormConfig {
  const fallback: OrderFormConfig = {
    ...defaultOrderFormConfig,
    order: normalizeOrder(defaultOrderFormConfig.order),
    buttonText,
  };
  if (!setting?.orderFormConfig) return fallback;

  try {
    // A Prisma Json column comes back as the VALUE, not a string — calling
    // JSON.parse on it throws and every stored config silently fell back to
    // the defaults (B-07). Strings are still parsed, because rows written by
    // the pre-platform app stored the config as a serialized string.
    const raw = setting.orderFormConfig;
    const stored = (
      typeof raw === "string" ? JSON.parse(raw) : raw
    ) as Partial<OrderFormConfig>;
    if (!stored || typeof stored !== "object") return fallback;
    // Per-FIELD merge, not a top-level spread: a stored field holding only a
    // label must inherit `visible`/`required` from the default rather than
    // replace the whole object and render the field invisible.
    const merged: OrderFormConfig = {
      ...defaultOrderFormConfig,
      order: normalizeOrder(stored.order),
      buttonText,
    };
    for (const key of ALL_FIELD_KEYS) {
      const storedField = stored[key];
      if (storedField && typeof storedField === "object") {
        merged[key] = { ...defaultOrderFormConfig[key], ...storedField };
      }
    }
    // Address is forced off regardless of what is stored: POST /api/orders
    // neither accepts nor persists one (Order.address is written as ""), so
    // rendering the input would collect something the customer types and the
    // system then discards. It stays in FIELD_DEFS so the ordering UI keeps
    // working if the field is wired up later.
    merged.address = { ...merged.address, visible: false, required: false };
    return merged;
  } catch {
    return fallback;
  }
}

// Gallery images only — the top slider, with [0] as the hero.
function galleryMedia(media: LandingMedia[]): LandingMedia[] {
  return media.filter((m) => m.placement === "GALLERY");
}

// Long-form images rendered below the description.
function descriptionMedia(media: LandingMedia[]): LandingMedia[] {
  return media.filter((m) => m.placement === "DESCRIPTION");
}

function toMediaData(m: LandingMedia) {
  return {
    id: m.id,
    type: m.type,
    url: m.url,
    altText: m.altText,
    displayOrder: m.displayOrder,
  };
}

// Convert a Prisma landing page (with all relations) to the PreviewState
// shape that EditWorkspace uses as initial state.
export function toPreviewState(page: LandingWithRelations): PreviewState {
  // Slider images only. Taking media[0] unfiltered would let a description
  // image become the hero purely by sorting first.
  const slider = galleryMedia(page.media);
  const hero = slider[0];
  const gallery = slider.slice(1);

  return {
    general: {
      title: page.title,
      description: page.description ?? "",
      buttonText: page.ctaButtonText ?? page.buttonText,
      announcement: page.announcement ?? "",
      categoryId: page.categoryId,
      themeId: page.themeId,
      brandId: (page as any).brandId ?? null,
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
    benefits: {
      benefits: page.features.map((f) => ({
        id: f.id,
        icon: f.icon,
        title: f.title,
        description: f.description,
      })),
    },
    faq: {
      faqs: page.faqs.map((f) => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
      })),
    },
    orderForm: {
      config: parseOrderFormConfig(page.setting, page.buttonText),
    },
    descriptionImages: {
      urls: descriptionMedia(page.media).map((m) => m.url),
    },
    shipping: {
      homeDeliveryEnabled: page.setting?.homeDeliveryEnabled ?? true,
      stopDeskEnabled: page.setting?.stopDeskEnabled ?? false,
      freeShipping: page.setting?.freeShipping ?? false,
    },
    display: {
      stickyBuyButton: page.setting?.stickyBuyButton ?? true,
      floatingWhatsapp: page.setting?.floatingWhatsapp ?? false,
      showReviews: page.setting?.showReviews ?? true,
      showFAQ: page.setting?.showFAQ ?? true,
      showFeatures: page.setting?.showFeatures ?? true,
      // BH.1 — opt-in, so the absent-row default is OFF, unlike the show*
      // toggles whose absence means "shown".
      behaviorTracking: page.setting?.behaviorTracking ?? false,
      inventoryEnforcement: (page.setting as { inventoryEnforcement?: boolean } | null)?.inventoryEnforcement ?? false,
    },
  };
}

// Convert a Prisma landing page to the LandingPageData shape for the public
// LandingTemplate.
/* -----------------------------------------------------------------------------
 * VAR.1 (fuller scope) — the rows the storefront actually offers
 * -------------------------------------------------------------------------- */

/**
 * The page's variant rows, filtered and extended by the Manager's matrix.
 *
 * Returns the page's own rows untouched when there is no matrix to consult —
 * an unlinked page, or the editor preview — which is every page that has never
 * been sent to the Manager.
 *
 * A value the manager ADDED has no `LandingVariant` row, so one is synthesised
 * with a stable id derived from the axis and value. It carries `extraPrice: 0`
 * deliberately: an adjustment is a decision the merchant makes on the page,
 * and inventing one here would put a number on a customer's bill that nobody
 * chose. The checkout prices from the tenant's OWN rows and ignores ids it
 * does not know, so a synthesised id contributes nothing to the price — which
 * is precisely the correct behaviour for a value with no adjustment.
 */
function offeredVariantRows(
  rows: readonly LandingVariant[],
  levels: import("../erp/variant-axes").VariantLevels | null,
): { id: string; name: string; value: string; extraPrice: number; price: number | null; displayOrder: number }[] {
  const own = rows.map((v) => ({
    id: v.id,
    name: v.name,
    value: v.value,
    extraPrice: v.extraPrice.toNumber(),
    price: v.price?.toNumber() ?? null,
    displayOrder: v.displayOrder,
  }));
  if (!levels?.axes?.length) return own;

  const pageAxes = axesFromLandingVariants(
    rows.map((v) => ({ name: v.name, value: v.value, displayOrder: v.displayOrder })),
  );
  const offered = offeredAxes(pageAxes, levels);

  const fold = (v: string) => v.trim().toLowerCase();
  const byPair = new Map(own.map((r) => [`${fold(r.name)}::${fold(r.value)}`, r]));

  const out: typeof own = [];
  let order = 0;
  for (const axis of offered) {
    for (const value of axis.values) {
      const existing = byPair.get(`${fold(axis.name)}::${fold(value)}`);
      out.push(
        existing
          ? { ...existing, displayOrder: order++ }
          : {
              // Stable and inert: not a real row id, so the checkout's
              // `variantIds` lookup finds nothing to price from — which is
              // right for a value carrying no adjustment.
              id: `erp:${axis.name}:${value}`,
              name: axis.name,
              value,
              extraPrice: 0,
              // VP.1 — no own price either: the product price, for the same
              // reason there is no adjustment.
              price: null,
              displayOrder: order++,
            },
      );
    }
  }
  return out;
}

export function toLandingPageData(
  page: LandingWithRelations,
  /* VAR.2 / VAR.1 — what the Manager says about this page's variants, supplied
   * by the STOREFRONT only. The editor preview passes nothing and gets null,
   * which is correct: a preview has no warehouse, and hiding a merchant's own
   * options while they design the page would be a lie about their product. */
  variantLevels: import("../erp/variant-axes").VariantLevels | null = null,
): LandingPageData {
  /* Task-1 (24 Aug) — the LIVE page resolves the button label exactly as the
   * editor PREVIEW always has (`toPreviewState`): the General section's
   * `ctaButtonText` when set, the legacy `buttonText` column otherwise. Before
   * this, the two mappers read different columns and a General-section button
   * edit changed the preview but never the storefront. One resolved value
   * feeds BOTH the sticky bar and the order form, so they cannot disagree. */
  const buttonText = page.ctaButtonText ?? page.buttonText;
  return {
    /* Only the levels are carried for the storefront's stock greying; WHICH
       combinations exist is applied to the variant rows below, so the picker
       never has to know the Manager exists. */
    stockByVariant: variantLevels?.enforced ? variantLevels.stock : null,
    id: page.id,
    title: page.title,
    slug: page.slug,
    status: page.status,
    description: page.description,
    price: page.price.toNumber(),
    oldPrice: page.oldPrice?.toNumber() ?? null,
    currency: page.currency,
    buttonText,
    /* Task-1 — stored and previewed since the port, mapped to the live page
     * never: the announcement bar hardcoded its default line. Null stays
     * null (= "never set"), so the bar's default behavior is explicit at the
     * component, not invented here. */
    announcement: page.announcement,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    facebookPixel: page.facebookPixel,
    webhookUrl: page.webhookUrl,
    published: page.published,
    media: galleryMedia(page.media).map(toMediaData),
    descriptionImages: descriptionMedia(page.media).map(toMediaData),
    /* VAR.1 (fuller scope) — the Manager decides WHICH values are on sale.
     *
     * The page keeps owning the wording, the order and the `extraPrice`; the
     * matrix decides membership. So a value the manager added appears here
     * even though the page never had a row for it (synthesised below, at zero
     * extra price, because a price adjustment is a page decision nobody has
     * made for it yet), and a value whose combinations the manager deleted
     * stops being offered.
     *
     * `variantLevels` is null for the editor preview and for any page with no
     * linked product, and then this is exactly the list it always was. */
    variants: offeredVariantRows(page.variants, variantLevels),
    features: page.features.map((f) => ({
      id: f.id,
      icon: f.icon,
      title: f.title,
      description: f.description,
      displayOrder: f.displayOrder,
    })),
    reviews: page.reviews.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerAvatar: r.customerAvatar,
      rating: r.rating,
      reviewText: r.reviewText,
      displayOrder: r.displayOrder,
    })),
    faqs: page.faqs.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      displayOrder: f.displayOrder,
    })),
    setting: page.setting
      ? {
          countdownEnabled: page.setting.countdownEnabled,
          stickyBuyButton: page.setting.stickyBuyButton,
          floatingWhatsapp: page.setting.floatingWhatsapp,
          showReviews: page.setting.showReviews,
          showFAQ: page.setting.showFAQ,
          showFeatures: page.setting.showFeatures,
          homeDeliveryEnabled: page.setting.homeDeliveryEnabled,
          stopDeskEnabled: page.setting.stopDeskEnabled,
        }
      : null,
    /* Deliberately the LEGACY column, not the resolved value above — mirroring
     * `toPreviewState` exactly (its config fallback is `page.buttonText` too):
     * the order form's label is the order-form section's own field (JSON
     * config, legacy column fallback), while General's `ctaButtonText` drives
     * the page-level CTA surfaces. Preview and live must disagree nowhere. */
    orderForm: parseOrderFormConfig(page.setting, page.buttonText),
  };
}
