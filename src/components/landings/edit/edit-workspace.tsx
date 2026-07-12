"use client";

import * as React from "react";

import type { LandingListItem } from "@/lib/landing/mock-landings";
import {
  mockGeneralData,
  mockPricingData,
  mockVariantsData,
} from "@/lib/landing/mock-landings";
import { mockImagesData } from "@/lib/landing/mock-media";
import { mockReviewsData } from "@/lib/landing/mock-reviews";
import { mockOrderFormData } from "@/lib/landing/mock-order-form";
import type { PreviewState } from "@/types/preview";
import { EditWorkspaceHeader } from "./edit-workspace-header";
import { EditSections } from "./edit-sections";
import { PreviewPanel } from "./preview-panel";

// Client wrapper for the edit workspace. Owns exactly one preview object —
// the single source of truth. Each section updates only its own slice via
// onPreviewChange. No global store, no per-section useState in the parent.
export function EditWorkspace({ landing }: { landing: LandingListItem }) {
  const [preview, setPreview] = React.useState<PreviewState>({
    general: {
      title: mockGeneralData.title,
      description: mockGeneralData.description,
      buttonText: mockGeneralData.buttonText,
      announcement: mockGeneralData.announcement,
    },
    pricing: {
      price: mockPricingData.price,
      oldPrice: mockPricingData.oldPrice,
      currency: mockPricingData.currency,
      shipping: mockPricingData.shipping,
      freeShipping: mockPricingData.freeShipping,
    },
    images: {
      heroUrl: mockImagesData.hero.url,
      galleryUrls: mockImagesData.gallery.map((g) => g.url),
    },
    variants: {
      groups: mockVariantsData.groups,
    },
    reviews: {
      reviews: mockReviewsData.reviews,
    },
    orderForm: {
      config: mockOrderFormData,
    },
  });

  // One memoized callback. Each section calls this with its slice key + new
  // values; the parent merges it into the single preview object.
  const handlePreviewChange = React.useCallback(
    <K extends keyof PreviewState>(slice: K, values: PreviewState[K]) =>
      setPreview((prev) => ({ ...prev, [slice]: values })),
    [],
  );

  return (
    <div className="flex flex-col">
      <EditWorkspaceHeader landing={landing} />

      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:gap-8">
          <EditSections
            preview={preview}
            onPreviewChange={handlePreviewChange}
          />
          <div className="hidden lg:block">
            <PreviewPanel preview={preview} />
          </div>
        </div>
      </div>
    </div>
  );
}
