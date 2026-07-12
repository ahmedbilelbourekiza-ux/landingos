import type { Metadata } from "next";

import { LandingTemplate } from "@/components/landing/landing-template";
import { mockLandingPage } from "@/lib/landing/mock-data";

export const metadata: Metadata = {
  title: mockLandingPage.seoTitle ?? mockLandingPage.title,
  description: mockLandingPage.seoDescription ?? mockLandingPage.description ?? "",
};

// Mock public landing route. In production, this would be /:slug served from
// a Prisma query. Today it renders the Task 3 mock data so the "Open Landing"
// button in the edit workspace has a real target.
export default async function LandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  void slug;
  return <LandingTemplate page={mockLandingPage} />;
}
