"use client";

import { cn } from "@/lib/utils";
import type { LandingPageStatus } from "@/types/landing";

export type FilterValue = "ALL" | LandingPageStatus;

// Segmented filter row. Each tab shows its label plus a count, so the admin
// sees at a glance how many pages sit in each state without switching. The
// active tab gets a solid underline rather than a fill — lighter, matches
// the Linear/Vercel dashboard idiom better than a filled pill.
const TABS: { value: FilterValue; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
];

export function FilterTabs({
  value,
  counts,
  onChange,
}: {
  value: FilterValue;
  counts: Record<FilterValue, number>;
  onChange: (value: FilterValue) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto"
      role="tablist"
      aria-label="Filter landing pages by status"
    >
      {TABS.map((tab) => {
        const isActive = value === tab.value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] tabular-nums",
                  isActive
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {counts[tab.value]}
              </span>
            </span>
            {isActive && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-foreground" />
            )}
          </button>
        );
      })}
    </div>
  );
}
