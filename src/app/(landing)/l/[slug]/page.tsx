import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { toLandingPageData, toThemeData } from "@/lib/landing/mappers";
import { LandingTemplate } from "@/components/landing/landing-template";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await db.landingPage.findUnique({
    where: { slug },
    select: { title: true, seoTitle: true, seoDescription: true, description: true },
  });
  if (!page) return { title: "Not Found" };
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.description ?? "",
  };
}

// Public landing route. Serves the landing page from Prisma by slug.
export default async function LandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await db.landingPage.findUnique({
    where: { slug },
    include: {
      media: { orderBy: { displayOrder: "asc" } },
      variants: { orderBy: { displayOrder: "asc" } },
      reviews: { orderBy: { displayOrder: "asc" } },
      setting: true,
      theme: true,
    },
  });

  if (!page) notFound();

  return <LandingTemplate page={toLandingPageData(page)} theme={toThemeData(page.theme)} />;
}
