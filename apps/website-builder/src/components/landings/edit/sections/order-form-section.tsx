"use client";

import * as React from "react";
import { ShoppingCart } from "lucide-react";
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

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FIELD_DEFS,
  normalizeOrder,
  type OrderFormConfig,
  type OrderFormField,
  type FieldKey,
} from "@/lib/landing/mock-order-form";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { OrderFormFieldEditor } from "./order-form-field-editor";

export interface OrderFormPreviewValues {
  config: OrderFormConfig;
}

export function OrderFormSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: OrderFormPreviewValues;
  onPreviewChange: (values: OrderFormPreviewValues) => void;
}) {
  const [config, setConfig] = React.useState<OrderFormConfig>(initialValues.config);

  const section = useSectionState({
    save: async () => {
      const res = await fetch(`/api/landings/${landingId}/order-form`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });

  React.useEffect(() => {
    onPreviewChange({ config });
  }, [config, onPreviewChange]);

  const updateField = (key: FieldKey, patch: Partial<OrderFormField>) => {
    setConfig((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    section.markDirty();
  };

  const updateButtonText = (text: string) => {
    setConfig((prev) => ({ ...prev, buttonText: text }));
    section.markDirty();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Normalized rather than read raw: a config saved before ordering existed
  // has no `order`, and one saved before a field was added would omit it.
  // normalizeOrder guarantees every field appears exactly once, so the list
  // below can never drop or duplicate a row.
  const fieldOrder = React.useMemo(() => normalizeOrder(config.order), [config.order]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setConfig((prev) => {
      const current = normalizeOrder(prev.order);
      const oldIndex = current.indexOf(active.id as FieldKey);
      const newIndex = current.indexOf(over.id as FieldKey);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return { ...prev, order: arrayMove(current, oldIndex, newIndex) };
    });
    section.markDirty();
  };

  // Display names come from FIELD_DEFS; the render order comes from the
  // config. Kept as a lookup so reordering never has to touch the metadata.
  const displayNames = React.useMemo(
    () => Object.fromEntries(FIELD_DEFS.map((d) => [d.key, d.displayName])) as Record<FieldKey, string>,
    [],
  );

  const handleCancel = () => {
    setConfig(initialValues.config);
    section.reset();
  };

  return (
    <SectionShell
      id="order-form"
      title="Order Form"
      description="Configure the purchase form fields."
      icon={ShoppingCart}
      state={section.state}
      onSave={section.save}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-muted-foreground">
          Drag the handle to reorder. Fields appear on the storefront form in
          this order, top to bottom.
        </p>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={fieldOrder} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3">
              {fieldOrder.map((key) => (
                <OrderFormFieldEditor
                  key={key}
                  fieldKey={key}
                  displayName={displayNames[key]}
                  field={config[key]}
                  onChange={updateField}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="rounded-xl border bg-muted/20 p-3">
          <Label className="text-xs text-muted-foreground">
            Purchase Button Text
          </Label>
          <Input
            type="text"
            value={config.buttonText}
            dir="auto"
            placeholder="اطلب الآن"
            onChange={(e) => updateButtonText(e.target.value)}
            className="mt-1.5 h-9"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Shown on the submit button at the bottom of the form.
          </p>
        </div>
      </div>
    </SectionShell>
  );
}
