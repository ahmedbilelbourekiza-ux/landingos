"use client";

import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { LandingTemplate } from "@/components/landing/landing-template";
import { previewToLandingPage } from "@/lib/landing/preview-to-landing";
import { useSelectedLandingTheme } from "@/lib/landing/use-selected-theme";
import type { PreviewState } from "@/types/preview";
import type { StorefrontStoreData } from "@/types/landing";

// Full-width drawer that renders the actual LandingTemplate with the current
// preview state. Loads the selected theme from the API so the preview matches
// the published landing exactly.
//
// `store` is passed for the same reason the theme is: this drawer renders the
// REAL template, so anything the template falls back on shows up here as the
// merchant's own preview of their page. Without it the nav and footer rendered
// the PLATFORM's wordmark, description and copyright — the leak a merchant was
// most likely to see first, since the drawer is how they check their work. Its
// `homePath` is null so the brand renders as text: a live link here would
// navigate them out of the editor.
export function PreviewDrawer({
  open,
  onOpenChange,
  preview,
  store,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: PreviewState;
  store: StorefrontStoreData;
}) {
  const t = useTranslations();
  const theme = useSelectedLandingTheme(preview.general.themeId);

  const landingPage = previewToLandingPage(preview);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 border-b bg-background/80 px-6 py-3 backdrop-blur-md">
          <SheetTitle className="text-sm">{t("builder.editor.livePreview")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("builder.editor.livePreviewHint")}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-[calc(100vh-3rem)]">
          <LandingTemplate page={landingPage} theme={theme} store={store} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
