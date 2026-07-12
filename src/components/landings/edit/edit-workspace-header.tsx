"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  Globe,
  Loader2,
  Link2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LandingListItem } from "@/lib/landing/mock-landings";

export type PublishStatus = "DRAFT" | "PUBLISHING" | "PUBLISHED";

// Sticky workspace header with the full publish lifecycle. The back button
// warns before leaving if there are unsaved changes. Preview opens the
// drawer. Publish/Update triggers the confirmation dialog. After publishing,
// Copy Link and Open Landing buttons appear.
export function EditWorkspaceHeader({
  landing,
  publishStatus,
  hasUnsavedChanges,
  onPreview,
  onPublish,
  onCopyLink,
  onOpenLanding,
  onBack,
}: {
  landing: LandingListItem;
  publishStatus: PublishStatus;
  hasUnsavedChanges: boolean;
  onPreview: () => void;
  onPublish: () => void;
  onCopyLink: () => void;
  onOpenLanding: () => void;
  onBack: () => void;
}) {
  const isPublished = publishStatus === "PUBLISHED";
  const isPublishing = publishStatus === "PUBLISHING";

  return (
    <header className="sticky top-16 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      {/* Left: back + title + status */}
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Back to Landing Pages"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className="truncate text-sm font-medium">{landing.title}</span>
        <PublishStatusBadge status={publishStatus} />
        {hasUnsavedChanges && (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-500"
          >
            <AlertCircle className="mr-1 size-3" />
            Unsaved Changes
          </Badge>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPreview}>
          <Eye className="size-4" />
          <span className="hidden sm:inline">Preview</span>
        </Button>

        {isPublished && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onCopyLink}
              className="hidden md:inline-flex"
            >
              <Link2 className="size-4" />
              <span className="hidden lg:inline">Copy Link</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenLanding}
              className="hidden md:inline-flex"
            >
              <ExternalLink className="size-4" />
              <span className="hidden lg:inline">Open</span>
            </Button>
          </>
        )}

        <Button size="sm" onClick={onPublish} disabled={isPublishing}>
          {isPublishing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Globe className="size-4" />
          )}
          <span className="hidden sm:inline">
            {isPublishing
              ? "Publishing..."
              : isPublished
                ? "Update"
                : "Publish"}
          </span>
        </Button>
      </div>
    </header>
  );
}

function PublishStatusBadge({ status }: { status: PublishStatus }) {
  if (status === "DRAFT") {
    return (
      <Badge variant="outline" className="gap-1.5 border-transparent bg-muted text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        Draft
      </Badge>
    );
  }
  if (status === "PUBLISHING") {
    return (
      <Badge variant="outline" className="gap-1.5 border-transparent bg-muted text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Publishing...
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    >
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Published
    </Badge>
  );
}
