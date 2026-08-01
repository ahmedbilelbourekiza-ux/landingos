import type { ReactNode } from "react";

import { MetaPixelLoader } from "@/components/landing/meta-pixel-loader";

// Public landing-page route group. Future generated COD product pages render
// here. At the foundation stage the shell is intentionally bare — no chrome,
// just a min-h-screen column so the sticky-footer rule applies once footers
// are added per page.
//
// MetaPixelLoader runs on every storefront page: it captures fbclid -> _fbc
// unconditionally, and loads the Meta base pixel script (for _fbp) only if
// at least one pixel config is active. See the component for details.
export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MetaPixelLoader />
      {children}
    </div>
  );
}
