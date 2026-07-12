"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tag } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
import {
  SectionShell,
  useSectionState,
} from "@/components/landings/edit/section";
import { Field } from "./field";

// The 5 pricing values the preview panel needs. Lifted to the parent the
// same way General's values are — via onPreviewChange, no global store.
export interface PricingPreviewValues {
  price: number;
  oldPrice: number | null;
  currency: string;
  shipping: number;
  freeShipping: boolean;
}

// Currencies supported by the pricing section. DZD leads as the project
// default. Defined inline rather than imported from create.ts — the create
// form supports 8 currencies, the pricing editor supports 3. Different
// scopes, different lists; sharing would couple unrelated features.
const PRICING_CURRENCIES = [
  { code: "DZD", label: "DZD — Algerian Dinar", symbol: "DA" },
  { code: "EUR", label: "EUR — Euro", symbol: "€" },
  { code: "USD", label: "USD — US Dollar", symbol: "$" },
] as const;

const pricingSchema = z
  .object({
    price: z.coerce.number().positive("Price must be greater than 0"),
    oldPrice: z.coerce
      .number()
      .positive("Old price must be greater than 0")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    currency: z.enum(["DZD", "EUR", "USD"]),
    shipping: z.coerce.number().min(0, "Shipping cannot be negative"),
    freeShipping: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.oldPrice !== undefined && data.oldPrice <= data.price) {
      ctx.addIssue({
        path: ["oldPrice"],
        code: z.ZodIssueCode.custom,
        message: "Old price must be higher than the current price",
      });
    }
  });

type PricingFormValues = z.infer<typeof pricingSchema>;

