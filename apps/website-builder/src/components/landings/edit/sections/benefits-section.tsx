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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Sparkles, Plus, AlertCircle, GripVertical, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BENEFIT_ICONS, DEFAULT_BENEFIT_ICON } from "@/lib/landing/benefit-icons";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { useBuilderApi } from "@/lib/builder/api-base";

/* The Benefits section — LB.12, replacing the "Coming Soon" stub.
 *
 * Mirrors the Reviews section's shape exactly: local list state, dnd-kit
 * ordering where the array order IS the display order, replace-all PUT on
 * save. The icon is a KEY from the curated set in lib/landing/benefit-icons —
 * the same map the storefront renders from, so the picker cannot offer an
 * icon the page cannot draw. */

export interface BenefitItem {
  id: string;
  icon: string;
  title: string;
  description: string | null;
}

export interface BenefitsPreviewValues {
  benefits: BenefitItem[];
}

const MAX_BENEFITS = 12;

function BenefitRow({
  benefit,
  onChange,
  onRemove,
}: {
  benefit: BenefitItem;
  onChange: (id: string, patch: Partial<BenefitItem>) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: benefit.id });
  const Icon = BENEFIT_ICONS[benefit.icon] ?? BENEFIT_ICONS[DEFAULT_BENEFIT_ICON];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-3",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Reorder benefit"
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
          <Icon className="size-4" aria-hidden />
        </span>
        <select
          aria-label="Benefit icon"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={benefit.icon in BENEFIT_ICONS ? benefit.icon : DEFAULT_BENEFIT_ICON}
          onChange={(e) => onChange(benefit.id, { icon: e.target.value })}
        >
          {Object.keys(BENEFIT_ICONS).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove benefit"
          className="ml-auto text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(benefit.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <Input
        aria-label="Benefit title"
        placeholder="e.g. Free 30-day returns"
        value={benefit.title}
        onChange={(e) => onChange(benefit.id, { title: e.target.value })}
      />
      <Input
        aria-label="Benefit description (optional)"
        placeholder="Optional detail shown under the title"
        value={benefit.description ?? ""}
        onChange={(e) =>
          onChange(benefit.id, { description: e.target.value || null })
        }
      />
    </div>
  );
}

export function BenefitsSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: BenefitsPreviewValues;
  onPreviewChange: (values: BenefitsPreviewValues) => void;
}) {
  const api = useBuilderApi();
  const [benefits, setBenefits] = React.useState<BenefitItem[]>(initialValues.benefits);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const section = useSectionState({
    save: async () => {
      // Array order IS the display order; the route assigns it from position.
      const payload = benefits.map((b) => ({
        icon: b.icon,
        title: b.title,
        description: b.description,
      }));
      const res = await fetch(api(`/landings/${landingId}/features`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const json = await res.json();
      refuseIfFailed(json);
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  React.useEffect(() => {
    onPreviewChange({ benefits });
  }, [benefits, onPreviewChange]);

  const addBenefit = () => {
    if (benefits.length >= MAX_BENEFITS) return;
    setBenefits((prev) => [
      ...prev,
      { id: `ben-${Date.now()}`, icon: DEFAULT_BENEFIT_ICON, title: "", description: null },
    ]);
    section.markDirty();
  };

  const updateBenefit = (id: string, patch: Partial<BenefitItem>) => {
    setBenefits((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    section.markDirty();
  };

  const removeBenefit = (id: string) => {
    setBenefits((prev) => prev.filter((b) => b.id !== id));
    section.markDirty();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBenefits((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id);
      const newIndex = prev.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    section.markDirty();
  };

  const handleSave = async () => {
    for (const b of benefits) {
      if (!b.title.trim()) {
        setValidationError("Every benefit needs a title.");
        return;
      }
    }
    setValidationError(null);
    await section.save();
  };

  const handleCancel = () => {
    setBenefits(initialValues.benefits);
    setValidationError(null);
    section.reset();
  };

  return (
    <SectionShell
      id="benefits"
      title="Benefits"
      description="Trust badges and key selling points."
      icon={Sparkles}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        {validationError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        {benefits.length === 0 && (
          <div className="flex items-center justify-center rounded-xl border border-dashed py-8 text-sm text-muted-foreground">
            No custom benefits yet — the page shows the four standard COD badges until you add your own.
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={benefits.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {benefits.map((benefit) => (
              <BenefitRow
                key={benefit.id}
                benefit={benefit}
                onChange={updateBenefit}
                onRemove={removeBenefit}
              />
            ))}
          </SortableContext>
        </DndContext>

        <Button
          type="button"
          variant="outline"
          onClick={addBenefit}
          disabled={benefits.length >= MAX_BENEFITS}
          className="w-full"
        >
          <Plus className="size-4" />
          Add Benefit
          <span className="ml-auto text-xs text-muted-foreground">
            {benefits.length}/{MAX_BENEFITS}
          </span>
        </Button>
      </div>
    </SectionShell>
  );
}
