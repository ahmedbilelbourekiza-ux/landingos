import type { Metadata } from "next";

import { mockLandings } from "@/lib/landing/mock-landings";
import { EditWorkspaceHeader } from "@/components/landings/edit/edit-workspace-header";
import { EditSections } from "@/components/landings/edit/edit-sections";
import { PreviewPanel } from "@/components/landings/edit/preview-panel";

export const metadata: Metadata = {
  title: "Edit Landing",
};

// Edit workspace — thin server shell. Resolves the landing from mock data
// (falling back to the first mock so the Task 5 redirect always lands
// somewhere), then renders the header + two-column layout. All editing
// state lives inside each section's own client component; this page owns
// nothing beyond the layout. When Prisma lands, the mock lookup becomes a
// real findUnique with notFound().
export default async function EditLandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  void id;

  // Mock lookup. The id from the URL may be a Task 5 mock id that isn't in
  // the list — fall back to the first mock landing so the page always
  // renders. When Prisma lands, this becomes a real findUnique with
  // notFound() when the page doesn't exist.
  const landing = mockLandings[0];

  return (
    <div className="flex flex-col">
      <EditWorkspaceHeader landing={landing} />

      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:gap-8">
          {/* Left column: section cards. Generous vertical spacing so each
              card breathes. The column scrolls naturally with the page. */}
          <EditSections />

          {/* Right column: sticky preview panel. Hidden below lg — a tiny
              preview frame adds no value on a narrow screen. */}
          <div className="hidden lg:block">
            <PreviewPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
