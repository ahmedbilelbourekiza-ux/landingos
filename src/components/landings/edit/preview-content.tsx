"use client";

import { cn } from "@/lib/utils";
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
export function PreviewContent({
  device,
  preview,
}: {
  device: PreviewDevice;
  preview: PreviewState;
}) {
  const isMobile = device === "mobile";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background",
        isMobile
          ? "mx-auto aspect-[9/19] max-w-[220px]"
          : "aspect-[16/10]",
      )}
    >
      <div className="flex-1 overflow-y-auto">
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
      </div>
    </div>
  );
}
