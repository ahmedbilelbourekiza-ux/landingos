"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";

// One segmented control per variant group (e.g. Size, Formula). Each option
// is a button in a wrapping flex row; the selected option gets a solid fill.
// Extra-price adjustments are shown inline so the user sees the cost impact
// before committing. State lives in the shared order store so the order
// summary updates instantly on selection.
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
    <div className="flex flex-col gap-4">
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
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isSelected
                      ? "border-foreground bg-foreground text-background"
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
