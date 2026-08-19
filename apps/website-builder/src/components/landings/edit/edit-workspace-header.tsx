"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Eye,
  Globe,
  History,
  Loader2,
  Link2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type PublishStatus = "DRAFT" | "PUBLISHING" | "PUBLISHED";

// Sticky workspace header with the full publish lifecycle. The back button
// warns before leaving if there are unsaved changes. Preview opens the
// drawer. Publish/Update triggers the confirmation dialog. After publishing,
// Copy Link and Open Landing buttons appear.
export function EditWorkspaceHeader({
  landingTitle,
  publishStatus,
  hasUnsavedChanges,
  onPreview,
  onHistory,
  onPublish,
  onCopyLink,
  onOpenLanding,
  onBack,
}: {
  landingTitle: string;
  publishStatus: PublishStatus;
  hasUnsavedChanges: boolean;
  onPreview: () => void;
  onHistory: () => void;
  onPublish: () => void;
  onCopyLink: () => void;
  onOpenLanding: () => void;
  onBack: () => void;
}) {
  const t = useTranslations();
  const isPublished = publishStatus === "PUBLISHED";
  const isPublishing = publishStatus === "PUBLISHING";
  const publishLabel = isPublishing
    ? t("builder.editor.publishing")
    : isPublished
      ? t("builder.editor.update")
      : t("builder.editor.publish");

  return (
    /* `top-0`, not `top-16`. The 64px offset compensated for a console shell
       header that is NOT above this screen: the editor is deliberately mounted
       OUTSIDE ConsoleShell (its page comment says so, and the shell lives in
       the `(shell)` route group this route is not in), so the workspace header
       is the first child of the page and its natural flow position is 0.
       Offsetting it to 64 while the content below flowed from 56 left a
       permanent 64px band in which the header painted over content, plus dead
       space above it that belonged to nobody — measured before the fix at
       every scroll position. `scroll-mt-24` on the section cards corroborates
       it: 96px clears a header ending at 56, never one ending at 120. */
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      {/* Left: back + title + status */}
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t("builder.editor.back")}
          onClick={onBack}
        >
          {/* Mirrored in RTL: "back" points where the reader came from. The
              variant is real and dir-keyed since LB.28 (globals.css) — the
              LB.13 comment this replaces believed it dead, having verified a
              class no source file generated. */}
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
        </Button>
        <span className="truncate text-sm font-medium">{landingTitle}</span>
        <PublishStatusBadge status={publishStatus} />
        {hasUnsavedChanges && (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-500"
          >
            {/* `mr-1` was a physical margin in an app that flips: in Arabic it
                pushed the icon AWAY from its label. `me-1` is the logical
                edge and reads correctly both ways. */}
            <AlertCircle className="me-1 size-3" />
            {t("builder.editor.unsavedChanges")}
          </Badge>
        )}
      </div>

      {/* Right: actions. Below `sm` the labels yield to icons — the mobile
          audit found the two icons carried NO accessible name, so the money
          action (publish) was an anonymous globe. The aria-labels are
          unconditional; sighted users at `sm+` read the visible text. */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t("builder.editor.preview")}
          onClick={onPreview}
        >
          <Eye className="size-4" />
          <span className="hidden sm:inline">{t("builder.editor.preview")}</span>
        </Button>

        {/* LB.14b — the way back. Sits beside Preview because both are ways of
            LOOKING at the page rather than changing it; restoring is behind a
            confirmation inside the dialog. Icon-only below `sm` with an
            unconditional aria-label, the same rule the mobile audit imposed on
            the two buttons either side of it. */}
        <Button
          variant="outline"
          size="sm"
          aria-label={t("builder.editor.history")}
          onClick={onHistory}
        >
          <History className="size-4" />
          <span className="hidden lg:inline">{t("builder.editor.history")}</span>
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
              <span className="hidden lg:inline">{t("builder.editor.copyLink")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenLanding}
              className="hidden md:inline-flex"
            >
              <ExternalLink className="size-4" />
              <span className="hidden lg:inline">{t("builder.editor.open")}</span>
            </Button>
          </>
        )}

        <Button
          size="sm"
          aria-label={publishLabel}
          onClick={onPublish}
          disabled={isPublishing}
        >
          {isPublishing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Globe className="size-4" />
          )}
          <span className="hidden sm:inline">{publishLabel}</span>
        </Button>
      </div>
    </header>
  );
}

/* Draft and Published are the LandingPage status vocabulary, so they read from
 * `status.landingPage.*` — the same keys the pages list's StatusPill uses. A
 * second wording of "Published" in the editor would let the two screens
 * disagree about the same row. PUBLISHING is transient and belongs to the
 * editor alone, so it keeps its own key. */
function PublishStatusBadge({ status }: { status: PublishStatus }) {
  const t = useTranslations();

  if (status === "DRAFT") {
    return (
      <Badge variant="outline" className="gap-1.5 border-transparent bg-muted text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        {t("status.landingPage.draft")}
      </Badge>
    );
  }
  if (status === "PUBLISHING") {
    return (
      <Badge variant="outline" className="gap-1.5 border-transparent bg-muted text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {t("builder.editor.publishing")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    >
      <span className="size-1.5 rounded-full bg-emerald-500" />
      {t("status.landingPage.published")}
    </Badge>
  );
}
