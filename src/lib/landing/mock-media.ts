// Mock media library for the Images section's picker dialog. Since there's
// no upload backend yet, the admin picks from these pre-existing product
// images. When real upload lands, this list is replaced by a query to the
// media table (or an upload-and-return flow) — the picker UI stays the same.

export interface MockMediaOption {
  id: string;
  url: string;
  filename: string;
}

// 8 mock images drawn from the existing /public/products assets. Filenames
// are human-readable so the image cards show something meaningful.
export const mockMediaOptions: MockMediaOption[] = [
  { id: "opt-1", url: "/products/serum-01.png", filename: "serum-hero.png" },
  { id: "opt-2", url: "/products/serum-02.png", filename: "serum-detail.png" },
  { id: "opt-3", url: "/products/serum-03.png", filename: "serum-lifestyle.png" },
  { id: "opt-4", url: "/products/serum-04.png", filename: "serum-packaging.png" },
  { id: "opt-5", url: "/products/cms-skincare.png", filename: "skincare-front.png" },
  { id: "opt-6", url: "/products/cms-watch.png", filename: "watch-front.png" },
  { id: "opt-7", url: "/products/cms-headphones.png", filename: "headphones-front.png" },
  { id: "opt-8", url: "/products/cms-kitchen.png", filename: "cookware-front.png" },
];

// Initial gallery state for the edit workspace. The hero is the first
// image; the gallery holds the rest. When Prisma lands, this comes from
// the LandingMedia rows ordered by displayOrder, with the first IMAGE
// treated as the hero.
export const mockImagesData = {
  hero: { id: "img-1", url: "/products/serum-01.png", filename: "serum-hero.png" },
  gallery: [
    { id: "img-2", url: "/products/serum-02.png", filename: "serum-detail.png" },
    { id: "img-3", url: "/products/serum-03.png", filename: "serum-lifestyle.png" },
    { id: "img-4", url: "/products/serum-04.png", filename: "serum-packaging.png" },
  ],
};

export interface MediaItem {
  id: string;
  url: string;
  filename: string;
}
