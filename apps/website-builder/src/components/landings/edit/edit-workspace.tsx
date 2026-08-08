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
import { useBuilderApi } from "@/lib/builder/api-base";

export function EditWorkspace({
  landingId,
  landingTitle,
  landingSlug,
  publicPath,
  initialPreview,
  initialStatus,
  initialSeo,
}: {
  landingId: string;
  landingTitle: string;
  landingSlug: string;
  /**
   * The page's PUBLIC path on this platform, e.g. `/acme/winter-jacket`.
   * Supplied by the server mount — the legacy `/l/<slug>` this component used
   * to build is a reserved-slug 404 here, so Copy Link handed the merchant a
   * dead URL to their own page (LB.2).
   */
  publicPath: string;
  initialPreview: PreviewState;
  initialStatus: PublishStatus;
  initialSeo: { seoTitle: string; seoDescription: string };
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const router = useRouter();

  const [preview, setPreview] = React.useState<PreviewState>(initialPreview);
  const [publishStatus, setPublishStatus] = React.useState<PublishStatus>(initialStatus);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = React.useState(false);
  const [previewDrawerOpen, setPreviewDrawerOpen] = React.useState(false);

  const publishedRef = React.useRef(initialStatus === "PUBLISHED");

  // Every section lifts its initial values to this workspace in a mount
  // effect, so the first render produces one handlePreviewChange call PER
  // SECTION before anybody has touched anything — which marked every
  // published page "Unsaved Changes" the moment it opened. Child effects run
  // before this parent effect on mount, so arming here means the mount-time
  // lifts pass through unarmed and the first REAL edit is the first one
  // counted.
  const armedRef = React.useRef(false);
  React.useEffect(() => {
    armedRef.current = true;
  }, []);

  const handlePreviewChange = React.useCallback(
    <K extends keyof PreviewState>(slice: K, values: PreviewState[K]) => {
      setPreview((prev) => ({ ...prev, [slice]: values }));
      if (armedRef.current && publishedRef.current) {
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
      const res = await fetch(api(`/landings/${landingId}/publish`), { method: "POST" });
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
    navigator.clipboard?.writeText(`${origin}${publicPath}`);
  };

  // --- Open Landing ---
  const handleOpenLanding = () => {
    window.open(publicPath, "_blank");
  };

  // --- Back with warning ---
  const handleBack = () => {
    if (hasUnsavedChanges) {
      setLeaveDialogOpen(true);
    } else {
      // The console list — the legacy /dashboard/landings this pushed to was
      // deleted in 4.5 and now 404s as a reserved slug (LB.6).
      router.push("/console/builder/pages");
    }
  };

  const handleLeaveConfirm = () => {
    setLeaveDialogOpen(false);
    router.push("/console/builder/pages");
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
            initialSeo={initialSeo}
          />
          <div className="hidden lg:block">
            <PreviewPanel
              preview={preview}
              publicPath={publicPath}
              isPublished={publishStatus === "PUBLISHED"}
            />
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
