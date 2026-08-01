import type { LandingPageStatus } from "@/types/landing";

// List-view model for a landing page. Deliberately narrower than the full
// LandingPageData used by the public template — the management table only
// needs what it displays, so dragging the whole template model in would be
// unnecessary. This maps 1:1 to a Prisma `findMany` with a limited `select`
// (id, title, slug, price, currency, status, updatedAt, and the first media
// row for the thumbnail).
export interface LandingListItem {
  id: string;
  title: string;
  slug: string;
  price: number;
  currency: string;
  status: LandingPageStatus;
  thumbnailUrl: string | null;
  updatedAt: string; // ISO string for easy sorting + display formatting
}

// Variant types — shared between the section editor, the preview, and the
// landing template. A variant group (e.g. "Color") contains options (e.g.
// "White", "Black") each with an optional extra price added to the base.
export interface VariantOption {
  id: string;
  label: string;
  extraPrice: number;
}

export interface VariantGroup {
  id: string;
  name: string;
  options: VariantOption[];
}
