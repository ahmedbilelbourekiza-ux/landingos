"use client";

import * as React from "react";
import { ShoppingCart } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FIELD_DEFS,
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
        {FIELD_DEFS.map((def) => (
          <OrderFormFieldEditor
            key={def.key}
            fieldKey={def.key}
            displayName={def.displayName}
            field={config[def.key]}
            onChange={updateField}
          />
        ))}

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
