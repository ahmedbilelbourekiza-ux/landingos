"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import type { PreviewState } from "@/types/preview";
import { EditWorkspaceHeader, type PublishStatus } from "./edit-workspace-header";
import { EditSections } from "./edit-sections";
import { PreviewPanel } from "./preview-panel";
import { PreviewDrawer } from "./preview-drawer";
import { PublishDialog } from "./publish-dialog";
import { LeaveWarningDialog } from "./leave-warning-dialog";

export function EditWorkspace({
  landingId,
  landingTitle,
  landingSlug,
  initialPreview,
  initialStatus,
}: {
  landingId: string;
  landingTitle: string;
  landingSlug: string;
  initialPreview: PreviewState;
  initialStatus: PublishStatus;
}) {
  const router = useRouter();

  const [preview, setPreview] = React.useState<PreviewState>(initialPreview);
  const [publishStatus, setPublishStatus] = React.useState<PublishStatus>(initialStatus);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = React.useState(false);
  const [previewDrawerOpen, setPreviewDrawerOpen] = React.useState(false);

  const publishedRef = React.useRef(initialStatus === "PUBLISHED");

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
  const handlePublishConfirm = async () => {
    setPublishStatus("PUBLISHING");
    setPublishDialogOpen(false);
    try {
      const res = await fetch(`/api/landings/${landingId}/publish`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setPublishStatus("PUBLISHED");
        setHasUnsavedChanges(false);
        publishedRef.current = true;
      } else {
        setPublishStatus(publishedRef.current ? "PUBLISHED" : "DRAFT");
      }
    } catch {
      setPublishStatus(publishedRef.current ? "PUBLISHED" : "DRAFT");
    }
  };

  // --- Copy Link ---
  const handleCopyLink = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    navigator.clipboard?.writeText(`${origin}/l/${landingSlug}`);
  };

  // --- Open Landing ---
  const handleOpenLanding = () => {
    window.open(`/l/${landingSlug}`, "_blank");
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
        landingTitle={landingTitle}
        publishStatus={publishStatus}
        hasUnsavedChanges={hasUnsavedChanges}
        onPreview={() => setPreviewDrawerOpen(true)}
        onPublish={() => setPublishDialogOpen(true)}
        onCopyLink={handleCopyLink}
        onOpenLanding={handleOpenLanding}
        onBack={handleBack}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:gap-8">
          <EditSections
            preview={preview}
            onPreviewChange={handlePreviewChange}
            landingId={landingId}
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
