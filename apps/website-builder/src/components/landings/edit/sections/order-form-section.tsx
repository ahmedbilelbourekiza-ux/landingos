"use client";

import * as React from "react";
import { ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
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
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { OrderFormFieldEditor } from "./order-form-field-editor";
import { useBuilderApi } from "@/lib/builder/api-base";

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
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const t = useTranslations();
  const [config, setConfig] = React.useState<OrderFormConfig>(initialValues.config);

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/order-form`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      refuseIfFailed(json);
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

  // Display names come from FIELD_DEFS' catalogue keys; the render order comes
  // from the config. Kept as a lookup so reordering never has to touch the
  // metadata, and resolved here so the row component takes a finished string.
  const displayNames = React.useMemo(
    () => Object.fromEntries(FIELD_DEFS.map((d) => [d.key, t(d.nameKey)])) as Record<FieldKey, string>,
    [t],
  );

  const handleCancel = () => {
    setConfig(initialValues.config);
    section.reset();
  };

  return (
    <SectionShell
      id="order-form"
      title={t("builder.editor.orderForm")}
      description={t("builder.editor.orderFormDesc")}
      icon={ShoppingCart}
      state={section.state}
      onSave={section.save}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-muted-foreground">
          {t("builder.editor.orderFormHint")}
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
            {t("builder.editor.orderButtonLabel")}
          </Label>
          <Input
            type="text"
            value={config.buttonText}
            dir="auto"
            placeholder={t("builder.editor.orderButtonPlaceholder")}
            onChange={(e) => updateButtonText(e.target.value)}
            className="mt-1.5 h-9"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t("builder.editor.orderButtonHint")}
          </p>
        </div>
      </div>
    </SectionShell>
  );
}
