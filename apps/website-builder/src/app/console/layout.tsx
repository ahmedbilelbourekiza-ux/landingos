import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/components/console/service-worker";
import { DensityScript } from "@/components/console/density-script";

/* The console route group. Auth is enforced by each page's call to
 * requireConsoleSession rather than by middleware, because resolving an opaque
 * session needs a database read and middleware runs on the Edge runtime — the
 * accepted consequence of choosing revocable sessions over a stateless JWT. */

/**
 * The manifest is declared HERE and not in the root layout — Phase 6.6e.
 *
 * The root layout also serves the public storefront, which is a customer-facing
 * surface belonging to whichever tenant owns the page. Advertising "install
 * LandingOS Console" to a shopper is the wrong offer, and it would put the
 * platform's own name and icon on a page a tenant thinks of as their shop.
 */
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "LandingOS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#1e1b4b",
  // The queue is a phone screen held in one hand, and `viewport-fit` lets the
  // shell reach under a notch rather than leaving a bar of background.
  viewportFit: "cover",
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Before `children`, so the density attribute is on <html> before the
          first table's CSS is evaluated against it. Console-only: a shopper on
          a tenant's storefront has no tables and no preference. */}
      <DensityScript />
      <ServiceWorkerRegistration />
      {children}
    </>
  );
}
