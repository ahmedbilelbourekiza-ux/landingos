"use client";

import { Eye, EyeOff, Asterisk, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { OrderFormField, FieldKey } from "@/lib/landing/mock-order-form";

// One field's configuration row. Controls visibility (Enable/Disable),
// required flag, label, and placeholder. When not visible, the row dims
// to signal the field won't appear on the form.
//
// Sortable: the row's vertical position is the field's position on the
// storefront form. Only the grip is draggable, not the whole row — the row
// contains text inputs and switches, and making it all a drag surface would
// make selecting text inside a label impossible.
export function OrderFormFieldEditor({
  fieldKey,
  displayName,
  field,
  onChange,
}: {
  fieldKey: FieldKey;
  displayName: string;
  field: OrderFormField;
  onChange: (key: FieldKey, patch: Partial<OrderFormField>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: fieldKey });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border bg-card p-3 transition-opacity",
        !field.visible && "opacity-50",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      {/* Header row: name + toggles */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            aria-label={`Reorder ${displayName}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="text-sm font-medium">{displayName}</span>
        </span>
        <div className="flex items-center gap-4">
          {/* Required toggle */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              checked={field.required}
              onCheckedChange={(v) => onChange(fieldKey, { required: v })}
              disabled={!field.visible}
              className="scale-75"
              aria-label={`${displayName} required`}
            />
            <span className="flex items-center gap-0.5">
              <Asterisk className="size-3" />
              Required
            </span>
          </label>
          {/* Visible toggle */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              checked={field.visible}
              onCheckedChange={(v) => onChange(fieldKey, { visible: v })}
              className="scale-75"
              aria-label={`${displayName} visible`}
            />
            {field.visible ? (
              <Eye className="size-3.5" />
            ) : (
              <EyeOff className="size-3.5" />
            )}
          </label>
        </div>
      </div>

      {/* Label + Placeholder inputs */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Label</Label>
          <Input
            type="text"
            value={field.label}
            placeholder="Field label"
            onChange={(e) => onChange(fieldKey, { label: e.target.value })}
            className="h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Placeholder</Label>
          <Input
            type="text"
            value={field.placeholder}
            placeholder="Field placeholder"
            onChange={(e) => onChange(fieldKey, { placeholder: e.target.value })}
            className="h-8"
          />
        </div>
      </div>
    </div>
  );
}