export function PricingSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: PricingPreviewValues;
  onPreviewChange: (values: PricingPreviewValues) => void;
}) {
  const section = useSectionState({
    save: async () => {
      const values = form.getValues();
      const res = await fetch(`/api/landings/${landingId}/pricing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: values.price,
          oldPrice: values.oldPrice ?? null,
          currency: values.currency,
          shipping: values.shipping,
          freeShipping: values.freeShipping,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Save failed");
    },
  });

  const form = useForm<PricingFormValues>({
    resolver: zodResolver(pricingSchema),
    defaultValues: initialValues,
    mode: "onBlur",
  });

  const { register, control, setValue, trigger, reset } = form;

  // --- Watch all fields for preview lifting + conditional UI ---
  const priceValue = useWatch({ control, name: "price" });
  const oldPriceValue = useWatch({ control, name: "oldPrice" });
  const currencyValue = useWatch({ control, name: "currency" });
  const shippingValue = useWatch({ control, name: "shipping" });
  const freeShippingValue = useWatch({ control, name: "freeShipping" });

  // When free shipping is toggled on, force shipping to 0. The field is also
  // disabled in the UI so the user can't fight the toggle.
  React.useEffect(() => {
    if (freeShippingValue) {
      setValue("shipping", 0, { shouldValidate: true });
    }
  }, [freeShippingValue, setValue]);

  // --- Mark dirty on any field change ---
  React.useEffect(() => {
    const sub = form.watch(() => section.markDirty());
    return () => sub.unsubscribe();
  }, [form, section]);

  // --- Lift preview values to parent ---
  // useWatch returns the raw input value, which for number inputs is a
  // string until validation coerces it. Convert here so the preview gets
  // real numbers — string concatenation would otherwise join "2990" + "400"
  // into "2990400" instead of adding to 3390.
  React.useEffect(() => {
    onPreviewChange({
      price: Number(priceValue) || 0,
      oldPrice:
        oldPriceValue !== undefined && oldPriceValue !== null && oldPriceValue !== ""
          ? Number(oldPriceValue)
          : null,
      currency: currencyValue ?? "DZD",
      shipping: Number(shippingValue) || 0,
      freeShipping: freeShippingValue ?? false,
    });
  }, [
    priceValue,
    oldPriceValue,
    currencyValue,
    shippingValue,
    freeShippingValue,
    onPreviewChange,
  ]);

  // --- Save / Cancel ---
  const handleSave = async () => {
    const valid = await trigger();
    if (!valid) return;
    await section.save();
  };

  const handleCancel = () => {
    reset(initialValues);
    section.reset();
  };

  // --- Auto-calculated discount (display only, not a form field) ---
  const discount =
    oldPriceValue !== undefined && oldPriceValue !== null && oldPriceValue !== ""
      ? discountPercentage(Number(priceValue) || 0, Number(oldPriceValue))
      : null;

  const currency = currencyValue ?? "DZD";
  const effectiveShipping = freeShippingValue ? 0 : Number(shippingValue) || 0;
  const total = (Number(priceValue) || 0) + effectiveShipping;

  return (
    <SectionShell
      id="pricing"
      title="Pricing"
      description="Price, old price, and currency."
      icon={Tag}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        {/* Live pricing summary — mirrors the public landing page. Discount
            is auto-calculated, never user-editable. */}
        <div className="flex flex-wrap items-baseline gap-3 rounded-xl border bg-muted/30 p-4">
          <span className="text-2xl font-semibold tabular-nums">
            {formatPrice(Number(priceValue) || 0, currency)}
          </span>
          {oldPriceValue && discount && (
            <>
              <span className="text-base text-muted-foreground line-through tabular-nums">
                {formatPrice(Number(oldPriceValue), currency)}
              </span>
              <Badge className="bg-foreground text-background hover:bg-foreground">−{discount}%
              </Badge>
            </>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Current price"
            error={form.formState.errors.price?.message}
            htmlFor="price"
            required
          >
            <Input
              id="price"
              type="number"
              step="1"
              min="0"
              placeholder="2990"
              aria-invalid={!!form.formState.errors.price}
              {...register("price")}
            />
          </Field>

          <Field
            label="Old price"
            error={form.formState.errors.oldPrice?.message as string | undefined}
            htmlFor="oldPrice"
            hint="Optional — shown struck-through"
          >
            <Input
              id="oldPrice"
              type="number"
              step="1"
              min="0"
              placeholder="3900"
              aria-invalid={!!form.formState.errors.oldPrice}
              {...register("oldPrice")}
            />
          </Field>

          <Field
            label="Currency"
            error={form.formState.errors.currency?.message}
            htmlFor="currency"
          >
            <Select
              value={currency}
              onValueChange={(v) =>
                setValue("currency", v as "DZD" | "EUR" | "USD", {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Shipping price"
            error={form.formState.errors.shipping?.message}
            htmlFor="shipping"
            hint={
              freeShippingValue ? "Free shipping enabled" : undefined
            }
          >
            <Input
              id="shipping"
              type="number"
              step="1"
              min="0"
              placeholder="400"
              disabled={freeShippingValue}
              className={cn(freeShippingValue && "opacity-50")}
              aria-invalid={!!form.formState.errors.shipping}
              {...register("shipping")}
            />
          </Field>
        </div>

        {/* Free shipping toggle */}
        <div className="flex items-center justify-between rounded-xl border p-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="freeShipping" className="cursor-pointer">
              Free shipping
            </Label>
            <p className="text-xs text-muted-foreground">
              {freeShippingValue
                ? "Shipping cost is waived — shown as Free on the landing page."
                : "Charge the shipping price entered above."}
            </p>
          </div>
          <Switch
            id="freeShipping"
            checked={freeShippingValue ?? false}
            onCheckedChange={(checked) =>
              setValue("freeShipping", checked, { shouldValidate: true })
            }
          />
        </div>

        {/* Total preview line */}
        <div className="flex items-center justify-between rounded-lg border border-dashed px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Total (price + shipping)
          </span>
          <span className="font-semibold tabular-nums">
            {formatPrice(total, currency)}
          </span>
        </div>
      </form>
    </SectionShell>
  );
}
