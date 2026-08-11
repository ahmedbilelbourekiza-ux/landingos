"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations();

  return (
    <div
      className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
      role="radiogroup"
      aria-label={t("builder.editor.device")}
    >
      {(
        [
          { value: "desktop", labelKey: "builder.editor.deviceDesktop", icon: Monitor },
          { value: "mobile", labelKey: "builder.editor.deviceMobile", icon: Smartphone },
        ] as const
      ).map(({ value: v, labelKey, icon: Icon }) => {
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
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
