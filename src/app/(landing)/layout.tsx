import type { ReactNode } from "react";

// Public landing-page route group. Future generated COD product pages render
// here. At the foundation stage the shell is intentionally bare — no chrome,
// just a min-h-screen column so the sticky-footer rule applies once footers
// are added per page.
export default function LandingLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col">{children}</div>;
}
