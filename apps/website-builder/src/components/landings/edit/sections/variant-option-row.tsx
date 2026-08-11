"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VariantOption } from "@/lib/landing/mock-landings";

// One sortable option row inside a variant group. The drag handle uses
// dnd-kit listeners; the label and extra-price inputs stop pointer events
// so they don't trigger a drag when the user clicks into them.
export function VariantOptionRow({
  option,
  index,
  currency,
  onChange,
  onRemove,
}: {
  option: VariantOption;
  index: number;
  currency: string;
  onChange: (id: string, patch: Partial<VariantOption>) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.id });
  const t = useTranslations();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card p-2",
        isDragging && "z-10 opacity-80 shadow-md",
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="grid size-7 shrink-0 cursor-grab place-items-center text-muted-foreground active:cursor-grabbing"
        aria-label={t("builder.editor.dragOption", { number: index + 1 })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Label */}
      <Input
        type="text"
        value={option.label}
        placeholder={t("builder.editor.optionLabelPlaceholder")}
        aria-label={t("builder.editor.optionLabelAria", { number: index + 1 })}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(option.id, { label: e.target.value })}
        className="h-8 flex-1"
      />

      {/* Extra price */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">+</span>
        <Input
          type="number"
          min="0"
          step="1"
          value={option.extraPrice || ""}
          placeholder="0"
          aria-label={t("builder.editor.optionPriceAria", { number: index + 1 })}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            onChange(option.id, {
              extraPrice: Math.max(0, Number(e.target.value) || 0),
            })
          }
          className="h-8 w-20"
        />
      </div>

      {/* Remove */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={t("builder.editor.removeOption", { number: index + 1 })}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(option.id)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
