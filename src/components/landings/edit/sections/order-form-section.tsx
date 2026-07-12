"use client";

import * as React from "react";
import { ShoppingCart } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  mockOrderFormData,
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

// The preview values the Order Form section lifts to the parent: the full
// config object. The preview renders the form with the configured fields.
export interface OrderFormPreviewValues {
  config: OrderFormConfig;
}

export function OrderFormSection({
  onPreviewChange,
}: {
  onPreviewChange: (values: OrderFormPreviewValues) => void;
}) {
  const section = useSectionState();
  const [config, setConfig] = React.useState<OrderFormConfig>(mockOrderFormData);

  // --- Lift preview values to parent ---
  React.useEffect(() => {
    onPreviewChange({ config });
  }, [config, onPreviewChange]);

  // --- Update a single field ---
  const updateField = (key: FieldKey, patch: Partial<OrderFormField>) => {
    setConfig((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    section.markDirty();
  };

  // --- Update button text ---
  const updateButtonText = (text: string) => {
    setConfig((prev) => ({ ...prev, buttonText: text }));
    section.markDirty();
  };

  // --- Save / Cancel ---
  const handleCancel = () => {
    setConfig(mockOrderFormData);
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
        {/* Field editors */}
        {FIELD_DEFS.map((def) => (
          <OrderFormFieldEditor
            key={def.key}
            fieldKey={def.key}
            displayName={def.displayName}
            field={config[def.key]}
            onChange={updateField}
          />
        ))}

        {/* Purchase button text */}
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
