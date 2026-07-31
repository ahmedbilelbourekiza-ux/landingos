import type { LandingPageData, VariantGroup } from "@/types/landing";
import { defaultOrderFormConfig } from "@/lib/landing/mock-order-form";

// Sample landing page used only by the /preview route — a static design
// reference page. The public landing route /l/[slug] renders entirely from
// Prisma. This data lets the design be reviewed without a database round-
// trip; it is never shown to customers.
export const mockLandingPage: LandingPageData = {
  id: "mock-serum-001",
  title: "Lumière Vitamin C Serum",
  slug: "lumiere-vitamin-c-serum",
  status: "PUBLISHED",
  description:
    "A clinically concentrated vitamin C serum that visibly brightens, evens tone, and restores radiance in 14 days.",
  price: 49,
  oldPrice: 79,
  currency: "USD",
  buttonText: "Order Now — Pay on Delivery",
  seoTitle: "Lumière Vitamin C Serum | Brightening Anti-Aging Serum",
  seoDescription:
    "Premium vitamin C serum for brighter, more even skin. Cash on delivery available. 30-day warranty.",
  facebookPixel: null,
  webhookUrl: null,
  published: true,
  media: [
    {
      id: "m1",
      type: "IMAGE",
      url: "/products/serum-01.png",
      altText: "Lumière Vitamin C Serum bottle, front view",
      displayOrder: 0,
    },
    {
      id: "m2",
      type: "IMAGE",
      url: "/products/serum-02.png",
      altText: "Lumière serum dropper detail, macro view",
      displayOrder: 1,
    },
    {
      id: "m3",
      type: "IMAGE",
      url: "/products/serum-03.png",
      altText: "Lumière serum with eucalyptus leaves, lifestyle",
      displayOrder: 2,
    },
    {
      id: "m4",
      type: "IMAGE",
      url: "/products/serum-04.png",
      altText: "Lumière serum with packaging box",
      displayOrder: 3,
    },
  ],
  variants: [
    { id: "v1", name: "Size", value: "30 ml", extraPrice: 0, displayOrder: 0 },
    { id: "v2", name: "Size", value: "50 ml", extraPrice: 12, displayOrder: 1 },
    { id: "v3", name: "Formula", value: "Standard", extraPrice: 0, displayOrder: 2 },
    {
      id: "v4",
      name: "Formula",
      value: "Extra Strength",
      extraPrice: 8,
      displayOrder: 3,
    },
  ],
  features: [
    {
      id: "f1",
      icon: "sparkles",
      title: "Brightens & Evens Tone",
      description: "15% pure vitamin C visibly reduces dark spots in 14 days.",
      displayOrder: 0,
    },
    {
      id: "f2",
      icon: "droplet",
      title: "Deep Hydration",
      description: "Hyaluronic acid locks in moisture for 48-hour radiance.",
      displayOrder: 1,
    },
    {
      id: "f3",
      icon: "shield",
      title: "Dermatologist Tested",
      description: "Non-comedogenic, fragrance-free, sensitive-skin safe.",
      displayOrder: 2,
    },
    {
      id: "f4",
      icon: "leaf",
      title: "Clean Formula",
      description: "Vegan, cruelty-free, no parabens or sulfates.",
      displayOrder: 3,
    },
  ],
  reviews: [
    {
      id: "r1",
      customerName: "Sarah M.",
      customerAvatar: null,
      rating: 5,
      reviewText:
        "My skin has never looked better. The dark spots on my cheeks faded in two weeks. Worth every penny.",
      displayOrder: 0,
    },
    {
      id: "r2",
      customerName: "Yasmine B.",
      customerAvatar: null,
      rating: 5,
      reviewText:
        "Lightweight, absorbs instantly, no sticky feeling. The dropper gives the perfect amount each time.",
      displayOrder: 1,
    },
    {
      id: "r3",
      customerName: "Karim L.",
      customerAvatar: null,
      rating: 4,
      reviewText:
        "Great serum, genuine results. Delivery was fast and I paid on arrival exactly as promised.",
      displayOrder: 2,
    },
    {
      id: "r4",
      customerName: "Nadia E.",
      customerAvatar: null,
      rating: 5,
      reviewText:
        "Third bottle already. This is the only serum that actually brightened my skin without irritation.",
      displayOrder: 3,
    },
  ],
  faqs: [
    {
      id: "q1",
      question: "How do I pay?",
      answer:
        "Cash on Delivery. You pay the courier in cash when your order arrives at your door — no prepayment needed.",
      displayOrder: 0,
    },
    {
      id: "q2",
      question: "How long does delivery take?",
      answer:
        "Orders are delivered within 24–72 hours depending on your wilaya. You will receive a confirmation call before dispatch.",
      displayOrder: 1,
    },
    {
      id: "q3",
      question: "Is the serum suitable for sensitive skin?",
      answer:
        "Yes. The formula is fragrance-free, dermatologist tested, and non-comedogenic. We recommend a patch test 24 hours before first use.",
      displayOrder: 2,
    },
    {
      id: "q4",
      question: "What is the warranty?",
      answer:
        "Every order includes a 30-day satisfaction warranty. If you are not happy with the results, contact us for a replacement.",
      displayOrder: 3,
    },
  ],
  setting: {
    countdownEnabled: false,
    stickyBuyButton: true,
    floatingWhatsapp: false,
    showReviews: true,
    showFAQ: true,
    showFeatures: true,
    homeDeliveryEnabled: true,
    stopDeskEnabled: true,
  },
  descriptionImages: [],
  orderForm: defaultOrderFormConfig,
};

// Groups flat variants by name, preserving the order each option first
// appears. Used by the variant selectors to render one control per group.
export function groupVariants(
  variants: LandingPageData["variants"],
): VariantGroup[] {
  const groups: VariantGroup[] = [];
  for (const v of variants) {
    let group = groups.find((g) => g.name === v.name);
    if (!group) {
      group = { name: v.name, options: [] };
      groups.push(group);
    }
    group.options.push({ id: v.id, value: v.value, extraPrice: v.extraPrice });
  }
  return groups;
}
