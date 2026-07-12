import type { GeneralPreviewValues } from "@/components/landings/edit/sections/general-section";
import type { PricingPreviewValues } from "@/components/landings/edit/sections/pricing-section";
import type { ImagesPreviewValues } from "@/components/landings/edit/sections/images-section";
import type { VariantsPreviewValues } from "@/components/landings/edit/sections/variants-section";
import type { ReviewsPreviewValues } from "@/components/landings/edit/sections/reviews-section";
import type { OrderFormPreviewValues } from "@/components/landings/edit/sections/order-form-section";

// Single source of truth for the edit workspace preview. The parent owns
// this object; each section updates only its own slice via onPreviewChange.
// Adding a future section means adding one key here + one initial value in
// EditWorkspace — nothing else in the parent changes.
export interface PreviewState {
  general: GeneralPreviewValues;
  pricing: PricingPreviewValues;
  images: ImagesPreviewValues;
  variants: VariantsPreviewValues;
  reviews: ReviewsPreviewValues;
  orderForm: OrderFormPreviewValues;
}
