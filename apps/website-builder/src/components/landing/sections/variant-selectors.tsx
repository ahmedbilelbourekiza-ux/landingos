"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";

// One segmented control per variant group. Each option is a button; the
// selected option gets a solid fill. Extra-price adjustments shown inline.
export function VariantSelectors({
  store,
  currency,
}: {
  store: LandingOrderStore;
  currency: string;
}) {
  const groups = store((s) => s.groups);
  const selected = store((s) => s.selected);
  const select = store((s) => s.select);

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      {groups.map((group) => (
        <fieldset key={group.name}>
          <legend className="mb-2 text-sm font-medium">{group.name}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={group.name}>
            {group.options.map((option) => {
              const isSelected = selected[group.name] === option.value;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => select(group.name, option.value)}
                  style={isSelected ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-primary-foreground)", borderColor: "var(--theme-primary)" } : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isSelected
                      ? ""
                      : "border-border bg-background hover:border-foreground/40 hover:bg-accent/50",
                  )}
                >
                  {isSelected && <Check className="size-3.5" aria-hidden />}
                  <span>{option.value}</span>
                  {option.extraPrice > 0 && (
                    <span
                      className={cn(
                        "text-xs",
                        isSelected ? "text-background/70" : "text-muted-foreground",
                      )}
                    >
                      +{formatPrice(option.extraPrice, currency)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
