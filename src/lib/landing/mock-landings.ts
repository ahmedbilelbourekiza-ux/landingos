import type { LandingPageStatus } from "@/types/landing";

// List-view model for a landing page. Deliberately narrower than the full
// LandingPageData used by the public template — the management table only
// needs what it displays, so dragging the whole template model in would be
// unnecessary. When Prisma lands, this maps 1:1 to a `findMany` with a
// limited `select` (id, title, slug, price, currency, status, updatedAt,
// and the first media row for the thumbnail).
export interface LandingListItem {
  id: string;
  title: string;
  slug: string;
  price: number;
  currency: string;
  status: LandingPageStatus;
  thumbnailUrl: string;
  updatedAt: string; // ISO string for easy sorting + display formatting
}

// Five realistic COD products spanning the categories the tool targets:
// beauty, accessories, electronics, home, and fitness. Prices in DZD
// (Algerian Dinar) — the project default currency for COD operations.
export const mockLandings: LandingListItem[] = [
  {
    id: "lp_001",
    title: "Lumière Vitamin C Serum",
    slug: "lumiere-vitamin-c-serum",
    price: 4900,
    currency: "DZD",
    status: "PUBLISHED",
    thumbnailUrl: "/products/cms-skincare.png",
    updatedAt: "2026-07-10T14:20:00.000Z",
  },
  {
    id: "lp_002",
    title: "Heritage Leather Chronograph",
    slug: "heritage-leather-chronograph",
    price: 12900,
    currency: "DZD",
    status: "PUBLISHED",
    thumbnailUrl: "/products/cms-watch.png",
    updatedAt: "2026-07-11T09:45:00.000Z",
  },
  {
    id: "lp_003",
    title: "Aurora Wireless Headphones",
    slug: "aurora-wireless-headphones",
    price: 8900,
    currency: "DZD",
    status: "DRAFT",
    thumbnailUrl: "/products/cms-headphones.png",
    updatedAt: "2026-07-09T18:30:00.000Z",
  },
  {
    id: "lp_004",
    title: "Nordic Ceramic Cookware Set",
    slug: "nordic-ceramic-cookware-set",
    price: 15900,
    currency: "DZD",
    status: "ARCHIVED",
    thumbnailUrl: "/products/cms-kitchen.png",
    updatedAt: "2026-06-28T11:10:00.000Z",
  },
  {
    id: "lp_005",
    title: "Pulse Fitness Tracker",
    slug: "pulse-fitness-tracker",
    price: 5900,
    currency: "DZD",
    status: "DRAFT",
    thumbnailUrl: "/products/cms-fitness.png",
    updatedAt: "2026-07-12T08:00:00.000Z",
  },
];

// Initial values for the General section of the edit workspace. When Prisma
// lands, these come from the LandingPage row. Today they're mock data shaped
// exactly like the form's values so the swap is a type-only change.
export const mockGeneralData = {
  title: "Lumière Vitamin C Serum",
  slug: "lumiere-vitamin-c-serum",
  description:
    "A clinically concentrated vitamin C serum that visibly brightens, evens tone, and restores radiance in 14 days.",
  buttonText: "اشتر الآن",
  announcement: "Free delivery nationwide · Cash on Delivery available",
};

// The slug of the landing currently being edited. Excluded from the mock
// uniqueness check so the user can keep the existing slug without an error.
// When Prisma lands, the server query excludes the current page's id.
export const currentEditSlug = mockLandings[0].slug;
