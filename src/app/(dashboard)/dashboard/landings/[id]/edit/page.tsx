import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { toPreviewState } from "@/lib/landing/mappers";
import { EditWorkspace } from "@/components/landings/edit/edit-workspace";
import type { PublishStatus } from "@/components/landings/edit/edit-workspace-header";

export const metadata: Metadata = {
  title: "Edit Landing",
};

export default async function EditLandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const page = await db.landingPage.findUnique({
    where: { id },
    include: {
      media: { orderBy: { displayOrder: "asc" } },
      variants: { orderBy: { displayOrder: "asc" } },
      reviews: { orderBy: { displayOrder: "asc" } },
      setting: true,
      theme: true,
    },
  });

  if (!page) notFound();

  const initialPreview = toPreviewState(page);
  const initialStatus: PublishStatus =
    page.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

  return (
    <EditWorkspace
      landingId={page.id}
      landingTitle={page.title}
      landingSlug={page.slug}
      initialPreview={initialPreview}
      initialStatus={initialStatus}
    />
  );
}
