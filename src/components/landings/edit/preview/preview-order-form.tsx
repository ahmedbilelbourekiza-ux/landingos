"use client";

import type { PreviewState } from "@/types/preview";
import type { FieldKey } from "@/lib/landing/mock-order-form";

// Renders the purchase form inside the preview. Shows only visible fields,
// using their configured labels and placeholders. The submit button shows
// the configured button text.
const FIELD_ORDER: FieldKey[] = [
  "customerName",
  "phone",
  "wilaya",
  "baladia",
  "address",
  "notes",
  "quantity",
];

export function PreviewOrderForm({ preview }: { preview: PreviewState }) {
  const { config } = preview.orderForm;
  const visibleFields = FIELD_ORDER.filter((k) => config[k].visible);

  if (visibleFields.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t bg-muted/20 p-3">
      <span className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        Order Form
      </span>
      {visibleFields.map((key) => {
        const field = config[key];
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-medium text-foreground">
              {field.label || key}
              {field.required && <span className="ml-0.5 text-destructive">*</span>}
            </span>
            <span className="rounded border border-border bg-background px-1.5 py-1 text-[9px] text-muted-foreground/60">
              {field.placeholder || "—"}
            </span>
          </div>
        );
      })}
      {/* Submit button */}
      <span className="mt-1 inline-flex items-center justify-center rounded-md bg-foreground px-3 py-1.5 text-[10px] font-medium text-background">
        {config.buttonText || "Order Now"}
      </span>
    </div>
  );
}
