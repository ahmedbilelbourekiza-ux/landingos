"use client";

import { Loader2, Check, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { UnsavedIndicator } from "./unsaved-indicator";
import type { SectionStatus } from "./use-section-state";

// Status indicator rendered in the section header. Each state has its own
// visual treatment so the admin can tell at a glance whether a section is
// clean, being saved, succeeded, or failed. `idle` renders nothing — the
// absence of a badge IS the "all good" signal.
export function SectionStatus({ status }: { status: SectionStatus }) {
  const t = useTranslations();

  switch (status) {
    case "dirty":
      return <UnsavedIndicator />;
    case "saving":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t("common.saving")}
        </span>
      );
    case "saved":
      return (
        <span
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-500"
          role="status"
          aria-live="polite"
        >
          <Check className="size-3.5" aria-hidden />
          {t("common.saved")}
        </span>
      );
    case "error":
      return (
        <span
          className="inline-flex items-center gap-1 text-xs font-medium text-destructive"
          role="status"
          aria-live="assertive"
        >
          <AlertCircle className="size-3.5" aria-hidden />
          {t("builder.editor.failed")}
        </span>
      );
    case "idle":
    default:
      return null;
  }
}
