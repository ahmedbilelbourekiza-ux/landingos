"use client";

import { Monitor, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";

export type PreviewDevice = "desktop" | "mobile";

// Segmented toggle between desktop and mobile preview frames. Pure
// presentational control — the selected device is owned by the parent
// PreviewPanel, which swaps the placeholder accordingly.
export function PreviewDeviceToggle({
  value,
  onChange,
}: {
  value: PreviewDevice;
  onChange: (value: PreviewDevice) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
      role="radiogroup"
      aria-label="Preview device"
    >
      {(
        [
          { value: "desktop", label: "Desktop", icon: Monitor },
          { value: "mobile", label: "Mobile", icon: Smartphone },
        ] as const
      ).map(({ value: v, label, icon: Icon }) => {
        const isActive = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(v)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
