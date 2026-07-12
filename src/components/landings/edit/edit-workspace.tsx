"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

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
import { EditWorkspaceHeader, type PublishStatus } from "./edit-workspace-header";
import { EditSections } from "./edit-sections";
import { PreviewPanel } from "./preview-panel";
import { PreviewDrawer } from "./preview-drawer";
import { PublishDialog } from "./publish-dialog";
import { LeaveWarningDialog } from "./leave-warning-dialog";

export function EditWorkspace({ landing }: { landing: LandingListItem }) {
  const router = useRouter();

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
    variants: { groups: mockVariantsData.groups },
    reviews: { reviews: mockReviewsData.reviews },
    orderForm: { config: mockOrderFormData },
  });

  // --- Publish lifecycle ---
  const [publishStatus, setPublishStatus] = React.useState<PublishStatus>("DRAFT");
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = React.useState(false);
  const [previewDrawerOpen, setPreviewDrawerOpen] = React.useState(false);

  // Ref that tracks whether the landing has been published. Used inside the
  // stable handlePreviewChange callback to set hasUnsavedChanges without
  // breaking the callback's memoization (which sections depend on).
  const publishedRef = React.useRef(false);

  // One memoized callback. After publishing, any change sets unsaved = true.
  const handlePreviewChange = React.useCallback(
    <K extends keyof PreviewState>(slice: K, values: PreviewState[K]) => {
      setPreview((prev) => ({ ...prev, [slice]: values }));
      if (publishedRef.current) {
        setHasUnsavedChanges(true);
      }
    },
    [],
  );

  // --- Publish / Update ---
  const handlePublishClick = () => setPublishDialogOpen(true);

  const handlePublishConfirm = () => {
    setPublishStatus("PUBLISHING");
    setPublishDialogOpen(false);
    // Mock publishing delay
    setTimeout(() => {
      setPublishStatus("PUBLISHED");
      setHasUnsavedChanges(false);
      publishedRef.current = true;
    }, 1500);
  };

  // --- Copy Link ---
  const handleCopyLink = () => {
    const url = `https://landing.local/${landing.slug}`;
    navigator.clipboard?.writeText(url);
  };

  // --- Open Landing ---
  const handleOpenLanding = () => {
    window.open(`/l/${landing.slug}`, "_blank");
  };

  // --- Back with warning ---
  const handleBack = () => {
    if (hasUnsavedChanges) {
      setLeaveDialogOpen(true);
    } else {
      router.push("/dashboard/landings");
    }
  };

  const handleLeaveConfirm = () => {
    setLeaveDialogOpen(false);
    router.push("/dashboard/landings");
  };

  return (
    <div className="flex flex-col">
      <EditWorkspaceHeader
        landing={landing}
        publishStatus={publishStatus}
        hasUnsavedChanges={hasUnsavedChanges}
        onPreview={() => setPreviewDrawerOpen(true)}
        onPublish={handlePublishClick}
        onCopyLink={handleCopyLink}
        onOpenLanding={handleOpenLanding}
        onBack={handleBack}
      />

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

      <PreviewDrawer
        open={previewDrawerOpen}
        onOpenChange={setPreviewDrawerOpen}
        preview={preview}
      />
      <PublishDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        isPublishing={publishStatus === "PUBLISHING"}
        isUpdate={publishStatus === "PUBLISHED"}
        onConfirm={handlePublishConfirm}
      />
      <LeaveWarningDialog
        open={leaveDialogOpen}
        onOpenChange={setLeaveDialogOpen}
        onConfirm={handleLeaveConfirm}
      />
    </div>
  );
}
