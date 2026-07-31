import type { GeneralPreviewValues } from "@/components/landings/edit/sections/general-section";
import type { PricingPreviewValues } from "@/components/landings/edit/sections/pricing-section";
import type { ImagesPreviewValues } from "@/components/landings/edit/sections/images-section";
import type { VariantsPreviewValues } from "@/components/landings/edit/sections/variants-section";
import type { ReviewsPreviewValues } from "@/components/landings/edit/sections/reviews-section";
import type { OrderFormPreviewValues } from "@/components/landings/edit/sections/order-form-section";

// Long-form images shown below the description. Held as a plain URL list
// because ordering is the list order and nothing else about them is editable.
export interface DescriptionImagesPreviewValues {
  urls: string[];
}

// Shipping methods offered for this product. At least one must stay enabled —
// a product offering neither cannot be ordered.
export interface ShippingPreviewValues {
  homeDeliveryEnabled: boolean;
  stopDeskEnabled: boolean;
}

export interface PreviewState {
  general: GeneralPreviewValues;
  pricing: PricingPreviewValues;
  images: ImagesPreviewValues;
  variants: VariantsPreviewValues;
  reviews: ReviewsPreviewValues;
  orderForm: OrderFormPreviewValues;
  descriptionImages: DescriptionImagesPreviewValues;
  shipping: ShippingPreviewValues;
}
