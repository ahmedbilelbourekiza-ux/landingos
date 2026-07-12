import type { Metadata } from "next";

import { mockLandings } from "@/lib/landing/mock-landings";
import { EditWorkspace } from "@/components/landings/edit/edit-workspace";

export const metadata: Metadata = {
  title: "Edit Landing",
};

// Edit workspace — thin server shell. Resolves params and mock data, then
// hands off to the client EditWorkspace which holds the lifted preview
// state. When Prisma lands, the mock lookup becomes a real findUnique with
// notFound().
export default async function EditLandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  void id;

  const landing = mockLandings[0];

  return <EditWorkspace landing={landing} />;
}
