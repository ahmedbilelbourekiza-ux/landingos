"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { LandingTemplate } from "@/components/landing/landing-template";
import { previewToLandingPage } from "@/lib/landing/preview-to-landing";
import type { PreviewState } from "@/types/preview";

// Full-width drawer that renders the actual LandingTemplate with the current
// preview state. No iframe — the real component tree renders directly, so
// every unsaved change is reflected immediately. The mapper converts the
// edit workspace's PreviewState into the LandingPageData shape the template
// expects.
export function PreviewDrawer({
  open,
  onOpenChange,
  preview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: PreviewState;
}) {
  const landingPage = previewToLandingPage(preview);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 border-b bg-background/80 px-6 py-3 backdrop-blur-md">
          <SheetTitle className="text-sm">Live Preview</SheetTitle>
          <SheetDescription className="sr-only">
            Live preview of the landing page with current unsaved changes.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-[calc(100vh-3rem)]">
          <LandingTemplate page={landingPage} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
