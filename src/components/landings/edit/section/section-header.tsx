"use client";

import type { LucideIcon } from "lucide-react";

import { SectionStatus } from "./section-status";
import type { SectionStatus as StatusValue } from "./use-section-state";

// Section header with the status indicator. Wraps the title/description/icon
// from Task 6's EditSectionCard pattern and adds a live status badge on the
// right. The status is the only dynamic part — title/description are static
// per section.
export function SectionHeader({
  id,
  title,
  description,
  icon: Icon,
  status,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  status: StatusValue;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b px-6 py-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/40 text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="shrink-0 pt-1">
        <SectionStatus status={status} />
      </div>
    </header>
  );
}
