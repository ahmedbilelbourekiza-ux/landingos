"use client";

import * as React from "react";
import { Truck, Store, BadgePercent, AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import type { ShippingPreviewValues } from "@/types/preview";
import { useBuilderApi } from "@/lib/builder/api-base";

// Which shipping methods this product offers.
//
// Two independent toggles rather than a three-way Home/Desk/Both radio: "both"
// is not a third option, it is both of the two. Modelling it as a radio would
// mean re-deriving the flags on every read, and a third carrier later would
// need five radio options instead of one more checkbox.
//
// Per-wilaya prices for both methods are configured globally in Delivery
// Prices, not here — this only decides which methods this product offers.

const METHODS = [
  {
    key: "homeDeliveryEnabled" as const,
    icon: Truck,
    title: "Home Delivery",
    subtitle: "Domicile",
    description: "Courier delivers to the customer's address.",
  },
  {
    key: "stopDeskEnabled" as const,
    icon: Store,
    title: "Stop Desk",
    subtitle: "Bureau",
    description: "Customer collects from the carrier's office. Usually cheaper.",
  },
];

export function ShippingSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: ShippingPreviewValues;
  onPreviewChange: (values: ShippingPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const [values, setValues] = React.useState<ShippingPreviewValues>(initialValues);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/shipping`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });

  React.useEffect(() => {
    onPreviewChange(values);
  }, [values, onPreviewChange]);

  const toggle = (key: keyof ShippingPreviewValues) => {
    setValues((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Blocked in the UI as well as the API: turning the last method off
      // would leave a product no customer could order, and catching it on the
      // click explains why instead of failing on save. `freeShipping` is not
      // a method — free-of-charge is still delivered — so it never trips this.
      if (!next.homeDeliveryEnabled && !next.stopDeskEnabled) {
        setValidationError("At least one shipping method must stay enabled.");
        return prev;
      }
      setValidationError(null);
      return next;
    });
    section.markDirty();
  };

  const handleCancel = () => {
    setValues(initialValues);
    setValidationError(null);
    section.reset();
  };

  const enabledCount = Number(values.homeDeliveryEnabled) + Number(values.stopDeskEnabled);

  return (
    <SectionShell
      id="shipping"
      title="Shipping"
      description="Home delivery, stop desk, or both."
      icon={Truck}
      state={section.state}
      onSave={section.save}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        {validationError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        {/* CAPABILITY_AUDIT B2 — the checkout has zeroed the delivery charge
            on this flag since the port; this switch is the half that was
            missing. Separate from METHODS: free is a price, not a method. */}
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
            values.freeShipping ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
          )}
        >
          <input
            type="checkbox"
            checked={values.freeShipping}
            onChange={() => toggle("freeShipping")}
            className="mt-1 size-4 accent-primary"
          />
          <BadgePercent
            className={cn(
              "mt-0.5 size-4 shrink-0",
              values.freeShipping ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              Free shipping{" "}
              <span className="text-xs font-normal text-muted-foreground">· Livraison gratuite</span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              The customer pays no delivery charge — checkout totals exclude it.
            </span>
          </span>
        </label>

        {METHODS.map((method) => {
          const checked = values[method.key];
          const Icon = method.icon;
          return (
            <label
              key={method.key}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                checked ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(method.key)}
                className="mt-1 size-4 accent-primary"
              />
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  checked ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {method.title}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {method.subtitle}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {method.description}
                </span>
              </span>
            </label>
          );
        })}

        <p className="text-[11px] text-muted-foreground">
          {enabledCount === 1
            ? "Only one method is enabled, so checkout skips the selector and uses it automatically."
            : "Customers choose between both methods at checkout."}{" "}
          Stop Desk is hidden for any wilaya with no desk price set in Delivery
          Prices.
        </p>
      </div>
    </SectionShell>
  );
}
