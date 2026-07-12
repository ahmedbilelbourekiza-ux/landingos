"use client";

import * as React from "react";
import {
  Settings2,
  Image as ImageIcon,
  Tag,
  Layers,
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
  { id: "benefits", title: "Benefits", description: "Trust badges and key selling points.", icon: Sparkles },
  { id: "reviews", title: "Reviews", description: "Customer testimonials and ratings.", icon: Star },
  { id: "faq", title: "FAQ", description: "Frequently asked questions.", icon: HelpCircle },
  { id: "seo", title: "SEO", description: "Search and social meta tags.", icon: Search },
  { id: "integrations", title: "Integrations", description: "Webhook, Facebook Pixel, and analytics.", icon: Plug },
];

// Renders the full stack of section cards. General, Pricing, Images, and
// Variants are real editors; the rest still show "Coming Soon". Each real
// section receives its preview slice + the shared onPreviewChange callback.
export function EditSections({
  preview,
  onPreviewChange,
}: {
  preview: PreviewState;
  onPreviewChange: <K extends keyof PreviewState>(
    slice: K,
    values: PreviewState[K],
  ) => void;
}) {
  // Memoize each per-section callback so the sections' useEffect deps stay
  // stable. The parent's onPreviewChange is already memoized (useCallback
  // with []), so these are stable too. Without this, inline arrow functions
  // would create new references on every render and trigger infinite update
  // loops in the sections' lifting effects.
  const callbacks = React.useMemo(
    () => ({
      general: (v: PreviewState["general"]) => onPreviewChange("general", v),
      pricing: (v: PreviewState["pricing"]) => onPreviewChange("pricing", v),
      images: (v: PreviewState["images"]) => onPreviewChange("images", v),
      variants: (v: PreviewState["variants"]) => onPreviewChange("variants", v),
    }),
    [onPreviewChange],
  );

  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map((section) => {
        if (section.id === "general") {
          return <GeneralSection key={section.id} onPreviewChange={callbacks.general} />;
        }
        if (section.id === "pricing") {
          return <PricingSection key={section.id} onPreviewChange={callbacks.pricing} />;
        }
        if (section.id === "images") {
          return <ImagesSection key={section.id} onPreviewChange={callbacks.images} />;
        }
        if (section.id === "variants") {
          return <VariantsSection key={section.id} onPreviewChange={callbacks.variants} />;
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
