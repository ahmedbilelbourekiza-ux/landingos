"use client";

import * as React from "react";
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
import { DEFAULT_THEME, type LandingThemeData } from "@/types/theme";
import type { PreviewState } from "@/types/preview";
import { useBuilderApi } from "@/lib/builder/api-base";

// Full-width drawer that renders the actual LandingTemplate with the current
// preview state. Loads the selected theme from the API so the preview matches
// the published landing exactly.
export function PreviewDrawer({
  open,
  onOpenChange,
  preview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: PreviewState;
}) {
  // Bound to the console API by BuilderApiProvider.
  const api = useBuilderApi();
  const t = useTranslations();
  const [theme, setTheme] = React.useState<LandingThemeData>(DEFAULT_THEME);

  React.useEffect(() => {
    const themeId = preview.general.themeId;
    if (!themeId) { setTheme(DEFAULT_THEME); return; }
    fetch(api("/themes"))
      .then((r) => r.json())
      .then((json) => {
        // Platform envelope: the list is data.items (LB.2, B-05).
        if (json.success && Array.isArray(json.data?.items)) {
          const found = json.data.items.find((t: LandingThemeData) => t.id === themeId);
          setTheme(found ?? DEFAULT_THEME);
        }
      });
  }, [preview.general.themeId]);

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
          <LandingTemplate page={landingPage} theme={theme} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
