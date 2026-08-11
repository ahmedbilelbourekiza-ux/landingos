"use client";

import * as React from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { VariantGroup, VariantOption } from "@/lib/landing/mock-landings";
import { VariantOptionRow } from "./variant-option-row";

const MAX_OPTIONS = 10;

// One variant group editor. Owns its own DndContext for option reordering —
// options only drag within their group, never across. The parent passes the
// group data + currency + callbacks; this component is presentational with
// local drag state only.
export function VariantGroupEditor({
  group,
  index,
  currency,
  onChange,
  onDelete,
}: {
  group: VariantGroup;
  index: number;
  currency: string;
  onChange: (id: string, patch: Partial<VariantGroup>) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = group.options.findIndex((o) => o.id === active.id);
    const newIndex = group.options.findIndex((o) => o.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(group.id, {
      options: arrayMove(group.options, oldIndex, newIndex),
    });
  };

  const addOption = () => {
    if (group.options.length >= MAX_OPTIONS) return;
    const newOption: VariantOption = {
      id: `opt-${Date.now()}`,
      label: "",
      extraPrice: 0,
    };
    onChange(group.id, { options: [...group.options, newOption] });
  };

  const updateOption = (optId: string, patch: Partial<VariantOption>) => {
    onChange(group.id, {
      options: group.options.map((o) =>
        o.id === optId ? { ...o, ...patch } : o,
      ),
    });
  };

  const removeOption = (optId: string) => {
    onChange(group.id, {
      options: group.options.filter((o) => o.id !== optId),
    });
  };

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      {/* Group header */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("builder.editor.groupLabel", { number: index + 1 })}</Label>
          <Input
            type="text"
            value={group.name}
            placeholder={t("builder.editor.groupNamePlaceholder")}
            aria-label={t("builder.editor.groupNameAria", { number: index + 1 })}
            onChange={(e) => onChange(group.id, { name: e.target.value })}
            className="h-8"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t("builder.editor.deleteGroup", { number: index + 1 })}
          onClick={() => onDelete(group.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={group.options.map((o) => o.id)}
            strategy={verticalListSortingStrategy}
          >
            {group.options.map((opt, i) => (
              <VariantOptionRow
                key={opt.id}
                option={opt}
                index={i}
                currency={currency}
                onChange={updateOption}
                onRemove={removeOption}
              />
            ))}
          </SortableContext>
        </DndContext>

        {group.options.length === 0 && (
          <p className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
            <AlertCircle className="size-3.5" />
            {t("builder.editor.optionNeeded")}
          </p>
        )}
      </div>

      {/* Add option */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={addOption}
        disabled={group.options.length >= MAX_OPTIONS}
      >
        <Plus className="size-3.5" />
        {t("builder.editor.addOption")}
        <span className="ms-auto text-xs text-muted-foreground">
          {group.options.length}/{MAX_OPTIONS}
        </span>
      </Button>
    </div>
  );
}
