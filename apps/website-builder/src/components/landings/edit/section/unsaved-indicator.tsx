"use client";

import { Dot } from "lucide-react";
import { useTranslations } from "next-intl";

// The amber dot + "Unsaved" label shown in a section header when the form
// has changes that haven't been saved. Extracted as its own component per
// the task spec, though it's rendered via SectionStatus in practice.
export function UnsavedIndicator() {
  const t = useTranslations();

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-500"
      role="status"
    >
      <Dot className="size-4 fill-amber-500 text-amber-500" aria-hidden />
      {t("builder.editor.unsaved")}
    </span>
  );
}
