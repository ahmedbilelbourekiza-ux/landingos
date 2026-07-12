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

// Renders the full stack of section cards. Today every card shows the
// "Coming Soon" placeholder; future tasks replace the children of a given
// card with its real editing form. This component is the single place where
// the section list lives, so the page above stays a thin server shell.
export function EditSections() {
  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map((section) => (
        <EditSectionCard
          key={section.id}
          id={section.id}
          title={section.title}
          description={section.description}
          icon={section.icon}
        >
          <SectionComingSoon />
        </EditSectionCard>
      ))}
    </div>
  );
}
