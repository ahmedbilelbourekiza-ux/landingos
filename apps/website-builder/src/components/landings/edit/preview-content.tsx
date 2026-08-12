"use client";

import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/landing/theme-provider";
import type { LandingThemeData } from "@/types/theme";
import type { PreviewDevice } from "./preview-device-toggle";
import type { PreviewState } from "@/types/preview";
import { PreviewAnnouncement } from "./preview/preview-announcement";
import { PreviewHero } from "./preview/preview-hero";
import { PreviewGallery } from "./preview/preview-gallery";
import { PreviewProductInfo } from "./preview/preview-product-info";
import { PreviewPricing } from "./preview/preview-pricing";
import { PreviewVariants } from "./preview/preview-variants";
import { PreviewCTA } from "./preview/preview-cta";
import { PreviewOrderForm } from "./preview/preview-order-form";

// Composer only. Renders the device frame and composes the Preview* section
// components in order. No business logic, no price computation, no
// conditionals beyond what each child component owns internally. Adding a
// new preview section means one import + one line here — nothing else.
//
// The scroll area is a landing ThemeProvider, not a plain div: the sections
// inside are written in console Tailwind tokens, and without the theme scope
// the miniature rendered the CONSOLE's dark/light palette instead of the
// page's own theme — flipping with the console toggle (the theme-bleed fix).
// The provider repaints those token names from the page's theme, exactly as
// the drawer preview and the published page do.
export function PreviewContent({
  device,
  theme,
  preview,
}: {
  device: PreviewDevice;
  theme: LandingThemeData;
  preview: PreviewState;
}) {
  const isMobile = device === "mobile";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border",
        isMobile
          ? "mx-auto aspect-[9/19] max-w-[220px]"
          : "aspect-[16/10]",
      )}
    >
      <ThemeProvider theme={theme} className="flex-1 overflow-y-auto">
        <PreviewAnnouncement preview={preview} />
        <PreviewHero preview={preview} />
        <PreviewGallery preview={preview} />
        <div className="flex flex-col gap-2 p-3">
          <PreviewProductInfo preview={preview} />
          <PreviewPricing preview={preview} />
          <PreviewVariants preview={preview} />
          <PreviewCTA preview={preview} />
        </div>
        <PreviewOrderForm preview={preview} />
      </ThemeProvider>
    </div>
  );
}
