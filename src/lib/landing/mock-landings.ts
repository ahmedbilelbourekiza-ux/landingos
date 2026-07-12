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
// beauty, accessories, electronics, home, and fitness. Prices in USD; the
// currency field keeps the formatter honest for future multi-currency work.
export const mockLandings: LandingListItem[] = [
  {
    id: "lp_001",
    title: "Lumière Vitamin C Serum",
    slug: "lumiere-vitamin-c-serum",
    price: 49,
    currency: "USD",
    status: "PUBLISHED",
    thumbnailUrl: "/products/cms-skincare.png",
    updatedAt: "2026-07-10T14:20:00.000Z",
  },
  {
    id: "lp_002",
    title: "Heritage Leather Chronograph",
    slug: "heritage-leather-chronograph",
    price: 129,
    currency: "USD",
    status: "PUBLISHED",
    thumbnailUrl: "/products/cms-watch.png",
    updatedAt: "2026-07-11T09:45:00.000Z",
  },
  {
    id: "lp_003",
    title: "Aurora Wireless Headphones",
    slug: "aurora-wireless-headphones",
    price: 89,
    currency: "USD",
    status: "DRAFT",
    thumbnailUrl: "/products/cms-headphones.png",
    updatedAt: "2026-07-09T18:30:00.000Z",
  },
  {
    id: "lp_004",
    title: "Nordic Ceramic Cookware Set",
    slug: "nordic-ceramic-cookware-set",
    price: 159,
    currency: "USD",
    status: "ARCHIVED",
    thumbnailUrl: "/products/cms-kitchen.png",
    updatedAt: "2026-06-28T11:10:00.000Z",
  },
  {
    id: "lp_005",
    title: "Pulse Fitness Tracker",
    slug: "pulse-fitness-tracker",
    price: 59,
    currency: "USD",
    status: "DRAFT",
    thumbnailUrl: "/products/cms-fitness.png",
    updatedAt: "2026-07-12T08:00:00.000Z",
  },
];
