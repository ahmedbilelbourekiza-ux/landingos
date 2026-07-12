"use client";

import * as React from "react";
import {
  Settings2,
  Image as ImageIcon,
  Tag,
  Layers,
  ShoppingCart,
  Sparkles,
  Star,
  HelpCircle,
  Search,
  Plug,
  type LucideIcon,
} from "lucide-react";

import type { PreviewState } from "@/types/preview";
import { EditSectionCard } from "./edit-section-card";
import { SectionComingSoon } from "./section-coming-soon";
import { GeneralSection } from "./sections/general-section";
import { PricingSection } from "./sections/pricing-section";
import { ImagesSection } from "./sections/images-section";
import { VariantsSection } from "./sections/variants-section";
import { ReviewsSection } from "./sections/reviews-section";
import { OrderFormSection } from "./sections/order-form-section";
const SECTIONS: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  { id: "general", title: "General", description: "Title, slug, description, and button text.", icon: Settings2 },
  { id: "images", title: "Images & Media", description: "Product gallery, videos, and thumbnails.", icon: ImageIcon },
  { id: "pricing", title: "Pricing", description: "Price, old price, and currency.", icon: Tag },
  { id: "variants", title: "Variants", description: "Colors, sizes, and product options.", icon: Layers },
  { id: "order-form", title: "Order Form", description: "Configure the purchase form fields.", icon: ShoppingCart },
  { id: "benefits", title: "Benefits", description: "Trust badges and key selling points.", icon: Sparkles },
  { id: "reviews", title: "Reviews", description: "Customer testimonials and ratings.", icon: Star },
  { id: "faq", title: "FAQ", description: "Frequently asked questions.", icon: HelpCircle },
  { id: "seo", title: "SEO", description: "Search and social meta tags.", icon: Search },
  { id: "integrations", title: "Integrations", description: "Webhook, Facebook Pixel, and analytics.", icon: Plug },
];

export function EditSections({
  preview,
  onPreviewChange,
  landingId,
}: {
  preview: PreviewState;
  onPreviewChange: <K extends keyof PreviewState>(
    slice: K,
    values: PreviewState[K],
  ) => void;
  landingId: string;
}) {
  const callbacks = React.useMemo(
    () => ({
      general: (v: PreviewState["general"]) => onPreviewChange("general", v),
      pricing: (v: PreviewState["pricing"]) => onPreviewChange("pricing", v),
      images: (v: PreviewState["images"]) => onPreviewChange("images", v),
      variants: (v: PreviewState["variants"]) => onPreviewChange("variants", v),
      reviews: (v: PreviewState["reviews"]) => onPreviewChange("reviews", v),
      orderForm: (v: PreviewState["orderForm"]) => onPreviewChange("orderForm", v),
    }),
    [onPreviewChange],
  );

  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map((section) => {
        if (section.id === "general") {
          return (
            <GeneralSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.general}
              onPreviewChange={callbacks.general}
            />
          );
        }
        if (section.id === "pricing") {
          return (
            <PricingSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.pricing}
              onPreviewChange={callbacks.pricing}
            />
          );
        }
        if (section.id === "images") {
          return (
            <ImagesSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.images}
              onPreviewChange={callbacks.images}
            />
          );
        }
        if (section.id === "variants") {
          return (
            <VariantsSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.variants}
              onPreviewChange={callbacks.variants}
            />
          );
        }
        if (section.id === "reviews") {
          return (
            <ReviewsSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.reviews}
              onPreviewChange={callbacks.reviews}
            />
          );
        }
        if (section.id === "order-form") {
          return (
            <OrderFormSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.orderForm}
              onPreviewChange={callbacks.orderForm}
            />
          );
        }
        return (
          <EditSectionCard
            key={section.id}
            id={section.id}
            title={section.title}
            description={section.description}
            icon={section.icon}
          >
            <SectionComingSoon />
          </EditSectionCard>
        );
      })}
    </div>
  );
}
