import type { GeneralPreviewValues } from "@/components/landings/edit/sections/general-section";
import type { PricingPreviewValues } from "@/components/landings/edit/sections/pricing-section";
import type { ImagesPreviewValues } from "@/components/landings/edit/sections/images-section";
import type { VariantsPreviewValues } from "@/components/landings/edit/sections/variants-section";
import type { ReviewsPreviewValues } from "@/components/landings/edit/sections/reviews-section";
import type { BenefitsPreviewValues } from "@/components/landings/edit/sections/benefits-section";
import type { FaqPreviewValues } from "@/components/landings/edit/sections/faq-section";
import type { OrderFormPreviewValues } from "@/components/landings/edit/sections/order-form-section";

// Long-form images shown below the description. Held as a plain URL list
// because ordering is the list order and nothing else about them is editable.
export interface DescriptionImagesPreviewValues {
  urls: string[];
}

// Shipping methods offered for this product. At least one must stay enabled —
// a product offering neither cannot be ordered. `freeShipping` zeroes the
// delivery charge at checkout (the API has honoured it since the port; the
// switch reached the editor with CAPABILITY_AUDIT B2).
export interface ShippingPreviewValues {
  homeDeliveryEnabled: boolean;
  stopDeskEnabled: boolean;
  freeShipping: boolean;
}

// Which optional sections the page shows — the LandingSetting toggles that
// were stored and honoured nowhere a merchant could reach (B2).
export interface DisplayPreviewValues {
  stickyBuyButton: boolean;
  floatingWhatsapp: boolean;
  showReviews: boolean;
  showFAQ: boolean;
  showFeatures: boolean;
  /** BH.1 — per-page behavior-tracking opt-in. Not a visual toggle: the
   * preview renders identically either way; it rides this section because
   * it is a LandingSetting flag saved by the same route. */
  behaviorTracking: boolean;
}

export interface PreviewState {
  general: GeneralPreviewValues;
  pricing: PricingPreviewValues;
  images: ImagesPreviewValues;
  variants: VariantsPreviewValues;
  reviews: ReviewsPreviewValues;
  benefits: BenefitsPreviewValues;
  faq: FaqPreviewValues;
  orderForm: OrderFormPreviewValues;
  descriptionImages: DescriptionImagesPreviewValues;
  shipping: ShippingPreviewValues;
  display: DisplayPreviewValues;
}
