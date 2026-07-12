"use client";

import * as React from "react";

import type { LandingListItem } from "@/lib/landing/mock-landings";
import { mockGeneralData, mockPricingData } from "@/lib/landing/mock-landings";
import { mockImagesData } from "@/lib/landing/mock-media";
import { EditWorkspaceHeader } from "./edit-workspace-header";
import { EditSections } from "./edit-sections";
import { PreviewPanel } from "./preview-panel";
import type { GeneralPreviewValues } from "./sections/general-section";
import type { PricingPreviewValues } from "./sections/pricing-section";
import type { ImagesPreviewValues } from "./sections/images-section";

// Client wrapper for the edit workspace. The page (server component) resolves
// params and mock data, then renders this. The workspace holds the lifted
// preview state — the display values from the General, Pricing, and Images
// sections that the Preview panel also needs. This is the minimum state
// lifted to the nearest common ancestor; no global store.
export function EditWorkspace({ landing }: { landing: LandingListItem }) {
  const [previewValues, setPreviewValues] = React.useState<GeneralPreviewValues>({
    title: mockGeneralData.title,
    description: mockGeneralData.description,
    buttonText: mockGeneralData.buttonText,
    announcement: mockGeneralData.announcement,
  });

  const [pricingValues, setPricingValues] =
    React.useState<PricingPreviewValues>({
      price: mockPricingData.price,
      oldPrice: mockPricingData.oldPrice,
      currency: mockPricingData.currency,
      shipping: mockPricingData.shipping,
      freeShipping: mockPricingData.freeShipping,
    });

  const [imagesValues, setImagesValues] = React.useState<ImagesPreviewValues>({
    heroUrl: mockImagesData.hero.url,
    galleryUrls: mockImagesData.gallery.map((g) => g.url),
  });

  // Memoized so each section's useEffect dependency stays stable.
  const handleValuesChange = React.useCallback(
    (values: GeneralPreviewValues) => setPreviewValues(values),
    [],
  );

  const handlePricingChange = React.useCallback(
    (values: PricingPreviewValues) => setPricingValues(values),
    [],
  );

  const handleImagesChange = React.useCallback(
    (values: ImagesPreviewValues) => setImagesValues(values),
    [],
  );

  return (
    <div className="flex flex-col">
      <EditWorkspaceHeader landing={landing} />

      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:gap-8">
          <EditSections
            onGeneralValuesChange={handleValuesChange}
            onPricingValuesChange={handlePricingChange}
            onImagesValuesChange={handleImagesChange}
          />
          <div className="hidden lg:block">
            <PreviewPanel
              values={previewValues}
              pricing={pricingValues}
              images={imagesValues}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
