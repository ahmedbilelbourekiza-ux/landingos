"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
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
  Rows3,
  Truck,
  Eye,
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
import { BenefitsSection } from "./sections/benefits-section";
import { FaqSection } from "./sections/faq-section";
import { OrderFormSection } from "./sections/order-form-section";
import { DescriptionImagesSection } from "./sections/description-images-section";
import { ShippingSection } from "./sections/shipping-section";
import { DisplaySection } from "./sections/display-section";
import { SeoSection, type SeoValues } from "./sections/seo-section";
/* LB.13 — the registry names KEYS, not English.
 *
 * Each entry's title/description also appear on the section component's own
 * SectionShell, so the two used to hold two copies of the same sentence and
 * were free to disagree. Naming the key here and reading the SAME key there
 * makes the duplication a reference instead of a copy. */
const SECTIONS: {
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
}[] = [
  { id: "general", titleKey: "builder.editor.general", descriptionKey: "builder.editor.generalDesc", icon: Settings2 },
  { id: "images", titleKey: "builder.editor.images", descriptionKey: "builder.editor.imagesDesc", icon: ImageIcon },
  { id: "description-images", titleKey: "builder.editor.descriptionImages", descriptionKey: "builder.editor.descriptionImagesDesc", icon: Rows3 },
  { id: "pricing", titleKey: "builder.editor.pricing", descriptionKey: "builder.editor.pricingDesc", icon: Tag },
  { id: "variants", titleKey: "builder.editor.variants", descriptionKey: "builder.editor.variantsDesc", icon: Layers },
  { id: "shipping", titleKey: "builder.editor.shipping", descriptionKey: "builder.editor.shippingDesc", icon: Truck },
  { id: "order-form", titleKey: "builder.editor.orderForm", descriptionKey: "builder.editor.orderFormDesc", icon: ShoppingCart },
  { id: "display", titleKey: "builder.editor.display", descriptionKey: "builder.editor.displayDesc", icon: Eye },
  { id: "benefits", titleKey: "builder.editor.benefits", descriptionKey: "builder.editor.benefitsDesc", icon: Sparkles },
  { id: "reviews", titleKey: "builder.editor.reviews", descriptionKey: "builder.editor.reviewsDesc", icon: Star },
  { id: "faq", titleKey: "builder.editor.faq", descriptionKey: "builder.editor.faqDesc", icon: HelpCircle },
  { id: "seo", titleKey: "builder.editor.seo", descriptionKey: "builder.editor.seoDesc", icon: Search },
  { id: "integrations", titleKey: "builder.editor.integrations", descriptionKey: "builder.editor.integrationsDesc", icon: Plug },
];

export function EditSections({
  preview,
  onPreviewChange,
  landingId,
  initialSeo,
}: {
  preview: PreviewState;
  onPreviewChange: <K extends keyof PreviewState>(
    slice: K,
    values: PreviewState[K],
  ) => void;
  landingId: string;
  initialSeo: SeoValues;
}) {
  const t = useTranslations();
  const callbacks = React.useMemo(
    () => ({
      general: (v: PreviewState["general"]) => onPreviewChange("general", v),
      pricing: (v: PreviewState["pricing"]) => onPreviewChange("pricing", v),
      images: (v: PreviewState["images"]) => onPreviewChange("images", v),
      variants: (v: PreviewState["variants"]) => onPreviewChange("variants", v),
      reviews: (v: PreviewState["reviews"]) => onPreviewChange("reviews", v),
      benefits: (v: PreviewState["benefits"]) => onPreviewChange("benefits", v),
      faq: (v: PreviewState["faq"]) => onPreviewChange("faq", v),
      orderForm: (v: PreviewState["orderForm"]) => onPreviewChange("orderForm", v),
      descriptionImages: (v: PreviewState["descriptionImages"]) =>
        onPreviewChange("descriptionImages", v),
      shipping: (v: PreviewState["shipping"]) => onPreviewChange("shipping", v),
      display: (v: PreviewState["display"]) => onPreviewChange("display", v),
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
              /* LB.22 — the hero the theme generator reads. Held here because
                 the workspace owns every slice; the General section would
                 otherwise have to fetch something this component has. */
              heroUrl={preview.images.heroUrl}
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
        if (section.id === "description-images") {
          return (
            <DescriptionImagesSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.descriptionImages}
              onPreviewChange={callbacks.descriptionImages}
            />
          );
        }
        if (section.id === "shipping") {
          return (
            <ShippingSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.shipping}
              onPreviewChange={callbacks.shipping}
            />
          );
        }
        if (section.id === "display") {
          return (
            <DisplaySection
              key={section.id}
              landingId={landingId}
              initialValues={preview.display}
              onPreviewChange={callbacks.display}
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
        if (section.id === "benefits") {
          return (
            <BenefitsSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.benefits}
              onPreviewChange={callbacks.benefits}
            />
          );
        }
        if (section.id === "faq") {
          return (
            <FaqSection
              key={section.id}
              landingId={landingId}
              initialValues={preview.faq}
              onPreviewChange={callbacks.faq}
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
        if (section.id === "seo") {
          return (
            <SeoSection
              key={section.id}
              landingId={landingId}
              pageTitle={preview.general.title}
              initialValues={initialSeo}
            />
          );
        }
        if (section.id === "integrations") {
          // Not "coming soon" — it EXISTS, at the workspace level. Tracking
          // pixels and webhooks are configured once per company (LB.5), and a
          // per-page panel would be a second place for the same settings. The
          // signpost is the fix A13 prescribes: state where a thing lives
          // rather than leaving a reader guessing.
          return (
            <EditSectionCard
              key={section.id}
              id={section.id}
              title={t(section.titleKey)}
              description={t(section.descriptionKey)}
              icon={section.icon}
            >
              {/* The sentence and the link are separate keys rather than one
                  interpolated string: nothing else in this console composes
                  rich text through the catalogue, and a translator handed a
                  sentence with markup in it is the usual way a locale ends up
                  with a broken tag. */}
              <p className="text-sm text-muted-foreground">
                {t("builder.editor.integrationsBody")}
              </p>
              <a
                href="/console/settings/integrations"
                className="mt-2 inline-block text-sm underline"
              >
                {t("builder.editor.integrationsLink")}
              </a>
            </EditSectionCard>
          );
        }
        return (
          <EditSectionCard
            key={section.id}
            id={section.id}
            title={t(section.titleKey)}
            description={t(section.descriptionKey)}
            icon={section.icon}
          >
            <SectionComingSoon />
          </EditSectionCard>
        );
      })}
    </div>
  );
}
