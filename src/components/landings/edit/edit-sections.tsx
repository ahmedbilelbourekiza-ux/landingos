"use client";

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

import { EditSectionCard } from "./edit-section-card";
import { SectionComingSoon } from "./section-coming-soon";
import { GeneralSection, type GeneralPreviewValues } from "./sections/general-section";
import { PricingSection, type PricingPreviewValues } from "./sections/pricing-section";
import { ImagesSection, type ImagesPreviewValues } from "./sections/images-section";

// The nine editing sections, owned by this client component because the
// icon references (lucide components) can't cross a server→client boundary.
// Each entry renders one card. Adding a section later is a one-line edit
// here; the order matches the natural editing flow: identity → visual →
// commerce → content → discovery → integration. The `id` doubles as the
// scroll anchor (#general, #images, …) for future in-page navigation.
const SECTIONS: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    id: "general",
    title: "General",
    description: "Title, slug, description, and button text.",
    icon: Settings2,
  },
  {
    id: "images",
    title: "Images & Media",
    description: "Product gallery, videos, and thumbnails.",
    icon: ImageIcon,
  },
  {
    id: "pricing",
    title: "Pricing",
    description: "Price, old price, and currency.",
    icon: Tag,
  },
  {
    id: "variants",
    title: "Variants",
    description: "Colors, sizes, and product options.",
    icon: Layers,
  },
  {
    id: "benefits",
    title: "Benefits",
    description: "Trust badges and key selling points.",
    icon: Sparkles,
  },
  {
    id: "reviews",
    title: "Reviews",
    description: "Customer testimonials and ratings.",
    icon: Star,
  },
  {
    id: "faq",
    title: "FAQ",
    description: "Frequently asked questions.",
    icon: HelpCircle,
  },
  {
    id: "seo",
    title: "SEO",
    description: "Search and social meta tags.",
    icon: Search,
  },
  {
    id: "integrations",
    title: "Integrations",
    description: "Webhook, Facebook Pixel, and analytics.",
    icon: Plug,
  },
];

// Renders the full stack of section cards. The General, Pricing, and Images
// sections are real (working editors); all others still show "Coming Soon".
// As each section gets its real editor, it's swapped in here the same way.
export function EditSections({
  onGeneralValuesChange,
  onPricingValuesChange,
  onImagesValuesChange,
}: {
  onGeneralValuesChange: (values: GeneralPreviewValues) => void;
  onPricingValuesChange: (values: PricingPreviewValues) => void;
  onImagesValuesChange: (values: ImagesPreviewValues) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map((section) => {
        if (section.id === "general") {
          return (
            <GeneralSection
              key={section.id}
              onValuesChange={onGeneralValuesChange}
            />
          );
        }
        if (section.id === "pricing") {
          return (
            <PricingSection
              key={section.id}
              onValuesChange={onPricingValuesChange}
            />
          );
        }
        if (section.id === "images") {
          return (
            <ImagesSection
              key={section.id}
              onValuesChange={onImagesValuesChange}
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
