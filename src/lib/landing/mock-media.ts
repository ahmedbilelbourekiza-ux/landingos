// Media library for the Images section's picker dialog. The admin picks
// from these pre-existing product images. The picker UI is designed so it
// can later be backed by a media table or upload-and-return flow without
// changes to the consuming components.

export interface MediaItem {
  id: string;
  url: string;
  filename: string;
}

// Stock images drawn from the /public/products assets. Filenames are
// human-readable so the image cards show something meaningful.
export const mockMediaOptions: MediaItem[] = [
  { id: "opt-1", url: "/products/serum-01.png", filename: "serum-hero.png" },
  { id: "opt-2", url: "/products/serum-02.png", filename: "serum-detail.png" },
  { id: "opt-3", url: "/products/serum-03.png", filename: "serum-lifestyle.png" },
  { id: "opt-4", url: "/products/serum-04.png", filename: "serum-packaging.png" },
  { id: "opt-5", url: "/products/cms-skincare.png", filename: "skincare-front.png" },
  { id: "opt-6", url: "/products/cms-watch.png", filename: "watch-front.png" },
  { id: "opt-7", url: "/products/cms-headphones.png", filename: "headphones-front.png" },
  { id: "opt-8", url: "/products/cms-kitchen.png", filename: "cookware-front.png" },
];
