"use client";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/landing/format";
import type { PreviewState } from "@/types/preview";
import { useTranslations } from "next-intl";

// Variant selectors. Renders one group at a time with the first option
// highlighted as selected (matching the public landing template's default
// selection behavior).
export function PreviewVariants({ preview }: { preview: PreviewState }) {
  const t = useTranslations();
  const { variants, pricing } = preview;
  if (variants.groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      {variants.groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.name || t("builder.editor.previewUnnamedGroup")}
          </span>
          <div className="flex flex-wrap gap-1">
            {group.options.map((opt, i) => (
              <span
                key={opt.id}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  i === 0
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground",
                )}
              >
                {opt.label || "—"}
                {opt.extraPrice > 0 && (
                  <span className={cn("ml-0.5", i === 0 ? "text-background/70" : "")}>
                    +{formatPrice(opt.extraPrice, pricing.currency)}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
