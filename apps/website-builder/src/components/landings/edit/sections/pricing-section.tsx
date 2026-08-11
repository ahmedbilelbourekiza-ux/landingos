"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { Field } from "./field";
import { useBuilderApi } from "@/lib/builder/api-base";

export interface PricingPreviewValues {
  price: number;
  oldPrice: number | null;
  currency: string;
}

/* The code is the stored value and never changes; only the NAME beside it is
 * read, so the list carries a key rather than a sentence. */
const PRICING_CURRENCIES = [
  { code: "DZD", labelKey: "builder.editor.currencyDZD" },
  { code: "EUR", labelKey: "builder.editor.currencyEUR" },
  { code: "USD", labelKey: "builder.editor.currencyUSD" },
] as const;

/** Built from `t` inside the component — see general-section.tsx's note. */
function buildPricingSchema(t: (key: string) => string) {
  return z
    .object({
      price: z.coerce.number().positive(t("builder.editor.pricePositive")),
      oldPrice: z.coerce
        .number()
        .positive(t("builder.editor.oldPricePositive"))
        .optional()
        .or(z.literal("").transform(() => undefined)),
      currency: z.enum(["DZD", "EUR", "USD"]),
    })
    .superRefine((data, ctx) => {
      if (data.oldPrice !== undefined && data.oldPrice <= data.price) {
        ctx.addIssue({
          path: ["oldPrice"],
          code: z.ZodIssueCode.custom,
          message: t("builder.editor.oldPriceHigher"),
        });
      }
    });
}

type PricingFormValues = z.infer<ReturnType<typeof buildPricingSchema>>;

export function PricingSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: PricingPreviewValues;
  onPreviewChange: (values: PricingPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const t = useTranslations();
  const schema = React.useMemo(() => buildPricingSchema(t), [t]);
  const form = useForm<PricingFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: "onBlur",
  });

  const section = useSectionState({
    save: async () => {
      const values = form.getValues();
      const res = await fetch(api(`/landings/${landingId}/pricing`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: values.price,
          oldPrice: values.oldPrice ?? null,
          currency: values.currency,
        }),
      });
      const json = await res.json();
      refuseIfFailed(json);
    },
  });

  const { register, control, setValue, trigger, reset } = form;

  const priceValue = useWatch({ control, name: "price" });
  const oldPriceValue = useWatch({ control, name: "oldPrice" });
  const currencyValue = useWatch({ control, name: "currency" });

  React.useEffect(() => {
    const sub = form.watch(() => section.markDirty());
    return () => sub.unsubscribe();
  }, [form, section]);

  React.useEffect(() => {
    onPreviewChange({
      price: Number(priceValue) || 0,
      oldPrice:
        oldPriceValue !== undefined && oldPriceValue !== null && oldPriceValue !== ""
          ? Number(oldPriceValue)
          : null,
      currency: currencyValue ?? "DZD",
    });
  }, [priceValue, oldPriceValue, currencyValue, onPreviewChange]);

  const handleSave = async () => {
    const valid = await trigger();
    if (!valid) return;
    await section.save();
  };

  const handleCancel = () => {
    reset(initialValues);
    section.reset();
  };

  const discount =
    oldPriceValue !== undefined && oldPriceValue !== null && oldPriceValue !== ""
      ? discountPercentage(Number(priceValue) || 0, Number(oldPriceValue))
      : null;

  const currency = currencyValue ?? "DZD";

  return (
    <SectionShell
      id="pricing"
      title={t("builder.editor.pricing")}
      description={t("builder.editor.pricingDesc")}
      icon={Tag}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap items-baseline gap-3 rounded-xl border bg-muted/30 p-4">
          <span className="text-2xl font-semibold tabular-nums">
            {formatPrice(Number(priceValue) || 0, currency)}
          </span>
          {oldPriceValue && discount && (
            <>
              <span className="text-base text-muted-foreground line-through tabular-nums">
                {formatPrice(Number(oldPriceValue), currency)}
              </span>
              <Badge className="bg-foreground text-background hover:bg-foreground">−{discount}%</Badge>
            </>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("builder.editor.priceLabel")} error={form.formState.errors.price?.message} htmlFor="price" required>
            <Input id="price" type="number" step="1" min="0" placeholder="2990" aria-invalid={!!form.formState.errors.price} {...register("price")} />
          </Field>

          <Field label={t("builder.editor.oldPriceLabel")} error={form.formState.errors.oldPrice?.message as string | undefined} htmlFor="oldPrice" hint={t("builder.editor.oldPriceHint")}>
            <Input id="oldPrice" type="number" step="1" min="0" placeholder="3900" aria-invalid={!!form.formState.errors.oldPrice} {...register("oldPrice")} />
          </Field>

          <Field label={t("builder.editor.currencyLabel")} error={form.formState.errors.currency?.message} htmlFor="currency">
            <Select value={currency} onValueChange={(v) => setValue("currency", v as "DZD" | "EUR" | "USD", { shouldValidate: true })}>
              <SelectTrigger id="currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{t(c.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </form>
    </SectionShell>
  );
}
