import type { Metadata } from "next";

import { LandingTemplate } from "@/components/landing/landing-template";
import { mockLandingPage } from "@/lib/landing/mock-data";

// Preview route for the default landing-page template. Lets the admin review
// the design before the builder (a later task) wires real Prisma data. In
// production, public pages will be served at /:slug and render the same
// <LandingTemplate> with a fetched LandingPage row.
export const metadata: Metadata = {
  title: mockLandingPage.seoTitle ?? mockLandingPage.title,
  description: mockLandingPage.seoDescription ?? mockLandingPage.description ?? "",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return <LandingTemplate page={mockLandingPage} />;
}
